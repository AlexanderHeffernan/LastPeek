import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import { availableParallelism } from "node:os";
import { resolve, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { documentationOnly } from "./release-policy.mjs";

const options = {
  focused: false,
  force: false,
  browser: "both",
  file: "tests/web.test.ts",
  test: undefined,
};
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === "--focused") options.focused = true;
  else if (arg === "--force") options.force = true;
  else if (["--browser", "--file", "--test"].includes(arg)) {
    const value = process.argv[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = value;
  } else if (arg === "--help") {
    console.log(`Release: npm run verify:release [-- --force]
Focused: npm run verify:focused -- --test 'test name regex' [--browser chromium|webkit|both] [--file tests/web.test.ts]
Focused runs own their disposable database/media/server and never certify a release.`);
    process.exit(0);
  } else throw new Error(`Unknown option: ${arg}`);
}
if (!["chromium", "webkit", "both"].includes(options.browser))
  throw new Error("Invalid --browser; use chromium, webkit or both");
if (!/^tests\/[\w-]+\.test\.ts$/.test(options.file))
  throw new Error("--file must name a TypeScript test directly under tests/");
if (options.test !== undefined) new RegExp(options.test);
if (
  !options.focused &&
  (options.browser !== "both" ||
    options.file !== "tests/web.test.ts" ||
    options.test !== undefined)
)
  throw new Error(
    "Test selection requires verify:focused; release verification always runs the complete gate",
  );
if (options.focused && !options.test && options.file === "tests/web.test.ts")
  throw new Error("Focused verification requires --test or a specific --file");

// This command owns all fixtures. It never starts against or resets an existing
// application database, never loads the preview's credentials into the server,
// and builds in a private copy so recordings/preview restarts cannot interfere.
const root = process.cwd();
const started = Date.now();
const receipt = resolve(".amp/in/release-verification.json");
const connection = new URL(
  process.env.DATABASE_URL || "postgres://lastpeek@127.0.0.1:55432/postgres",
);
if (
  !["127.0.0.1", "localhost", "[::1]", "postgres"].includes(connection.hostname)
)
  throw new Error(
    "Release verification requires a local disposable PostgreSQL server",
  );
connection.pathname = "/postgres";
connection.search = "";
function sourceFiles() {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
}
async function fingerprint() {
  const hash = createHash("sha256").update(
    `${process.version}:${process.platform}:${process.arch}`,
  );
  for (const file of sourceFiles().filter(
    (file) => !documentationOnly([file]),
  )) {
    try {
      const info = await stat(file);
      hash
        .update(file)
        .update(String(info.mode))
        .update(await readFile(file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update(`deleted:${file}`);
    }
  }
  return hash.digest("hex");
}

function run(command, args, cwd = root, env = process.env) {
  const label = `${env.TEST_BROWSER ? `[${env.TEST_BROWSER}] ` : ""}${command} ${args.join(" ")}`;
  console.log(`\n> ${label}`);
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      console.log(
        `[timing] ${label}: ${((Date.now() - start) / 1000).toFixed(1)}s (${code === 0 ? "passed" : "failed"})`,
      );
      if (code === 0) resolve(output);
      else reject(new Error(`${command} failed (${signal || code})`));
    });
  });
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  if (process.platform === "linux")
    await run("cp", ["-a", "--reflink=auto", `${source}/.`, destination]);
  else
    await cp(source, destination, { recursive: true, verbatimSymlinks: true });
}

await mkdir(dirname(receipt), { recursive: true });
const input = await fingerprint();
let previous;
if (!options.focused) {
  try {
    previous = JSON.parse(await readFile(receipt, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const reuse =
  !options.focused &&
  !process.env.CI &&
  !options.force &&
  previous?.input === input;
if (!options.focused && !reuse) await rm(receipt, { force: true });
const workspace = await mkdtemp(resolve(".amp/in/verification-"));
let typeWorkspace;
let admin;
try {
  for (const file of sourceFiles()) {
    try {
      await mkdir(dirname(join(workspace, file)), { recursive: true });
      await copyFile(file, join(workspace, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await stat(join(workspace, options.file));
  // Install once per dependency/runtime fingerprint, never into the preview.
  // Publish atomically: concurrent runs can build their own cache candidates.
  const dependencyKey = createHash("sha256")
    .update(`${process.version}:${process.platform}:${process.arch}`)
    .update(await readFile(join(workspace, "package.json")))
    .update(await readFile(join(workspace, "package-lock.json")))
    .digest("hex");
  const dependencies = resolve(`.amp/in/verification-deps-${dependencyKey}`);
  try {
    await stat(join(dependencies, "node_modules"));
    console.log("Reusing private lockfile-matched dependencies");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const candidate = await mkdtemp(resolve(".amp/in/verification-install-"));
    try {
      for (const file of ["package.json", "package-lock.json"])
        await copyFile(join(workspace, file), join(candidate, file));
      await run("npm", ["ci", "--prefer-offline"], candidate);
      try {
        await rename(candidate, dependencies);
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      }
    } finally {
      await rm(candidate, { recursive: true, force: true });
    }
  }
  // Kit generates $app types inside node_modules. Each run gets a writable copy,
  // not a symlink to the cache or the running preview's dependencies.
  const copyStarted = Date.now();
  await copyTree(
    join(dependencies, "node_modules"),
    join(workspace, "node_modules"),
  );
  console.log(
    `[timing] Dependency copy: ${((Date.now() - copyStarted) / 1000).toFixed(1)}s`,
  );
  if (reuse) {
    const results = await Promise.allSettled([
      run("npm", ["run", "format:check"], workspace),
      run("npm", ["audit", "--audit-level=moderate"], workspace),
    ]);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    if ((await fingerprint()) !== input)
      throw new Error(
        "Sources changed during verification; run again before shipping",
      );
    console.log(
      `Reusing Chromium + WebKit verification from ${previous.verifiedAt}; runtime/test/tooling inputs unchanged`,
    );
  } else {
    const browsers =
      options.browser === "both" ? ["chromium", "webkit"] : [options.browser];
    await run("npx", ["playwright", "install", ...browsers], workspace);
    const require = createRequire(join(workspace, "package.json"));
    const pg = require("pg");
    admin = new pg.Pool({ connectionString: connection.href });
    // Do not inherit real API keys, seed credentials, limits or proxy settings.
    const inherited = Object.fromEntries(
      [
        "PATH",
        "HOME",
        "TMPDIR",
        "CI",
        "PLAYWRIGHT_BROWSERS_PATH",
        "DEBUG",
        "NODE_EXTRA_CA_CERTS",
      ]
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    );
    const env = {
      ...inherited,
      HOST: "127.0.0.1",
      BODY_SIZE_LIMIT: "55M",
      MAX_UPLOAD_MB: "50",
      MAX_STORAGE_MB: "500",
      LASTPEEK_OWNER_ID: randomUUID(),
      BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
      X_CLIENT_ID: "test-only-client-id",
      X_CLIENT_SECRET: "test-only-client-secret",
      X_API_BEARER_TOKEN: "test-only-not-a-real-key",
      OPENAI_API_KEY: "",
      SCREENSHOTS: "0",
    };
    // Check and build generate Kit files. Separate writable copies prevent
    // those tools racing, while independent CPU work overlaps the same gate.
    if (!options.focused) {
      typeWorkspace = await mkdtemp(resolve(".amp/in/verification-types-"));
      await copyTree(workspace, typeWorkspace);
    }
    const results = await Promise.allSettled([
      run("npm", ["run", "build"], workspace, env),
      ...(!options.focused
        ? [
            run("npm", ["run", "check"], typeWorkspace, env),
            run("npm", ["test"], typeWorkspace, env),
            run("npm", ["run", "format:check"], workspace),
            run("npm", ["audit", "--audit-level=moderate"], workspace),
          ]
        : []),
    ]);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    const template = `lastpeek_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${template}`);
    const templateConnection = new URL(connection);
    templateConnection.pathname = `/${template}`;
    try {
      const migrationEnv = { ...env, DATABASE_URL: templateConnection.href };
      await run("npm", ["run", "db:migrate"], workspace, migrationEnv);
      if (!options.focused)
        await run("npm", ["run", "db:migrate"], workspace, migrationEnv);
      // Explicitly isolated long scenarios; the remainder shard excludes only
      // these exact selections, so newly added/renamed tests still always run.
      const selections = [
        "site admin permissions, shared operator data and owner-managed team",
        ...[
          "source creation and clipboard",
          "live review and revocation",
          "profile and X import",
          "composer and media",
          "draft feed and queue",
          "authentication and navigation",
          "focused feedback and identity",
          "invitation and password recovery",
        ].map((name) => `author / ${name}`),
      ];
      const exact = (name) =>
        `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
      const groups = options.focused
        ? [{ file: options.file, test: options.test }]
        : [
            // The remainder includes video/PWA/friendship journeys and is one
            // of the longest shards. Starting it last creates a long idle tail.
            {
              file: "tests/web.test.ts",
              skip: selections.map(exact).join("|"),
            },
            ...selections.map((name) => ({
              file: "tests/web.test.ts",
              test: exact(name),
            })),
            { file: "tests/x-publishing.test.ts" },
          ];
      // Start the historically slow WebKit work first. Each job owns its entire
      // mutable stack, including accounts/rate limits and server-origin cookies.
      const jobs = groups.flatMap((group) =>
        browsers.toReversed().map((browser) => ({ browser, ...group })),
      );
      if (!options.focused) jobs.push({ integration: true });
      const failures = [];
      const concurrency = Math.min(
        4,
        Math.max(1, availableParallelism()),
        jobs.length,
      );
      console.log(
        `Running ${jobs.length} isolated validation shards with ${concurrency} workers`,
      );
      let next = 0;
      async function execute(job) {
        const jobStarted = Date.now();
        const { browser } = job;
        const port = await new Promise((resolve, reject) => {
          const socket = createServer();
          socket.on("error", reject);
          socket.listen(0, "127.0.0.1", () => {
            const { port } = socket.address();
            socket.close((error) => (error ? reject(error) : resolve(port)));
          });
        });
        const origin = `http://127.0.0.1:${port}`;
        // Kit 3's fixed origin is a build-time constant. Use its supported
        // proxy-derived origin mode so one unmodified build serves isolated
        // ports, with real browser Origin headers and CSRF checks still enabled.
        const gateway = createHttpServer((request, response) => {
          const upstream = httpRequest(
            {
              hostname: "127.0.0.1",
              port: upstreamPort,
              path: request.url,
              method: request.method,
              headers: { ...request.headers, "x-forwarded-proto": "http" },
            },
            (incoming) => {
              response.writeHead(incoming.statusCode, incoming.headers);
              incoming.pipe(response);
            },
          );
          upstream.on("error", () => {
            response.writeHead(502);
            response.end();
          });
          request.pipe(upstream);
        });
        const upstreamSocket = createServer();
        await new Promise((resolve, reject) => {
          upstreamSocket.on("error", reject);
          upstreamSocket.listen(0, "127.0.0.1", resolve);
        });
        const upstreamPort = upstreamSocket.address().port;
        await new Promise((resolve, reject) =>
          upstreamSocket.close((error) => (error ? reject(error) : resolve())),
        );
        const database = `lastpeek_test_${randomUUID().replaceAll("-", "")}`;
        await admin.query(`CREATE DATABASE ${database} TEMPLATE ${template}`);
        const databaseConnection = new URL(connection);
        databaseConnection.pathname = `/${database}`;
        const browserEnv = {
          ...env,
          ORIGIN: origin,
          TEST_BASE_URL: origin,
          PORT: String(upstreamPort),
          PROTOCOL_HEADER: "x-forwarded-proto",
          DATABASE_URL: databaseConnection.href,
          MEDIA_DIR: join(workspace, "media", database),
          TEST_BROWSER: browser,
        };
        let server;
        let exited;
        try {
          await new Promise((resolve, reject) => {
            gateway.on("error", reject);
            gateway.listen(port, "127.0.0.1", resolve);
          });
          if (job.integration)
            await run(
              "npm",
              ["run", "test:integration"],
              workspace,
              browserEnv,
            );
          // Bounded fixture, not a development service. Once HTTP has drained,
          // exit without waiting for this disposable server's idle database pool.
          server = spawn(
            process.execPath,
            [
              "--input-type=module",
              "--eval",
              'process.once("sveltekit:shutdown", () => process.exit(0)); await import("./build/index.js");',
            ],
            {
              cwd: workspace,
              env: browserEnv,
              stdio: "inherit",
            },
          );
          exited = new Promise((resolve) => {
            server.on("error", resolve);
            server.on("exit", resolve);
          });
          let healthy = false;
          for (let attempt = 0; attempt < 60; attempt++) {
            if (server.exitCode !== null) break;
            try {
              healthy = (await fetch(`${origin}/health`)).ok;
              if (healthy) break;
            } catch {
              /* Server is still starting. */
            }
            await delay(250);
          }
          if (!healthy)
            throw new Error(
              "Disposable production server failed its health check",
            );
          if (job.integration)
            await run("npm", ["run", "test:http"], workspace, browserEnv);
          else {
            const args = ["--import", "tsx", "--test", "--test-reporter=tap"];
            if (job.test) args.push(`--test-name-pattern=${job.test}`);
            if (job.skip) args.push(`--test-skip-pattern=${job.skip}`);
            args.push(job.file);
            console.log(
              `[shard] ${browser}: ${job.test || job.file}${job.skip ? " (remainder)" : ""}`,
            );
            const output = await run(
              process.execPath,
              args,
              workspace,
              browserEnv,
            );
            // Node can report the file itself as a pass when the pattern matches no
            // tests. Require a real, non-skipped assertion-bearing test instead.
            if (
              options.focused &&
              !output
                .split("\n")
                .some(
                  (line) =>
                    /^ok \d+ - /.test(line) &&
                    !line.includes("# SKIP") &&
                    line !== `ok 1 - ${job.file}`,
                )
            )
              throw new Error("No tests matched the focused selection");
          }
        } finally {
          gateway.closeAllConnections();
          await new Promise((resolve) => gateway.close(resolve));
          if (server && server.exitCode === null) {
            server.kill("SIGTERM");
            await Promise.race([
              exited,
              delay(5000, undefined, { ref: false }),
            ]);
            if (server.exitCode === null) {
              server.kill("SIGKILL");
              await exited;
            }
          }
          await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
          console.log(
            `[timing] Shard ${browser || "server"} ${job.test || job.file || "contracts"} including fixtures: ${((Date.now() - jobStarted) / 1000).toFixed(1)}s`,
          );
        }
      }
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next < jobs.length && failures.length === 0) {
            const job = jobs[next++];
            try {
              await execute(job);
            } catch (error) {
              failures.push(error);
            }
          }
        }),
      );
      if (failures.length)
        throw new AggregateError(failures, "Validation shards failed");
    } finally {
      await admin.query(`DROP DATABASE ${template} WITH (FORCE)`);
    }
    if ((await fingerprint()) !== input)
      throw new Error(
        "Sources changed during verification; run again before shipping",
      );
    if (options.focused)
      console.log(
        `Focused verification passed: ${browsers.join(" + ")}; no release receipt written`,
      );
    else {
      await writeFile(
        receipt,
        JSON.stringify({ input, verifiedAt: new Date().toISOString() }) + "\n",
      );
      console.log(
        "Release verification passed: Chromium + WebKit, isolated databases/media/build",
      );
    }
  }
} finally {
  await admin?.end();
  if (typeWorkspace) await rm(typeWorkspace, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
  console.log(
    `[timing] Total verification including setup and cleanup: ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
