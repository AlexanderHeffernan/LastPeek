import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "playwright";
import { db } from "../src/lib/server/db";
import { hash, token } from "../src/lib/server/auth";
import { blankContent } from "../src/lib/contracts";

const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
after(() => db.end());

test("personalisation belongs to the signed-in account and rejects invalid appearances", async (t) => {
  const owner = randomUUID(),
    other = randomUUID(),
    session = token();
  const author = await request.newContext({
    extraHTTPHeaders: {
      Cookie: `lastpeek_session=${session}; lastpeek_theme=dark`,
      Origin: origin,
    },
  });
  t.after(async () => {
    await author.dispose();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, other],
    ]);
  });
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,theme) VALUES($1,$2,'Owner','unused','auto'),($3,$4,'Other','unused','dark')",
    [owner, `${owner}@example.test`, other, `${other}@example.test`],
  );
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [hash(session), owner],
  );
  const page = `${origin}/settings?tab=personalisation`;
  assert.match(
    await (await author.get(page)).text(),
    /<html[^>]+data-theme="auto"/,
  );
  const saved = await author.post(`${origin}/settings?/personalisation`, {
    form: { theme: "light", userId: other },
  });
  assert.equal(saved.status(), 200);
  assert.match(
    await (await author.get(page)).text(),
    /<html[^>]+data-theme="light"/,
  );
  for (const [id, expected] of [
    [owner, "light"],
    [other, "dark"],
  ])
    assert.equal(
      (await db.query("SELECT theme FROM users WHERE id=$1", [id])).rows[0]
        .theme,
      expected,
    );
  const invalid = await author.post(`${origin}/settings?/personalisation`, {
    form: { theme: '<script>alert("theme")</script>' },
  });
  assert.equal(invalid.status(), 400);
  assert.equal(
    (await db.query("SELECT theme FROM users WHERE id=$1", [owner])).rows[0]
      .theme,
    "light",
  );
  const anonymous = await author.get(`${origin}/login`, {
    headers: { Cookie: "lastpeek_theme=%22%3E%3Cscript%3E" },
  });
  assert.match(await anonymous.text(), /<html[^>]+data-theme="auto"/);
});

test("guest account requests are same-origin, private and never grant access", async (t) => {
  const email = `${randomUUID()}@example.test`;
  const client = await request.newContext();
  const owner = process.env.LASTPEEK_OWNER_ID!,
    admin = randomUUID();
  const ownerSession = token(),
    adminSession = token();
  assert.ok(owner, "Use an unused test owner UUID, never a real account.");
  assert.equal(
    (await db.query("SELECT 1 FROM users WHERE id=$1", [owner])).rowCount,
    0,
  );
  t.after(async () => {
    await client.dispose();
    await db.query("DELETE FROM account_requests WHERE email=$1", [email]);
    await db.query("DELETE FROM invites WHERE created_by=$1", [owner]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, admin],
    ]);
  });
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,is_admin) VALUES($1,$2,'Owner','unused',true),($3,$4,'Admin','unused',true)",
    [owner, `${owner}@example.test`, admin, `${admin}@example.test`],
  );
  for (const [id, session] of [
    [owner, ownerSession],
    [admin, adminSession],
  ])
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(session), id],
    );
  const endpoint = `${origin}/api/account-requests`;
  const rejected = await client.post(endpoint, {
    headers: { Origin: "https://untrusted.example" },
    data: { name: "Intruder", email },
  });
  assert.equal(rejected.status(), 403);
  const bad = await client.post(endpoint, {
    headers: { Origin: origin },
    data: { name: " ", email },
  });
  assert.equal(bad.status(), 400);
  for (const name of ["  Guest  ", "Duplicate"]) {
    const response = await client.post(endpoint, {
      headers: { Origin: origin },
      data: { name, email: email.toUpperCase() },
    });
    assert.equal(response.status(), 200);
    assert.deepEqual(await response.json(), { received: true });
  }
  assert.deepEqual(
    (
      await db.query("SELECT email,name FROM account_requests WHERE email=$1", [
        email,
      ])
    ).rows,
    [{ email, name: "Guest" }],
  );
  // The public landing page joins the same waitlist with an email alone.
  const waitlisted = `waitlist-${randomUUID()}@example.test`;
  const joined = await client.post(endpoint, {
    headers: { Origin: origin },
    data: { email: waitlisted },
  });
  assert.equal(joined.status(), 200);
  assert.equal(
    (
      await client.post(endpoint, {
        headers: { Origin: origin },
        data: { email: "not-an-email" },
      })
    ).status(),
    400,
  );
  // Only signed-out / is indexable; the signed-in home stays private.
  const landing = await client.get(`${origin}/`, { maxRedirects: 0 });
  assert.equal(landing.status(), 200);
  assert.equal(landing.headers()["x-robots-tag"], undefined);
  const landingHTML = await landing.text();
  assert.match(landingHTML, /Join the waitlist/);
  // Shared site links use the static card, not the on-page walkthrough video.
  assert.match(
    landingHTML,
    /property="og:image" content="[^"]+\/landing\/og.png"/,
  );
  assert.match(
    landingHTML,
    /name="twitter:card" content="summary_large_image"/,
  );
  assert.doesNotMatch(landingHTML, /property="og:video|name="twitter:player/);
  assert.equal((landingHTML.match(/name="description"/g) ?? []).length, 1);
  assert.match(landingHTML, /rel="canonical"/);
  const image = await client.get(`${origin}/landing/og.png`);
  assert.equal(image.status(), 200);
  assert.match(image.headers()["content-type"], /image\/png/);
  const loginPage = await client.get(`${origin}/login`);
  assert.match(loginPage.headers()["x-robots-tag"], /noindex/);
  assert.equal(
    ((await loginPage.text()).match(/name="description"/g) ?? []).length,
    1,
  );
  const robots = await client.get(`${origin}/robots.txt`);
  assert.match(await robots.text(), /Disallow: \/\n/);
  const sitemap = await client.get(`${origin}/sitemap.xml`);
  assert.equal(sitemap.status(), 200);
  assert.equal(((await sitemap.text()).match(/<loc>/g) ?? []).length, 1);
  const home = await client.get(`${origin}/`, {
    maxRedirects: 0,
    headers: { Cookie: `lastpeek_session=${ownerSession}` },
  });
  assert.equal(home.status(), 200);
  assert.match(home.headers()["x-robots-tag"], /noindex/);
  assert.doesNotMatch(await home.text(), /Join the waitlist/);
  assert.equal(
    (await db.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount,
    0,
  );
  assert.equal((await client.get(endpoint)).status(), 405);
  assert.equal(
    (await client.get(`${origin}/siteadmin/snapshot`)).status(),
    404,
  );
  const queue = async (session: string) => {
    const response = await client.get(
      `${origin}/siteadmin/snapshot?view=invitations`,
      { headers: { Cookie: `lastpeek_session=${session}` } },
    );
    assert.equal(response.status(), 200);
    return (await response.json()).accountRequests;
  };
  assert.deepEqual(
    (await queue(ownerSession)).map(
      ({ email, name }: { email: string; name: string }) => ({ email, name }),
    ),
    [
      { email: waitlisted, name: null },
      { email, name: "Guest" },
    ],
  );
  assert.deepEqual(
    await queue(adminSession),
    [],
    "Only the owner sees prospective users' email addresses.",
  );
  const invitation = await client.post(`${origin}/siteadmin/snapshot`, {
    headers: { Origin: origin, Cookie: `lastpeek_session=${ownerSession}` },
    data: { action: "invite", email, plan: "free" },
  });
  assert.equal(invitation.status(), 200);
  assert.deepEqual(
    (await queue(ownerSession)).map(({ email }: { email: string }) => email),
    [waitlisted],
    "An issued invitation clears that request from the queue.",
  );
});

// A stale manually entered handle and a forged form must never override the
// connected account. Disconnect changes working identity, not old revisions.
test("settings identity follows connected X without rewriting shared history", async (t) => {
  const user = randomUUID(),
    draft = randomUUID(),
    session = token();
  const author = await request.newContext({
    extraHTTPHeaders: {
      Cookie: `lastpeek_session=${session}`,
      Origin: origin,
    },
  });
  t.after(async () => {
    await author.dispose();
    await db.query("DELETE FROM drafts WHERE owner_id=$1", [user]);
    await db.query("DELETE FROM users WHERE id=$1", [user]);
  });
  await db.query(
    "INSERT INTO users(id,email,name,handle,password_hash) VALUES($1,$2,'Author','stale_handle','unused')",
    [user, `${user}@example.test`],
  );
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [hash(session), user],
  );
  const content = blankContent("Author", "forged_handle");
  content.posts[0].text = "A real working draft";
  await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
    draft,
    user,
    content,
  ]);
  const save = async (version: number, handle: string) => {
    const response = await author.post(`${origin}/api/drafts/${draft}`, {
      data: { action: "save", version, content },
    });
    assert.equal(response.status(), 200);
    const saved = (
      await db.query("SELECT content FROM drafts WHERE id=$1", [draft])
    ).rows[0].content;
    assert.equal(saved.author.handle, handle);
    return saved;
  };
  await save(1, "");
  await db.query(
    "INSERT INTO x_accounts(user_id,x_id,access_token,expires_at,scope,profile) VALUES($1,$2,'unused',now()+interval '1 day','users.read',$3)",
    [
      user,
      randomUUID(),
      { id: "123", username: "connected_x", name: "X name" },
    ],
  );
  const profile = await author.post(`${origin}/settings?/profile`, {
    form: { name: "New name", handle: "forged_handle" },
  });
  assert.equal(profile.status(), 200);
  const connected = await save(2, "connected_x");
  assert.equal(connected.author.name, "New name");
  const published = await author.post(`${origin}/api/drafts/${draft}`, {
    data: { action: "publish", version: 3 },
  });
  assert.equal(published.status(), 200);
  const before = (
    await db.query(
      "SELECT content FROM revisions WHERE draft_id=$1 AND number=1",
      [draft],
    )
  ).rows[0].content;
  assert.equal(before.author.handle, "connected_x");
  assert.equal(
    (
      await author.post(`${origin}/settings?/disconnectX`, { form: {} })
    ).status(),
    200,
  );
  await save(3, "");
  const after = (
    await db.query(
      "SELECT content FROM revisions WHERE draft_id=$1 AND number=1",
      [draft],
    )
  ).rows[0].content;
  assert.deepEqual(after, before);
});

test("security session actions require owner, origin and explicit confirmation", async (t) => {
  const owner = randomUUID(),
    stranger = randomUUID();
  const current = token(),
    other = token(),
    foreign = token();
  const client = await request.newContext({
    extraHTTPHeaders: {
      Cookie: `lastpeek_session=${current}`,
      Origin: origin,
      Accept: "text/html",
    },
  });
  t.after(async () => {
    await client.dispose();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, stranger],
    ]);
  });
  for (const id of [owner, stranger])
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Session author','unused')",
      [id, `${id}@example.test`],
    );
  for (const [value, id] of [
    [current, owner],
    [other, owner],
    [foreign, stranger],
  ])
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(value), id],
    );
  const ids = (
    await db.query(
      "SELECT id::text,hash FROM sessions WHERE user_id=ANY($1::uuid[])",
      [[owner, stranger]],
    )
  ).rows;
  const target = (value: string) =>
    `legacy:${ids.find((row) => row.hash === hash(value))!.id}`;
  const action = `${origin}/settings?/revokeSession`;
  for (const invalidOrigin of ["https://elsewhere.example", "null", ""]) {
    const denied = await client.post(action, {
      form: { session: target(other), confirmed: "yes" },
      headers: { Origin: invalidOrigin },
    });
    assert.equal(denied.status(), 403);
  }
  for (const value of [current, foreign]) {
    const denied = await client.post(action, {
      form: { session: target(value), confirmed: "yes" },
    });
    assert.equal(denied.status(), 404);
  }
  const unconfirmed = await client.post(action, {
    form: { session: target(other) },
  });
  assert.equal(unconfirmed.status(), 200);
  assert.ok((await unconfirmed.text()).includes("Sign out browser"));
  assert.equal(
    (await db.query("SELECT 1 FROM sessions WHERE hash=$1", [hash(other)]))
      .rowCount,
    1,
  );
  const listed = await client.get(`${origin}/settings?tab=security`);
  const html = await listed.text();
  for (const value of [
    current,
    other,
    hash(current),
    hash(other),
    foreign,
    hash(foreign),
  ])
    assert.equal(
      html.includes(value),
      false,
      "Session capabilities never enter Settings HTML.",
    );
  const revoked = await client.post(action, {
    form: { session: target(other), confirmed: "yes" },
  });
  assert.equal(revoked.status(), 200);
  const blocked = await client.get(`${origin}/settings`, {
    headers: { Cookie: `lastpeek_session=${other}` },
    maxRedirects: 0,
  });
  assert.equal(blocked.status(), 303);
  const remaining = await client.post(action, {
    form: { session: "others", confirmed: "yes" },
  });
  assert.equal(remaining.status(), 200);
  assert.equal(
    (await client.get(`${origin}/settings?tab=security`)).status(),
    200,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM sessions WHERE hash=$1", [hash(foreign)]))
      .rowCount,
    1,
  );
});
