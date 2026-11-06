import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { request } from "playwright";
import { db } from "../src/lib/server/db";
import { hash, token, passwordHash } from "../src/lib/server/auth";

const origin = process.env.TEST_BASE_URL!;
after(() => db.end());

test("native auth binds single-use invitations and closes alternate signup endpoints", async (t) => {
  const owner = randomUUID(),
    invite = token(),
    email = `${randomUUID()}@example.test`;
  const client = await request.newContext({
    extraHTTPHeaders: { Origin: origin, Accept: "text/html" },
  });
  t.after(async () => {
    await client.dispose();
    await db.query("DELETE FROM invites WHERE created_by=$1", [owner]);
    await db.query("DELETE FROM users WHERE id=$1 OR email=$2", [owner, email]);
  });
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Inviter','unused')",
    [owner, `${owner}@example.test`],
  );
  await db.query(
    "INSERT INTO invites(id,hash,created_by,email,plan,expires_at) VALUES($1,$2,$3,$4,'free',now()+interval '1 day')",
    [randomUUID(), hash(invite), owner, email],
  );
  const password = token();
  const form = { name: "Invited writer", email, password };
  assert.equal(
    (
      await client.post(`${origin}/join/${invite}`, {
        form: { ...form, email: `${owner}@example.test` },
      })
    ).status(),
    400,
  );
  assert.equal(
    (await client.post(`${origin}/join/${token()}`, { form })).status(),
    400,
  );
  assert.equal(
    (
      await client.post(`${origin}/join/${invite}`, { form, maxRedirects: 0 })
    ).status(),
    303,
  );
  assert.ok(
    (
      await db.query("SELECT used_at FROM invites WHERE hash=$1", [
        hash(invite),
      ])
    ).rows[0].used_at,
  );
  // A fresh anonymous request cannot consume the same invitation again.
  assert.equal(
    (
      await client.post(`${origin}/join/${invite}`, {
        headers: { Cookie: "" },
        form,
      })
    ).status(),
    400,
  );
  for (const path of ["sign-up/email", "sign-in/email", "change-password"]) {
    assert.equal(
      (
        await client.post(`${origin}/api/auth/${path}`, {
          data: { email, password, name: "Bypass" },
        })
      ).status(),
      404,
    );
  }
  assert.equal(
    (
      await client.post(`${origin}/login/dev`, {
        headers: { Cookie: "" },
        form: {},
      })
    ).status(),
    404,
  );
});

test("password change and CLI reset invalidate modern and legacy sessions", async (t) => {
  const id = randomUUID(),
    email = `${id}@example.test`,
    password = token(),
    next = token(),
    reset = token();
  const clients = await Promise.all(
    [0, 1].map(() =>
      request.newContext({
        extraHTTPHeaders: { Origin: origin, Accept: "text/html" },
      }),
    ),
  );
  const [current, other] = clients;
  t.after(async () => {
    await Promise.all(clients.map((client) => client.dispose()));
    await db.query("DELETE FROM users WHERE id=$1", [id]);
  });
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Author',$3)",
    [id, email, await passwordHash(password)],
  );
  const login = (client: typeof current, value: string) =>
    client.post(`${origin}/login`, {
      form: { email, password: value },
      maxRedirects: 0,
    });
  for (const client of clients)
    assert.equal((await login(client, password)).status(), 303);
  const legacy = token();
  const seedLegacy = () =>
    db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(legacy), id],
    );
  const legacyAccess = () =>
    other.get(`${origin}/settings`, {
      headers: { Cookie: `lastpeek_session=${legacy}` },
      maxRedirects: 0,
    });
  await seedLegacy();
  assert.equal((await legacyAccess()).status(), 200);
  assert.equal(
    (
      await current.post(`${origin}/settings?/password`, {
        form: { current: "incorrect", password: next },
      })
    ).status(),
    400,
  );
  assert.equal((await other.get(`${origin}/settings`)).status(), 200);
  assert.equal(
    (
      await current.post(`${origin}/settings?/password`, {
        form: { current: password, password: next },
      })
    ).status(),
    200,
  );
  assert.equal(
    (await other.get(`${origin}/settings`, { maxRedirects: 0 })).status(),
    303,
  );
  assert.equal((await legacyAccess()).status(), 303);
  assert.equal((await current.get(`${origin}/settings`)).status(), 200);
  assert.equal((await login(other, password)).status(), 400);
  assert.equal((await login(other, next)).status(), 303);
  await seedLegacy();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/reset-password.ts", email],
      { stdio: ["pipe", "ignore", "inherit"] },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Password reset failed (${code})`)),
    );
    child.stdin.end(`${reset}\n`);
  });
  for (const client of clients)
    assert.equal(
      (await client.get(`${origin}/settings`, { maxRedirects: 0 })).status(),
      303,
    );
  assert.equal((await legacyAccess()).status(), 303);
  assert.equal((await login(other, next)).status(), 400);
  assert.equal((await login(other, reset)).status(), 303);
});
