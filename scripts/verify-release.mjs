import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { documentationOnly } from "./release-policy.mjs";

// This command owns all fixtures. It never starts against or resets an existing
// application database, never loads the preview's credentials into the server,
// and builds in a private copy so recordings/preview restarts cannot interfere.
const root = process.cwd();
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
  console.log(`\n> ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || code})`));
    });
  });
}

await mkdir(dirname(receipt), { recursive: true });
// Always recheck documentation formatting and the current dependency audit.
await run("npm", ["ci"]);
await run("npm", ["run", "format:check"]);
await run("npm", ["audit", "--audit-level=moderate"]);
const input = await fingerprint();
let previous;
try {
  previous = JSON.parse(await readFile(receipt, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (
  !process.env.CI &&
  !process.argv.includes("--force") &&
  previous?.input === input
) {
  console.log(
    `Reusing Chromium + WebKit verification from ${previous.verifiedAt}; runtime/test/tooling inputs unchanged`,
  );
  process.exit(0);
}

await rm(receipt, { force: true });
await run("npx", ["playwright", "install", "chromium", "webkit"]);
const workspace = await mkdtemp(resolve(".amp/in/release-"));
// CI can invoke this script before dependencies exist; npm ci above installs pg.
const { default: pg } = await import("pg");
const admin = new pg.Pool({ connectionString: connection.href });
const started = Date.now();
try {
  for (const file of sourceFiles()) {
    try {
      await mkdir(dirname(join(workspace, file)), { recursive: true });
      await copyFile(file, join(workspace, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  // Kit generates $app types inside node_modules, so even dependencies must not
  // be symlinked to the preview's directory.
  await cp(resolve("node_modules"), join(workspace, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  const port = await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  // Do not inherit real API keys, seed credentials, limits or proxy settings.
  const inherited = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "CI",
      "PLAYWRIGHT_BROWSERS_PATH",
      "NODE_EXTRA_CA_CERTS",
    ]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  const env = {
    ...inherited,
    ORIGIN: origin,
    TEST_BASE_URL: origin,
    HOST: "127.0.0.1",
    PORT: String(port),
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
  await run("npm", ["run", "check"], workspace, env);
  await run("npm", ["test"], workspace, env);
  await run("npm", ["run", "build"], workspace, env);
  for (const browser of ["chromium", "webkit"]) {
    const database = `lastpeek_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${database}`);
    connection.pathname = `/${database}`;
    const browserEnv = {
      ...env,
      DATABASE_URL: connection.href,
      MEDIA_DIR: join(workspace, "media", browser),
      TEST_BROWSER: browser,
    };
    let server;
    let exited;
    try {
      await run("npm", ["run", "db:migrate"], workspace, browserEnv);
      await run("npm", ["run", "db:migrate"], workspace, browserEnv);
      // Bounded fixture, not a development service; it lives only for this suite.
      server = spawn(process.execPath, ["build"], {
        cwd: workspace,
        env: browserEnv,
        stdio: "inherit",
      });
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
        throw new Error("Disposable production server failed its health check");
      await run("npm", ["run", "test:e2e"], workspace, browserEnv);
    } finally {
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([exited, delay(5000)]);
        if (server.exitCode === null) {
          server.kill("SIGKILL");
          await exited;
        }
      }
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    }
  }
  if ((await fingerprint()) !== input)
    throw new Error(
      "Sources changed during verification; run again before shipping",
    );
  await writeFile(
    receipt,
    JSON.stringify({ input, verifiedAt: new Date().toISOString() }) + "\n",
  );
  console.log(
    `Release verification passed: Chromium + WebKit, isolated databases/media/build (${Math.round((Date.now() - started) / 1000)}s)`,
  );
} finally {
  await admin.end();
  await rm(workspace, { recursive: true, force: true });
}
