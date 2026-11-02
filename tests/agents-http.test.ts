import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { request } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../src/lib/server/db";
import { hash, token } from "../src/lib/server/auth";
import { agentScopes } from "../src/lib/agents";

const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
after(() => db.end());

// Wrong-client codes, stale versions, live permission reductions and revoked grants
// are the likely regressions. Use real OAuth HTTP and the official MCP client once,
// not one copy per browser engine.
test("agent OAuth binds grants and MCP preserves ownership, versions and review identity", async (t) => {
  const user = randomUUID(),
    stranger = randomUUID(),
    session = token();
  const browser = await request.newContext({
    extraHTTPHeaders: {
      Cookie: `lastpeek_session=${session}`,
      Origin: origin,
      Accept: "text/html",
    },
  });
  const anonymous = await request.newContext();
  const clients: Client[] = [];
  const registered: string[] = [];
  t.after(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await browser.dispose();
    await anonymous.dispose();
    await db.query("DELETE FROM notifications WHERE user_id=ANY($1::uuid[])", [
      [user, stranger],
    ]);
    await db.query("DELETE FROM drafts WHERE owner_id=ANY($1::uuid[])", [
      [user, stranger],
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [user, stranger],
    ]);
    await db.query("DELETE FROM agent_clients WHERE id=ANY($1::text[])", [
      registered,
    ]);
  });
  for (const id of [user, stranger])
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'unused')",
      [
        id,
        `${id}@example.test`,
        id === user ? "Actual reviewer" : "Other author",
      ],
    );
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [hash(session), user],
  );
  assert.equal(
    (await browser.get(`${origin}/settings?tab=agents`)).status(),
    404,
  );
  await db.query(
    "INSERT INTO feature_grants(user_id,feature) VALUES($1,'agents')",
    [user],
  );
  for (const path of [
    "/login",
    "/settings?tab=agents&/agent",
    "/oauth/authorize",
  ]) {
    for (const attackOrigin of [undefined, "null", "https://evil.test"]) {
      const headers: Record<string, string> = attackOrigin
        ? { Origin: attackOrigin }
        : {};
      assert.equal(
        (
          await anonymous.post(`${origin}${path}`, { form: {}, headers })
        ).status(),
        403,
        `${path} rejects ${attackOrigin ?? "missing"} Origin`,
      );
    }
  }
  const unauthorized = await browser.post(`${origin}/mcp`, { data: {} });
  assert.equal(
    unauthorized.status(),
    401,
    "browser session must not authorize MCP",
  );
  assert.match(
    unauthorized.headers()["www-authenticate"],
    /oauth-protected-resource/,
  );
  const resource = await anonymous.get(
    `${origin}/.well-known/oauth-protected-resource`,
  );
  assert.equal(resource.status(), 200);
  assert.equal((await resource.json()).resource, `${origin}/mcp`);
  const metadata = await anonymous.get(
    `${origin}/.well-known/oauth-authorization-server`,
  );
  assert.deepEqual((await metadata.json()).code_challenge_methods_supported, [
    "S256",
  ]);
  assert.equal(
    (
      await anonymous.post(`${origin}/oauth/register`, {
        data: {
          client_name: "Invalid",
          redirect_uris: ["http://example.test/callback"],
        },
      })
    ).status(),
    400,
  );
  const registration = await anonymous.post(`${origin}/oauth/register`, {
    data: {
      client_name: "HTTP test agent",
      redirect_uris: ["http://127.0.0.1:12345/callback"],
    },
  });
  assert.equal(registration.status(), 201);
  const { client_id } = await registration.json();
  registered.push(client_id);
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id,
    redirect_uri: "http://127.0.0.1:12345/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: "test-state",
    scope: agentScopes.join(" "),
    resource: `${origin}/mcp`,
  });
  assert.equal(
    (
      await browser.get(
        `${origin}/oauth/authorize?${params}&redirect_uri=https://evil.test`,
      )
    ).status(),
    200,
  ); // duplicate cannot replace the exact registered first value
  const invalid = new URLSearchParams(params);
  invalid.set("redirect_uri", "https://evil.test");
  assert.equal(
    (await browser.get(`${origin}/oauth/authorize?${invalid}`)).status(),
    400,
  );
  const approved = await browser.post(`${origin}/oauth/authorize?${params}`, {
    form: { scope: agentScopes.join(" "), expiry: "never" },
    maxRedirects: 0,
  });
  assert.equal(approved.status(), 303);
  const callback = new URL(approved.headers().location);
  assert.equal(callback.searchParams.get("state"), "test-state");
  const exchange = {
    grant_type: "authorization_code",
    client_id,
    code: callback.searchParams.get("code")!,
    code_verifier: verifier,
    redirect_uri: "http://127.0.0.1:12345/callback",
    resource: `${origin}/mcp`,
  };
  await db.query("DELETE FROM feature_grants WHERE user_id=$1", [user]);
  assert.equal(
    (
      await anonymous.post(`${origin}/oauth/token`, { form: exchange })
    ).status(),
    400,
    "a pending code cannot bypass trial access",
  );
  assert.equal(
    (await browser.get(`${origin}/oauth/authorize?${params}`)).status(),
    404,
  );
  assert.equal(
    (
      await browser.post(`${origin}/oauth/authorize?${params}`, {
        form: { scope: agentScopes.join(" ") },
      })
    ).status(),
    404,
  );
  await db.query(
    "INSERT INTO feature_grants(user_id,feature) VALUES($1,'agents')",
    [user],
  );
  assert.equal(
    (
      await anonymous.post(`${origin}/oauth/token`, {
        form: { ...exchange, client_id: "wrong" },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await anonymous.post(`${origin}/oauth/token`, {
        form: { ...exchange, code_verifier: "x".repeat(43) },
      })
    ).status(),
    400,
  );
  const exchanged = await anonymous.post(`${origin}/oauth/token`, {
    form: exchange,
  });
  assert.equal(exchanged.status(), 200);
  const credentials = await exchanged.json();
  await db.query("DELETE FROM feature_grants WHERE user_id=$1", [user]);
  assert.equal(
    (
      await anonymous.post(`${origin}/mcp`, {
        headers: { Authorization: `Bearer ${credentials.access_token}` },
        data: {},
      })
    ).status(),
    401,
    "removing trial access blocks already-issued bearer tokens",
  );
  assert.equal(
    (
      await anonymous.post(`${origin}/oauth/token`, {
        form: {
          grant_type: "refresh_token",
          client_id,
          refresh_token: credentials.refresh_token,
        },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await browser.post(`${origin}/settings?tab=agents&/agent`, {
        form: { intent: "disconnect", id: randomUUID() },
      })
    ).status(),
    404,
  );
  await db.query(
    "INSERT INTO feature_grants(user_id,feature) VALUES($1,'agents')",
    [user],
  );
  assert.equal(
    (
      await anonymous.post(`${origin}/oauth/token`, { form: exchange })
    ).status(),
    400,
    "authorization codes are single-use",
  );
  const client = new Client({ name: "Contract test", version: "1" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${credentials.access_token}` },
      },
    }),
  );
  const call = async (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const read = (result: Awaited<ReturnType<typeof call>>) =>
    JSON.parse((result.content as { text: string }[])[0].text);
  assert.ok(
    (await client.listTools()).tools.some(
      (tool) => tool.name === "create_draft",
    ),
  );
  const created = read(
    await call("create_draft", {
      posts: ["Opening post", "A different second post"],
    }),
  );
  assert.equal(created.content.posts.length, 2);
  const updated = [...created.content.posts];
  updated[1] = { ...updated[1], text: "Revised second post" };
  assert.equal(
    read(
      await call("update_draft", {
        id: created.id,
        version: 1,
        posts: updated,
      }),
    ).version,
    2,
  );
  const stale = await call("update_draft", {
    id: created.id,
    version: 1,
    posts: created.content.posts,
  });
  assert.equal(stale.isError, true);
  assert.match((stale.content as { text: string }[])[0].text, /409/);
  const foreign = randomUUID();
  await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
    foreign,
    stranger,
    JSON.stringify(created.content),
  ]);
  assert.equal((await call("get_draft", { id: foreign })).isError, true);
  const shared = read(
    await call("share_draft", { id: created.id, version: 2, audience: "link" }),
  );
  const feedback = read(
    await call("send_feedback", {
      token: shared.token,
      revision: shared.revision,
      body: "Make the opening sharper.",
      postId: created.content.posts[0].id,
      quote: "Opening",
    }),
  );
  const comment = (
    await db.query("SELECT user_id,name,revision FROM comments WHERE id=$1", [
      feedback.id,
    ])
  ).rows[0];
  assert.equal(comment.user_id, user);
  assert.equal(comment.name, "Actual reviewer");
  assert.equal(comment.revision, shared.revision);
  assert.equal(
    (
      await call("send_feedback", {
        token: shared.token,
        revision: shared.revision,
        body: "Invalid quote",
        postId: created.content.posts[0].id,
        quote: "Not in post",
      })
    ).isError,
    true,
  );
  const privateToken = token();
  await db.query(
    "INSERT INTO revisions(draft_id,number,content) VALUES($1,1,$2)",
    [foreign, JSON.stringify(created.content)],
  );
  await db.query(
    "UPDATE drafts SET friend_token=$1,shared_revision=1 WHERE id=$2",
    [privateToken, foreign],
  );
  assert.equal(
    (await call("get_review", { token: privateToken })).isError,
    true,
    "knowing a private review token is not access",
  );
  assert.equal(
    (
      await call("send_feedback", {
        token: privateToken,
        revision: 1,
        body: "Must not be sent",
      })
    ).isError,
    true,
  );
  const friendship = randomUUID();
  await db.query(
    "INSERT INTO friendships(id,requester_id,recipient_id,accepted_at) VALUES($1,$2,$3,now())",
    [friendship, stranger, user],
  );
  await db.query(
    "INSERT INTO friend_reviews(draft_id,recipient_id,friendship_id) VALUES($1,$2,$3)",
    [foreign, user, friendship],
  );
  assert.equal(
    read(await call("get_review", { token: privateToken })).revision,
    1,
  );
  await db.query("DELETE FROM friend_reviews WHERE draft_id=$1", [foreign]);
  assert.equal(
    (await call("get_review", { token: privateToken })).isError,
    true,
    "revoked private grants apply to agent reads",
  );
  const connection = (
    await db.query(
      "SELECT id,last_used_at FROM agent_connections WHERE user_id=$1",
      [user],
    )
  ).rows[0];
  assert.ok(connection.last_used_at);
  const reduced = await browser.post(`${origin}/settings?tab=agents&/agent`, {
    form: { id: connection.id, scope: "drafts:read" },
  });
  assert.equal(reduced.status(), 200);
  assert.equal(
    (
      await db.query("SELECT expires_at FROM agent_connections WHERE id=$1", [
        connection.id,
      ])
    ).rows[0].expires_at,
    null,
    "permission-only saves preserve indefinite access",
  );
  for (const expiry of ["30", "90", "365", "never"]) {
    const before = Date.now();
    const changed = await browser.post(`${origin}/settings?tab=agents&/agent`, {
      form: { id: connection.id, scope: "drafts:read", expiry },
    });
    assert.equal(changed.status(), 200);
    const date = (
      await db.query("SELECT expires_at FROM agent_connections WHERE id=$1", [
        connection.id,
      ])
    ).rows[0].expires_at;
    if (expiry === "never") assert.equal(date, null);
    else {
      const lifetime = Number(expiry) * 24 * 60 * 60 * 1000;
      assert.ok(
        date.getTime() >= before + lifetime &&
          date.getTime() <= Date.now() + lifetime,
      );
    }
  }
  assert.equal(
    (
      await browser.post(`${origin}/settings?tab=agents&/agent`, {
        form: { id: connection.id, scope: "drafts:read", expiry: "0" },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await db.query("SELECT expires_at FROM agent_connections WHERE id=$1", [
        connection.id,
      ])
    ).rows[0].expires_at,
    null,
  );
  assert.equal(
    (await call("create_draft", { posts: ["Must not be created"] })).isError,
    true,
  );
  assert.deepEqual(
    (await client.listTools()).tools.map((tool) => tool.name).sort(),
    ["get_draft", "list_drafts"],
  );
  const refreshed = await anonymous.post(`${origin}/oauth/token`, {
    form: {
      grant_type: "refresh_token",
      client_id,
      refresh_token: credentials.refresh_token,
      resource: `${origin}/mcp`,
    },
  });
  assert.equal(refreshed.status(), 200);
  const renewed = await refreshed.json();
  assert.equal(renewed.scope, "drafts:read");
  assert.equal(renewed.expires_in, 3600);
  assert.equal(
    (
      await anonymous.post(`${origin}/oauth/token`, {
        form: {
          grant_type: "refresh_token",
          client_id,
          refresh_token: credentials.refresh_token,
        },
      })
    ).status(),
    400,
  );
  // Control the connection deadline independently of still-valid access/refresh credentials.
  await db.query(
    "UPDATE agent_connections SET expires_at=now()-interval '1 second' WHERE id=$1",
    [connection.id],
  );
  assert.equal(
    (
      await anonymous.get(`${origin}/mcp`, {
        headers: { Authorization: `Bearer ${renewed.access_token}` },
      })
    ).status(),
    401,
  );
  assert.equal(
    (
      await anonymous.post(`${origin}/oauth/token`, {
        form: {
          grant_type: "refresh_token",
          client_id,
          refresh_token: renewed.refresh_token,
        },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await browser.post(`${origin}/settings?tab=agents&/agent`, {
        form: { id: connection.id, scope: "drafts:read", expiry: "never" },
      })
    ).status(),
    400,
    "expired connections cannot be resurrected from Settings",
  );
  await db.query("UPDATE agent_connections SET expires_at=NULL WHERE id=$1", [
    connection.id,
  ]);
  await browser.post(`${origin}/settings?tab=agents&/agent`, {
    form: { id: connection.id, intent: "disconnect" },
  });
  assert.equal(
    (
      await anonymous.post(`${origin}/mcp`, {
        data: {},
        headers: { Authorization: `Bearer ${credentials.access_token}` },
      })
    ).status(),
    401,
  );
});
