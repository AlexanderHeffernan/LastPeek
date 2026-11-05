import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { documentationOnly } from "../scripts/release-policy.mjs";

test("only documentation-only changes bypass application release gates", () => {
  assert.equal(
    documentationOnly(["AGENTS.md", "docs/deployment.md", "README.md"]),
    true,
  );
  assert.equal(documentationOnly([]), true);
  for (const path of [
    "src/routes/help.md",
    "static/offline.md",
    "docs/preview.png",
    ".github/workflows/check.yml",
    ".agents/setup",
    "package-lock.json",
    "tests/web.test.ts",
    "scripts/release-policy.mjs",
    "LICENSE",
  ]) {
    assert.equal(documentationOnly(["README.md", path]), false, path);
  }
});

test("release planning and promotion reject stale application commits but allow newer docs", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "lastpeek-policy-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const policy = (...args) =>
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/release-policy.mjs", import.meta.url),
        ),
        ...args,
      ],
      { cwd, encoding: "utf8" },
    );
  git("init", "--quiet");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.test");
  await writeFile(
    join(cwd, "package-lock.json"),
    JSON.stringify({
      packages: { "node_modules/playwright": { version: "1.64.1" } },
    }),
  );
  await writeFile(join(cwd, "app.js"), "original");
  git("add", ".");
  git("commit", "--quiet", "-m", "Application");
  const candidate = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  assert.equal(policy("promote", candidate), "promote=true\n");
  assert.match(policy("plan"), /runtime=true/);
  assert.match(
    policy("plan", "0000000000000000000000000000000000000000"),
    /runtime=true/,
  );

  await writeFile(join(cwd, "AGENTS.md"), "Documentation");
  git("add", ".");
  git("commit", "--quiet", "-m", "Documentation");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  assert.equal(policy("plan", candidate), "runtime=false\nplaywright=1.64.1\n");
  assert.equal(policy("promote", candidate), "promote=true\n");

  await writeFile(join(cwd, "app.js"), "new behavior");
  git("add", ".");
  git("commit", "--quiet", "-m", "New application");
  const newer = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  assert.match(policy("plan", candidate), /runtime=true/);
  assert.equal(policy("promote", candidate), "promote=false\n");
  assert.equal(policy("promote", newer), "promote=true\n");
  // A code deletion must not hide behind Git's rename-to-documentation detection.
  git("mv", "app.js", "example.md");
  git("commit", "--quiet", "-m", "Move application input");
  assert.match(policy("plan", newer), /runtime=true/);
  // A release from a different history must fail closed, not mutate latest.
  git("update-ref", "refs/remotes/origin/main", candidate);
  assert.notEqual(
    spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/release-policy.mjs", import.meta.url),
        ),
        "promote",
        newer,
      ],
      { cwd },
    ).status,
    0,
  );
});
