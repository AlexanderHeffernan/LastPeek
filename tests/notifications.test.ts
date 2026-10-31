import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createECDH, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import webpush from "web-push";

test("notification outbox persists, retries, honors preferences and drops revoked sessions", async (t) => {
  const original = process.env.DATABASE_URL!;
  const schema = `notifications_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: original });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(original);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = connection.href;
  const { db, transaction } = await import("../src/lib/server/db");
  const { notify, deliverPush, pushKeys } =
    await import("../src/lib/server/notifications");
  t.after(async () => {
    t.mock.restoreAll();
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.env.DATABASE_URL = original;
  });
  for (const name of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.query(await readFile(`migrations/${name}`, "utf8"));
  const [user, actor] = [randomUUID(), randomUUID()];
  for (const id of [user, actor])
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Private name','unused')",
      [id, `${id}@example.test`],
    );
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES('live',$1,now()+interval '1 day')",
    [user],
  );
  const browserKey = createECDH("prime256v1");
  browserKey.generateKeys();
  const keys = {
    p256dh: browserKey.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
  const endpoints = ["ok", "retry", "gone", "expired", "auth"];
  await db.query(
    `INSERT INTO auth_sessions(id,token,"userId","expiresAt") VALUES('live-auth','secret',$1,now()+interval '1 day')`,
    [user],
  );
  for (const endpoint of endpoints)
    await db.query(
      "INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        user,
        endpoint === "expired"
          ? "legacy:revoked"
          : endpoint === "auth"
            ? "auth:live-auth"
            : "legacy:live",
        `https://fcm.googleapis.com/${endpoint}`,
        keys.p256dh,
        keys.auth,
      ],
    );
  await assert.rejects(
    transaction(async (client) => {
      await notify(client, { userId: user, actorId: actor, kind: "feedback" });
      throw new Error("rollback");
    }),
  );
  assert.equal((await db.query("SELECT * FROM notifications")).rowCount, 0);
  await transaction(async (client) => {
    await notify(client, {
      userId: user,
      actorId: user,
      kind: "friend_accepted",
    });
    await notify(client, {
      userId: user,
      actorId: actor,
      kind: "friend_request",
    });
  });
  assert.equal((await db.query("SELECT * FROM notifications")).rowCount, 1);
  assert.equal((await db.query("SELECT * FROM push_deliveries")).rowCount, 5);
  const vapid = await pushKeys();
  assert.deepEqual(await pushKeys(), vapid);
  const payloads: string[] = [];
  const successful = { statusCode: 201, body: "", headers: {} };
  const transport = t.mock.method(
    webpush,
    "sendNotification",
    async (
      subscription: webpush.PushSubscription,
      payload?: string | Buffer | null,
    ) => {
      if (subscription.endpoint.endsWith("/gone")) throw { statusCode: 410 };
      if (subscription.endpoint.endsWith("/retry")) throw { statusCode: 503 };
      payloads.push(String(payload));
      return successful;
    },
  );
  await deliverPush();
  assert.equal(
    (
      await db.query(
        "SELECT * FROM push_subscriptions WHERE endpoint LIKE '%/gone'",
      )
    ).rowCount,
    0,
  );
  const pending = (
    await db.query(
      "SELECT attempts,due_at>now() AS delayed FROM push_deliveries",
    )
  ).rows;
  assert.deepEqual(pending, [{ attempts: 1, delayed: true }]);
  assert.equal(
    payloads.length,
    2,
    "Both valid session formats deliver; revoked sessions do not.",
  );
  for (const payload of payloads) {
    assert.equal(JSON.parse(payload).body, "You received a friend request.");
    assert.ok(!payload.includes("Private name"));
    assert.ok(!payload.includes("/r/"));
  }
  // The actual Web Push implementation encrypts the generic payload for the device.
  const encrypted = webpush.generateRequestDetails(
    { endpoint: "https://fcm.googleapis.com/ok", keys },
    payloads[0],
    { vapidDetails: { ...vapid, subject: "https://example.test" } },
  );
  assert.ok(
    encrypted.body && !encrypted.body.includes(Buffer.from(payloads[0])),
  );
  transport.mock.mockImplementation(async () => successful);
  await db.query("UPDATE push_deliveries SET due_at=now()");
  await deliverPush();
  assert.equal((await db.query("SELECT * FROM push_deliveries")).rowCount, 0);
  await transaction((client) =>
    notify(client, { userId: user, actorId: actor, kind: "feedback" }),
  );
  await db.query(
    "INSERT INTO notification_preferences(user_id,feedback) VALUES($1,false)",
    [user],
  );
  await deliverPush();
  assert.equal(
    (await db.query("SELECT * FROM push_deliveries")).rowCount,
    0,
    "Disabling a type cancels pending pushes too.",
  );
  const before = (await db.query("SELECT * FROM notifications")).rowCount;
  await transaction((client) =>
    notify(client, { userId: user, actorId: actor, kind: "feedback" }),
  );
  assert.equal(
    (await db.query("SELECT * FROM notifications")).rowCount,
    before,
  );
});
