import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  copyFile,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { randomBytes } from "node:crypto";

const exec = promisify(execFile);
const docker = async (...args) =>
  (await exec("docker", args, { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();

// Real Docker, nginx and updater; the registry and app are disposable protocol
// fixtures. Application contracts/database migrations have their own release suite.
test(
  "deployment preserves traffic, drains writes and rejects unhealthy releases",
  { timeout: 360_000 },
  async (t) => {
    await docker("info", "--format", "{{.ServerVersion}}");
    const root = await mkdtemp(join(tmpdir(), "lastpeek-handover-"));
    const project = `lastpeek-test-${randomBytes(5).toString("hex")}`;
    const server = createServer();
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const port = server.address().port;
    await new Promise((done) => server.close(done));
    const image = `localhost:${port}/lastpeek`;
    const registry = `${project}-registry`;
    const composeArgs = [
      "compose",
      "--project-directory",
      root,
      "-p",
      project,
      "--env-file",
      join(root, ".env"),
      "--env-file",
      join(root, "images.env"),
      "-f",
      join(root, "compose.yaml"),
      "-f",
      join(root, "compose.override.yaml"),
      "-f",
      join(root, "compose.blue-green.yaml"),
    ];
    const compose = (...args) => docker(...composeArgs, ...args);
    const revisions = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];
    const digests = [];
    t.after(async () => {
      await compose(
        "--profile",
        "blue-green",
        "--profile",
        "legacy",
        "down",
        "-v",
        "--remove-orphans",
      ).catch(() => {});
      await docker("rm", "-f", "-v", registry).catch(() => {});
      for (const reference of [
        ...digests,
        ...revisions.map((revision) => `${image}:${revision}`),
        `${image}:latest`,
      ]) {
        await docker("image", "rm", reference).catch(() => {});
      }
      await rm(root, { recursive: true, force: true });
    });
    await docker(
      "run",
      "-d",
      "--name",
      registry,
      "--network",
      "host",
      "-e",
      `REGISTRY_HTTP_ADDR=127.0.0.1:${port}`,
      "registry:2",
    );
    await mkdir(join(root, "routing"));
    await mkdir(join(root, "assets"));
    await copyFile("deployment/nginx.conf", join(root, "routing/nginx.conf"));
    await copyFile("deployment/backup.sh", join(root, "backup.sh"));
    const overlay = await readFile(
      "deployment/compose.blue-green.yaml",
      "utf8",
    );
    await writeFile(
      join(root, "compose.blue-green.yaml"),
      overlay.replace("127.0.0.1:3013:3000", "127.0.0.1::3000"),
    );
    await writeFile(join(root, ".env"), "");
    await writeFile(
      join(root, "compose.yaml"),
      `services:
  db:
    image: postgres:16-bookworm
    environment:
      POSTGRES_USER: lastpeek
      POSTGRES_DB: lastpeek
      POSTGRES_HOST_AUTH_METHOD: trust
    healthcheck:
      test: [CMD, pg_isready, -U, lastpeek]
      interval: 1s
      timeout: 2s
      retries: 30
  web:
    image: \${BLUE_IMAGE}
    environment:
      FAIL_HEALTH: \${FAIL_HEALTH:-0}
      FAIL_MIGRATION: \${FAIL_MIGRATION:-0}
      FAIL_REVISION: \${FAIL_REVISION:-0}
      REPLACED: base
    volumes:
      - media:/app/data/media
    healthcheck:
      test: [CMD, node, -e, "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1))"]
      interval: 1s
      timeout: 2s
      retries: 2
    command: [node, build]
  maintenance:
    image: \${MAINTENANCE_IMAGE}
    command: [node, -e, "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{}, 1000)"]
    depends_on:
      web:
        condition: service_healthy
volumes:
  media:
`,
    );
    await writeFile(
      join(root, "compose.override.yaml"),
      "services:\n  web:\n    environment:\n      OVERRIDE_ONLY: fixture-value\n      REPLACED: override\n",
    );
    await writeFile(
      join(root, "server.cjs"),
      `
const http = require('node:http');
const fs = require('node:fs');
const revision = process.env.APP_REVISION;
// Match adapter-node's explicit signal handling when running as container PID 1.
process.on('SIGTERM', () => process.exit(0));
setTimeout(() => http.createServer(async (req, res) => {
  if(req.url === '/configuration') return res.end(process.env.OVERRIDE_ONLY + ':' + process.env.REPLACED);
  if(req.url === '/r/private-capability-test') return req.socket.destroy();
  if(req.url === '/health') {
    res.writeHead(process.env.FAIL_HEALTH === '1' ? 503 : 200, {'X-LastPeek-Revision':process.env.FAIL_REVISION === '1' ? 'incorrect' : revision});
    return res.end('ok');
  }
  if(req.url === '/save' && req.method === 'POST') {
    let body = ''; for await(const chunk of req) body += chunk;
    fs.writeFileSync('/app/data/media/started', revision);
    while(!fs.existsSync('/app/data/media/release')) await new Promise(resolve => setTimeout(resolve, 50));
    fs.appendFileSync('/app/data/media/writes', body + '\\n');
    return res.end(revision);
  }
  if(req.url === '/writes') return res.end(fs.existsSync('/app/data/media/writes') ? fs.readFileSync('/app/data/media/writes') : '');
  res.writeHead(200, {'Content-Type':'text/html'}); res.end('<html>'+revision+'</html>');
}).listen(3000, '0.0.0.0'), 600);
`,
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "db:migrate": "node migrate.cjs",
          operator:
            "node -e 'console.log(JSON.stringify({ok:true,result:{revision:process.env.APP_REVISION}}))'",
        },
      }),
    );
    await writeFile(
      join(root, "migrate.cjs"),
      "process.exit(process.env.FAIL_MIGRATION === '1' ? 1 : 0)",
    );
    await writeFile(
      join(root, "Dockerfile"),
      `FROM node:22-bookworm-slim
WORKDIR /app
ARG REVISION
ENV APP_REVISION=$REVISION
LABEL org.opencontainers.image.revision=$REVISION
COPY server.cjs build
COPY package.json migrate.cjs ./
RUN mkdir -p build-tmp data/media && mkdir -p /tmp/assets && echo "$REVISION" > /tmp/assets/$REVISION.js
# The production asset path is beneath a build directory. Node accepts its index.js.
RUN mv build build-tmp/index.js && mkdir build && mv build-tmp/index.js build/index.js && mkdir -p build/client/_app/immutable && cp /tmp/assets/* build/client/_app/immutable/
CMD ["node", "build"]
`,
    );
    for (const revision of revisions) {
      await docker(
        "build",
        "--build-arg",
        `REVISION=${revision}`,
        "-t",
        `${image}:${revision}`,
        root,
      );
      await docker("push", `${image}:${revision}`);
      const metadata = JSON.parse(
        await docker("image", "inspect", `${image}:${revision}`),
      )[0];
      digests.push(
        metadata.RepoDigests.find((value) => value.startsWith(image + "@")),
      );
    }
    await writeFile(
      join(root, "images.env"),
      ["BLUE_IMAGE", "GREEN_IMAGE", "MAINTENANCE_IMAGE"]
        .map((key) => `${key}=${digests[0]}\n`)
        .join(""),
    );
    await writeFile(
      join(root, "run.py"),
      `import importlib.util, sys, os
sys.dont_write_bytecode = True
from pathlib import Path
spec = importlib.util.spec_from_file_location('updater', ${JSON.stringify(join(root, "update.py"))})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.IMAGE = ${JSON.stringify(image)}
module.COMPOSE[module.COMPOSE.index('-p') + 1] = ${JSON.stringify(project)}
original_run = module.run
def interrupt(*args, **kwargs):
    if os.environ.get('INTERRUPT_RELOAD') == '1' and args[-2:] == ('-s', 'reload'):
        os._exit(17)
    return original_run(*args, **kwargs)
module.run = interrupt
with (module.ROOT / '.deployment.lock').open('a') as lock:
    module.fcntl.flock(lock, module.fcntl.LOCK_EX)
    module.deploy()
`,
    );
    await copyFile("deployment/update.py", join(root, "update.py"));
    const update = async (env = {}) =>
      exec("python3", [join(root, "run.py")], {
        env: { ...process.env, ...env },
        maxBuffer: 8 * 1024 * 1024,
      });
    await writeFile(
      join(root, "gateway.py"),
      `import importlib.util, sys, json
sys.dont_write_bytecode = True
from pathlib import Path
spec = importlib.util.spec_from_file_location('gateway', ${JSON.stringify(resolve("scripts/operator-gateway.py"))})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.DEPLOYMENT = Path(${JSON.stringify(root)})
module.COMPOSE = ['docker', 'compose', '--project-directory', ${JSON.stringify(root)}, '-p', ${JSON.stringify(project)}]
print(json.dumps(module.dispatch(json.loads(sys.argv[1]), 'read')))
`,
    );
    const gateway = async (command) =>
      JSON.parse(
        (
          await exec("python3", [
            join(root, "gateway.py"),
            JSON.stringify(command),
          ])
        ).stdout,
      );
    await docker("tag", `${image}:${revisions[0]}`, `${image}:latest`);
    await docker("push", `${image}:latest`);
    await update();
    const proxyId = await compose("ps", "-q", "proxy");
    const proxyInfo = JSON.parse(await docker("inspect", proxyId))[0];
    const proxyIp = Object.values(proxyInfo.NetworkSettings.Networks)[0]
      .IPAddress;
    const origin = `http://${proxyIp}:3000`;
    const health = async () => {
      const response = await fetch(`${origin}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200);
      return response.headers.get("x-lastpeek-revision");
    };
    assert.equal(await health(), revisions[0]);
    assert.equal(
      await (await fetch(`${origin}/configuration`)).text(),
      "fixture-value:override",
    );
    assert.equal(
      (await stat(join(root, ".web-template.json"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await fetch(`${origin}/r/private-capability-test`)).status,
      502,
    );
    const logs = await exec("docker", ["logs", proxyId]);
    assert.ok(
      !`${logs.stdout}${logs.stderr}`.includes("private-capability-test"),
    );
    const config = JSON.parse(
      await compose("--profile", "blue-green", "config", "--format", "json"),
    );
    assert.equal(config.services.blue.ports?.length || 0, 0);
    assert.equal(config.services.green.ports?.length || 0, 0);
    assert.equal(
      config.services.blue.volumes[0].source,
      config.services.green.volumes[0].source,
    );

    let watching = true;
    const observations = [];
    const watcher = (async () => {
      while (watching) {
        try {
          observations.push(await health());
        } catch (error) {
          observations.push(error);
        }
        await delay(20);
      }
    })();
    try {
      const save = fetch(`${origin}/save`, {
        method: "POST",
        body: "one-write",
      }).then((r) => r.text());
      // Ensure the request is inside the old app before starting the release.
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await compose(
            "exec",
            "-T",
            "blue",
            "test",
            "-f",
            "/app/data/media/started",
          );
          break;
        } catch {
          if (attempt === 99) throw new Error("Save never started");
          await delay(20);
        }
      }
      await docker("tag", `${image}:${revisions[1]}`, `${image}:latest`);
      await docker("push", `${image}:latest`);
      const handover = update();
      // The old write remains deliberately blocked until NEW traffic reaches green.
      // A stop-before-start or a non-draining switch would terminate this request.
      for (let attempt = 0; attempt < 300; attempt++) {
        if ((await health()) === revisions[1]) break;
        if (attempt === 299) throw new Error("Handover never reached green");
        await delay(100);
      }
      await compose("exec", "-T", "green", "touch", "/app/data/media/release");
      await handover;
      assert.equal(await save, revisions[0]);
      assert.equal(await health(), revisions[1]);
      assert.equal(
        await (await fetch(`${origin}/configuration`)).text(),
        "fixture-value:override",
      );
      assert.equal(
        (await gateway({ action: "admin_overview" })).result.revision,
        revisions[1],
      );
      await assert.rejects(
        gateway({ action: "admin_overview", service: "blue" }),
      );
      await assert.rejects(gateway({ action: "set_feature_access" }));
      assert.equal(
        await (await fetch(`${origin}/writes`)).text(),
        "one-write\n",
      );
      for (const revision of revisions.slice(0, 2)) {
        const asset = await fetch(`${origin}/_app/immutable/${revision}.js`);
        assert.equal(asset.status, 200);
        assert.equal((await asset.text()).trim(), revision);
      }
      // Stale shell variables must not override the persisted digest pins.
      await update({
        BLUE_IMAGE: "not-a-release",
        GREEN_IMAGE: "not-a-release",
      });
      assert.equal(await health(), revisions[1]);
      await docker("tag", `${image}:${revisions[2]}`, `${image}:latest`);
      await docker("push", `${image}:latest`);
      await assert.rejects(update({ FAIL_MIGRATION: "1" }));
      assert.equal(await health(), revisions[1]);
      await assert.rejects(update({ FAIL_HEALTH: "1" }));
      assert.equal(await health(), revisions[1]);
      await assert.rejects(update({ FAIL_REVISION: "1" }));
      assert.equal(await health(), revisions[1]);
      const nginx = await readFile(join(root, "routing/nginx.conf"), "utf8");
      await writeFile(
        join(root, "routing/nginx.conf"),
        nginx + "\ninvalid_directive;\n",
      );
      await assert.rejects(update());
      assert.equal(await health(), revisions[1]);
      assert.equal(
        await readFile(join(root, "routing/active.conf"), "utf8"),
        "upstream lastpeek { server green:3000; }\n",
      );
      await writeFile(join(root, "routing/nginx.conf"), nginx);
      // Abruptly exit after persisting the desired route but before nginx reload.
      await assert.rejects(update({ INTERRUPT_RELOAD: "1" }), { code: 17 });
      assert.equal(await health(), revisions[1]);
      await update();
      assert.equal(await health(), revisions[2]);
    } finally {
      watching = false;
      await watcher;
    }
    assert.ok(observations.length > 20);
    assert.deepEqual(
      observations.filter((value) => value instanceof Error),
      [],
    );
    const running = (await compose("ps", "--services", "--status", "running"))
      .split("\n")
      .sort();
    assert.deepEqual(running, ["blue", "maintenance", "proxy"]);
    console.log(
      `${observations.length} health reads: no errors; in-flight write once; old assets retained; migration/health failures kept preceding app`,
    );
    // Backups intentionally quiesce writers, outside the deployment traffic watch.
    await compose("up", "-d", "--wait", "db");
    await compose("up", "-d", "--no-deps", "green");
    const backup = () =>
      exec("bash", [join(root, "backup.sh")], {
        env: { ...process.env, HOME: root, COMPOSE_PROJECT_NAME: project },
        maxBuffer: 8 * 1024 * 1024,
      });
    await backup();
    const backups = join(root, "lastpeek-backups");
    const [snapshot] = await readdir(backups);
    assert.ok(!snapshot.endsWith(".partial"));
    const directory = join(backups, snapshot);
    assert.equal(
      (await exec("tar", ["-xOf", join(directory, "media.tar.gz"), "./writes"]))
        .stdout,
      "one-write\n",
    );
    await exec("sha256sum", ["-c", "SHA256SUMS"], { cwd: directory });
    await docker(
      "run",
      "--rm",
      "--network",
      "none",
      "--mount",
      `type=bind,source=${directory},target=/backup,readonly`,
      "postgres:16-bookworm",
      "pg_restore",
      "--list",
      "/backup/database.dump",
    );
    assert.equal(
      await readFile(join(directory, "routing/active.conf"), "utf8"),
      "upstream lastpeek { server blue:3000; }\n",
    );
    assert.equal(
      (await stat(join(directory, ".web-template.json"))).mode & 0o777,
      0o600,
    );
    const runningServices = async () =>
      (await compose("ps", "--services", "--status", "running"))
        .split("\n")
        .sort();
    assert.deepEqual(await runningServices(), [
      "blue",
      "db",
      "maintenance",
      "proxy",
    ]);
    // A failed dump retains partial evidence and resumes only previous writers.
    await compose("stop", "db", "maintenance");
    await assert.rejects(backup());
    assert.equal(await health(), revisions[2]);
    assert.deepEqual(await runningServices(), ["blue", "proxy"]);
    assert.equal(
      (await readdir(backups)).filter((name) => name.endsWith(".partial"))
        .length,
      1,
    );
    console.log(
      "Backup database/media/checksums verified; inactive slot stayed stopped; failed dump resumed app without starting stopped maintenance",
    );
  },
);
