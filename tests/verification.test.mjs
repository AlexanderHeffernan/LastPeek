import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/verify-release.mjs", import.meta.url),
);
const invoke = (args, env = {}) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

test("verification rejects partial release gates and unsafe focused selections before setup", () => {
  for (const args of [
    ["--browser", "webkit"],
    ["--test", "friends"],
    ["--focused"],
    ["--focused", "--test", "friends", "--browser", "safari"],
    ["--focused", "--file", "../tests/web.test.ts"],
    ["--focused", "--test", "["],
    ["--focused", "--test"],
  ]) {
    const result = invoke(args);
    assert.notEqual(result.status, 0, args.join(" "));
    assert.doesNotMatch(result.stdout, /> npm|\[timing\]/);
  }
  const remote = invoke(["--focused", "--test", "friends"], {
    DATABASE_URL: "postgres://example.invalid/production",
  });
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /local disposable PostgreSQL/);
});

test("verification help documents the isolated focused command without starting fixtures", () => {
  const result = invoke(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verify:focused/);
  assert.match(result.stdout, /never certify a release/);
  assert.doesNotMatch(result.stdout, /> npm|\[timing\]/);
});
