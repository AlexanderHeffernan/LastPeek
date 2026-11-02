import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

test("browser sessions protect owners and current sessions across both authentication formats", async (t) => {
  const original = process.env.DATABASE_URL!;
  const admin = new pg.Pool({ connectionString: original });
  const schema = `sessions_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(original);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = connection.href;
  const { db } = await import("../src/lib/server/db");
  const { browserSessions, recordBrowserSession, revokeBrowserSessions } =
    await import("../src/lib/server/browser-sessions");
  t.after(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.env.DATABASE_URL = original;
  });
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.query(await readFile(`migrations/${name}`, "utf8"));
  const owner = randomUUID(),
    stranger = randomUUID();
  for (const id of [owner, stranger])
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Session author','unused')",
      [id, `${id}@example.test`],
    );
  const auth = randomUUID(),
    otherAuth = randomUUID(),
    foreign = randomUUID();
  for (const [id, user] of [
    [auth, owner],
    [otherAuth, owner],
    [foreign, stranger],
  ])
    await db.query(
      `INSERT INTO auth_sessions(id,token,"userId","expiresAt","userAgent") VALUES($1,$2,$3,now()+interval '1 day',$4)`,
      [id, `secret-${id}`, user, "Mozilla/5.0 (Windows NT 10.0) Firefox/145.0"],
    );
  const legacy = "private-legacy-hash",
    expired = "expired-hash";
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at,created_at) VALUES($1,$2,now()+interval '1 day',NULL),($3,$2,now()-interval '1 day',NULL)",
    [legacy, owner, expired],
  );
  const current = `auth:${auth}`;
  await recordBrowserSession(current, owner, "ignored");
  const list = await browserSessions(owner, current);
  assert.equal(list.length, 3);
  assert.equal(list[0].id, current);
  assert.equal(list[0].current, true);
  assert.equal(list[0].label, "Firefox on Windows");
  assert.ok(list[0].lastUsedAt);
  assert.equal(list.filter((s) => s.current).length, 1);
  assert.equal(JSON.stringify(list).includes("secret-"), false);
  assert.equal(JSON.stringify(list).includes(legacy), false);
  const older = list.find((s) => s.id.startsWith("legacy:"))!;
  assert.equal(older.label, "Unknown browser");
  assert.equal(older.createdAt, undefined);
  assert.equal(older.lastUsedAt, undefined);
  for (const target of [current, `auth:${foreign}`, `legacy:${randomUUID()}`])
    await assert.rejects(revokeBrowserSessions(owner, current, target), {
      status: 404,
    });
  await revokeBrowserSessions(owner, current, `auth:${otherAuth}`);
  assert.equal((await browserSessions(owner, current)).length, 2);
  await revokeBrowserSessions(owner, current, older.id);
  assert.equal((await browserSessions(owner, current)).length, 1);
  // Recreate a legacy current session, then revoke modern sessions from it.
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [legacy, owner],
  );
  await recordBrowserSession(
    `legacy:${legacy}`,
    owner,
    "Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/605.1.15",
  );
  const legacyList = await browserSessions(owner, `legacy:${legacy}`);
  assert.equal(legacyList[0].label, "Safari on iOS");
  assert.equal(legacyList[0].current, true);
  await revokeBrowserSessions(owner, `legacy:${legacy}`, "others");
  assert.deepEqual(
    (await browserSessions(owner, `legacy:${legacy}`)).map((s) => s.current),
    [true],
  );
  assert.equal((await browserSessions(stranger, `auth:${foreign}`)).length, 1);
  await assert.rejects(revokeBrowserSessions(owner, current, "others"), {
    status: 401,
  });
  // The opposite direction must also keep only the modern requesting session.
  await db.query(
    `INSERT INTO auth_sessions(id,token,"userId","expiresAt") VALUES($1,'new-secret',$2,now()+interval '1 day')`,
    [auth, owner],
  );
  await revokeBrowserSessions(owner, current, "others");
  assert.deepEqual(
    (await browserSessions(owner, current)).map((s) => s.id),
    [current],
  );
  // Two browsers cannot both succeed at retaining themselves while revoking
  // the other. One wins; the revoked caller must reauthenticate.
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [legacy, owner],
  );
  const concurrent = await Promise.allSettled([
    revokeBrowserSessions(owner, current, "others"),
    revokeBrowserSessions(owner, `legacy:${legacy}`, "others"),
  ]);
  assert.equal(
    concurrent.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = concurrent.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason.status, 401);
  assert.equal((await browserSessions(owner, current)).length, 1);
});
