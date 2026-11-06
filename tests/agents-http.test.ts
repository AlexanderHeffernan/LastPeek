import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { request } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../src/lib/server/db";
import { hash, token } from "../src/lib/server/auth";
import { agentScopes, expandAgentScopes } from "../src/lib/agents";
import { blankContent } from "../src/lib/contracts";
import sharp from "sharp";
import { readFile, rm } from "node:fs/promises";
import { mediaPath } from "../src/lib/server/media";

const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
after(() => db.end());

test("agent sharing separates review links from people and preserves legacy grant reductions", async (t) => {
  const owner = randomUUID(),
    friend = randomUUID(),
    draft = randomUUID();
  const app = token(),
    connection = randomUUID(),
    bearer = token(),
    refresh = token(),
    session = token();
  const pendingCode = token(),
    verifier = token();
  const client = new Client({ name: "Sharing contract", version: "1" });
  const http = await request.newContext({
    extraHTTPHeaders: { Cookie: `lastpeek_session=${session}`, Origin: origin },
  });
  t.after(async () => {
    await client.close();
    await http.dispose();
    await db.query("DELETE FROM drafts WHERE id=$1", [draft]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, friend],
    ]);
    await db.query("DELETE FROM agent_clients WHERE id=$1", [app]);
  });
  for (const id of [owner, friend])
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'unused')",
      [id, `${id}@example.test`, id === owner ? "Owner" : "Friend"],
    );
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [hash(session), owner],
  );
  await db.query(
    "INSERT INTO feature_grants(user_id,feature) VALUES($1,'agents')",
    [owner],
  );
  await db.query(
    "INSERT INTO friendships(id,requester_id,recipient_id,accepted_at) VALUES($1,$2,$3,now())",
    [randomUUID(), owner, friend],
  );
  const content = blankContent("Owner");
  content.posts[0].text = "Only share this with the chosen audience.";
  await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
    draft,
    owner,
    JSON.stringify(content),
  ]);
  await db.query(
    "INSERT INTO agent_clients(id,name,redirect_uris) VALUES($1,'Sharing agent',$2)",
    [app, JSON.stringify([`${origin}/settings`])],
  );
  await db.query(
    "INSERT INTO agent_connections(id,user_id,client_id,scopes,approved_scopes) VALUES($1,$2,$3,'{drafts:share}','{drafts:share}')",
    [connection, owner, app],
  );
  for (const [value, kind] of [
    [bearer, "access"],
    [refresh, "refresh"],
  ])
    await db.query(
      "INSERT INTO agent_tokens(hash,connection_id,kind,scopes,resource,expires_at) VALUES($1,$2,$3,'{drafts:share}',$4,now()+interval '1 day')",
      [hash(value), connection, kind, `${origin}/mcp`],
    );
  await db.query(
    "INSERT INTO agent_codes(hash,connection_id,redirect_uri,challenge,resource,scopes) VALUES($1,$2,$3,$4,$5,'{drafts:share}')",
    [
      hash(pendingCode),
      connection,
      `${origin}/settings`,
      createHash("sha256").update(verifier).digest("base64url"),
      `${origin}/mcp`,
    ],
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  );
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const read = (result: Awaited<ReturnType<typeof call>>) => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return (result.structuredContent as any).result;
  };
  const denied = (result: Awaited<ReturnType<typeof call>>) => {
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as any).error.status, 403);
  };
  const shareLink = { id: draft, version: 1, audience: "link" };
  const shareFriend = {
    id: draft,
    version: 1,
    audience: "friend",
    friendId: friend,
  };
  const link = read(await call("share_draft", shareLink));
  const invitation = read(await call("share_draft", shareFriend));
  const both = read(await call("get_sharing", { id: draft }));
  assert.equal(both.audience, "both");
  assert.equal(both.linkUrl, `${origin}/r/${link.token}`);
  assert.equal(both.friendUrl, `${origin}/r/${invitation.token}`);
  assert.equal(
    read(await call("get_sharing", { id: draft })).recipients[0].id,
    friend,
  );

  // The same old credential must obey either narrower selection immediately.
  const select = async (scope: string) => {
    const response = await http.post(`${origin}/settings?tab=agents&/agent`, {
      form: { id: connection, scope },
    });
    assert.equal(response.status(), 200);
    assert.equal(
      (
        await db.query(
          "SELECT requested_scopes FROM agent_connections WHERE id=$1",
          [connection],
        )
      ).rows[0].requested_scopes,
      null,
    );
  };
  await select("sharing:links");
  const exchanged = await http.post(`${origin}/oauth/token`, {
    form: {
      grant_type: "authorization_code",
      client_id: app,
      code: pendingCode,
      code_verifier: verifier,
      redirect_uri: `${origin}/settings`,
    },
  });
  assert.equal(exchanged.status(), 200);
  const codeCredentials = await exchanged.json();
  assert.equal(codeCredentials.scope, "sharing:links");
  assert.equal(
    (
      await http.post(`${origin}/oauth/token`, {
        form: {
          grant_type: "refresh_token",
          client_id: app,
          refresh_token: codeCredentials.refresh_token,
          scope: "drafts:share",
        },
      })
    ).status(),
    400,
    "an old code exchanged after reduction cannot restore the other audience",
  );
  assert.equal(
    (await client.listTools()).tools.some(
      (tool) => tool.name === "list_friends",
    ),
    false,
  );
  const privateState = read(await call("get_sharing", { id: draft }));
  assert.equal(privateState.url, both.linkUrl);
  assert.equal(privateState.friendUrl, null);
  assert.deepEqual(privateState.recipients, []);
  denied(await call("share_draft", shareFriend));
  denied(await call("revoke_sharing", { id: draft }));
  denied(await call("revoke_sharing", { id: draft, audience: "friends" }));
  assert.equal(
    read(await call("revoke_sharing", { id: draft, audience: "link" })).shared,
    true,
    "removing a link must leave private access intact",
  );
  read(await call("share_draft", shareLink));
  assert.ok(read(await call("get_sharing", { id: draft })).url);
  assert.equal(
    read(await call("revoke_sharing", { id: draft, audience: "link" })).shared,
    true,
  );
  read(await call("share_draft", shareLink));

  await select("sharing:people");
  assert.equal(read(await call("list_friends", {}))[0].id, friend);
  const peopleState = read(await call("get_sharing", { id: draft }));
  assert.equal(peopleState.url, both.friendUrl);
  assert.equal(peopleState.linkUrl, null);
  denied(await call("revoke_sharing", { id: draft, audience: "link" }));
  assert.equal(read(await call("get_sharing", { id: draft })).audience, "both");
  denied(await call("share_draft", shareLink));
  read(await call("share_draft", shareFriend));
  denied(await call("revoke_sharing", { id: draft, audience: "link" }));
  denied(await call("revoke_sharing", { id: draft }));
  assert.equal(
    read(await call("get_sharing", { id: draft })).recipients[0].id,
    friend,
  );
  assert.equal(
    read(await call("revoke_sharing", { id: draft, audience: "friends" }))
      .shared,
    true,
  );

  const renewed = await http.post(`${origin}/oauth/token`, {
    form: {
      grant_type: "refresh_token",
      client_id: app,
      refresh_token: refresh,
      scope: "sharing:people",
    },
  });
  assert.equal(renewed.status(), 200);
  const credentials = await renewed.json();
  assert.equal(credentials.scope, "sharing:people");
  assert.equal(
    (
      await http.post(`${origin}/oauth/token`, {
        form: {
          grant_type: "refresh_token",
          client_id: app,
          refresh_token: credentials.refresh_token,
          scope: "drafts:share",
        },
      })
    ).status(),
    400,
    "the legacy alias must not expand a newly narrowed credential",
  );
});

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
    ["check_draft", "get_draft", "list_drafts", "list_feedback", "read_media"],
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
  assert.deepEqual(renewed.scope.split(" ").sort(), [
    "drafts:read",
    "media:read",
  ]);
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

// Reauthorizing must retain one connection without expanding old tokens/codes,
// including codes issued by the previous image during a rolling deployment.
test("agent permission upgrades preserve connection identity and credential ceilings", async (t) => {
  const user = randomUUID(),
    stranger = randomUUID(),
    connection = randomUUID();
  const session = token(),
    otherSession = token(),
    app = token(),
    otherApp = token();
  const access = token(),
    refresh = token(),
    legacyCode = token();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = "http://127.0.0.1:12345/callback";
  const browser = await request.newContext({
    extraHTTPHeaders: {
      Cookie: `lastpeek_session=${session}`,
      Origin: origin,
      Accept: "text/html",
    },
  });
  const http = await request.newContext();
  t.after(async () => {
    await browser.dispose();
    await http.dispose();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [user, stranger],
    ]);
    await db.query("DELETE FROM agent_clients WHERE id=ANY($1::text[])", [
      [app, otherApp],
    ]);
  });
  for (const [id, cookie] of [
    [user, session],
    [stranger, otherSession],
  ]) {
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Owner','unused')",
      [id, `${id}@example.test`],
    );
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(cookie), id],
    );
    await db.query(
      "INSERT INTO feature_grants(user_id,feature) VALUES($1,'agents')",
      [id],
    );
  }
  for (const client of [app, otherApp])
    await db.query(
      "INSERT INTO agent_clients(id,name,redirect_uris) VALUES($1,'Same display name',$2)",
      [client, JSON.stringify([callback])],
    );
  await db.query(
    "INSERT INTO agent_connections(id,user_id,client_id,scopes,approved_scopes) VALUES($1,$2,$3,'{drafts:read}','{drafts:read}')",
    [connection, user, app],
  );
  const original = (
    await db.query(
      "SELECT created_at,expires_at FROM agent_connections WHERE id=$1",
      [connection],
    )
  ).rows[0];
  for (const [value, kind] of [
    [access, "access"],
    [refresh, "refresh"],
  ])
    await db.query(
      "INSERT INTO agent_tokens(hash,connection_id,kind,scopes,resource,expires_at) VALUES($1,$2,$3,'{drafts:read}',$4,now()+interval '1 day')",
      [hash(value), connection, kind, `${origin}/mcp`],
    );
  await db.query(
    "INSERT INTO agent_codes(hash,connection_id,redirect_uri,challenge,resource) VALUES($1,$2,$3,$4,$5)",
    [hash(legacyCode), connection, callback, challenge, `${origin}/mcp`],
  );
  const requestUpgrade = () =>
    browser.post(`${origin}/settings?tab=agents&/agent`, {
      form: { id: connection, scope: "drafts:read drafts:write" },
    });
  assert.equal((await requestUpgrade()).status(), 200);
  const challenged = await http.post(`${origin}/mcp`, {
    headers: { Authorization: `Bearer ${access}` },
    data: {},
  });
  assert.equal(challenged.status(), 403);
  assert.match(
    challenged.headers()["www-authenticate"],
    /error="insufficient_scope"/,
  );
  assert.match(challenged.headers()["www-authenticate"], /media:write/);
  const refreshForm = {
    grant_type: "refresh_token",
    client_id: app,
    refresh_token: refresh,
    resource: `${origin}/mcp`,
  };
  assert.equal(
    (
      await http.post(`${origin}/oauth/token`, {
        form: { ...refreshForm, scope: "drafts:write" },
      })
    ).status(),
    400,
  );
  const renewed = await (
    await http.post(`${origin}/oauth/token`, { form: refreshForm })
  ).json();
  assert.equal(renewed.scope, "drafts:read");
  const params = new URLSearchParams({
    client_id: app,
    redirect_uri: callback,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: "drafts:read drafts:write",
    state: "upgrade-state",
  });
  const authorize = `${origin}/oauth/authorize?${params}`;
  const denied = await browser.post(authorize, {
    form: { intent: "deny", connection },
    maxRedirects: 0,
  });
  assert.equal(
    new URL(denied.headers().location).searchParams.get("error"),
    "access_denied",
  );
  assert.equal(
    (
      await db.query(
        "SELECT requested_scopes FROM agent_connections WHERE id=$1",
        [connection],
      )
    ).rows[0].requested_scopes,
    null,
  );
  assert.equal((await requestUpgrade()).status(), 200);
  const approval = {
    connection,
    scope: "drafts:read drafts:write",
    expiry: "never",
  };
  assert.equal(
    (
      await browser.post(authorize, {
        form: approval,
        headers: { Cookie: `lastpeek_session=${otherSession}` },
        maxRedirects: 0,
      })
    ).status(),
    400,
    "cannot upgrade another owner's connection",
  );
  const wrongClient = new URLSearchParams(params);
  wrongClient.set("client_id", otherApp);
  assert.equal(
    (
      await browser.post(`${origin}/oauth/authorize?${wrongClient}`, {
        form: approval,
        maxRedirects: 0,
      })
    ).status(),
    400,
    "matching client names never merge installations",
  );
  const approved = await browser.post(authorize, {
    form: approval,
    maxRedirects: 0,
  });
  assert.equal(approved.status(), 303);
  const result = new URL(approved.headers().location);
  assert.equal(result.searchParams.get("state"), "upgrade-state");
  const exchange = {
    grant_type: "authorization_code",
    client_id: app,
    redirect_uri: callback,
    code_verifier: verifier,
    resource: `${origin}/mcp`,
  };
  const fresh = await (
    await http.post(`${origin}/oauth/token`, {
      form: { ...exchange, code: result.searchParams.get("code")! },
    })
  ).json();
  assert.deepEqual(fresh.scope.split(" ").sort(), [
    "drafts:read",
    "drafts:write",
    "media:read",
    "media:write",
  ]);
  assert.equal(
    (
      await http.post(`${origin}/oauth/token`, {
        form: { ...exchange, code: legacyCode },
      })
    ).status(),
    400,
    "older pending codes are invalidated so even the previous server image cannot exchange them with expanded access",
  );
  const again = await (
    await http.post(`${origin}/oauth/token`, {
      form: { ...refreshForm, refresh_token: renewed.refresh_token },
    })
  ).json();
  assert.equal(
    again.scope,
    "drafts:read",
    "old refresh tokens retain their original ceiling after approval",
  );
  const rows = (
    await db.query(
      "SELECT id,created_at,expires_at,requested_scopes FROM agent_connections WHERE user_id=$1",
      [user],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, connection);
  assert.deepEqual(rows[0].created_at, original.created_at);
  assert.deepEqual(rows[0].expires_at, original.expires_at);
  assert.equal(rows[0].requested_scopes, null);
  for (const [bearer, upgraded] of [
    [access, false],
    [fresh.access_token, true],
  ] as const) {
    const client = new Client({ name: "Upgrade test", version: "1" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
        }),
      );
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.equal(names.includes("upload_media"), upgraded);
      assert.equal(names.includes("read_media"), upgraded);
      for (const removed of [
        "request_friend",
        "change_friendship",
        "list_notifications",
      ])
        assert.equal(names.includes(removed), false);
    } finally {
      await client.close();
    }
  }
  // A mistaken request can be cancelled in Settings without revoking the grant.
  await browser.post(`${origin}/settings?tab=agents&/agent`, {
    form: { id: connection, scope: "drafts:read drafts:write ai:review" },
  });
  assert.equal(
    (
      await browser.post(`${origin}/settings?tab=agents&/agent`, {
        form: { id: connection, intent: "cancel-permissions" },
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await db.query(
        "SELECT requested_scopes,revoked_at FROM agent_connections WHERE id=$1",
        [connection],
      )
    ).rows[0].requested_scopes,
    null,
  );
});

// Exercise the actual MCP/binary boundary. A digest mismatch, a foreign draft,
// a removed private recipient and a live scope reduction must all differ from
// an authorized transfer; retrying an upload/create must not duplicate it.
test("agent workflows transfer private media, preserve context and attribute review work", async (t) => {
  const owner = randomUUID(),
    reviewer = randomUUID(),
    app = token(),
    connection = randomUUID(),
    access = token();
  const reviewConnection = randomUUID(),
    reviewAccess = token();
  const client = new Client({ name: "Workflow contract", version: "1" });
  const peer = new Client({ name: "Reviewer contract", version: "1" });
  const http = await request.newContext();
  const uploads: string[] = [];
  t.after(async () => {
    await client.close();
    await peer.close();
    await http.dispose();
    await db.query("DELETE FROM drafts WHERE owner_id=ANY($1::uuid[])", [
      [owner, reviewer],
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, reviewer],
    ]);
    await db.query("DELETE FROM agent_clients WHERE id=$1", [app]);
    await Promise.all(uploads.map((id) => rm(mediaPath(id), { force: true })));
  });
  await db.query(
    "INSERT INTO agent_clients(id,name,redirect_uris) VALUES($1,'Test Codex','[]')",
    [app],
  );
  for (const [user, id, bearer] of [
    [owner, connection, access],
    [reviewer, reviewConnection, reviewAccess],
  ]) {
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,plan) VALUES($1,$2,$3,'unused','pro')",
      [user, `${user}@example.test`, user === owner ? "Author" : "Reviewer"],
    );
    await db.query(
      "INSERT INTO feature_grants(user_id,feature) VALUES($1,'agents')",
      [user],
    );
    await db.query(
      "INSERT INTO agent_connections(id,user_id,client_id,scopes,approved_scopes) VALUES($1,$2,$3,$4,$4)",
      [id, user, app, expandAgentScopes(agentScopes)],
    );
    await db.query(
      "INSERT INTO agent_tokens(hash,connection_id,kind,scopes,resource,expires_at) VALUES($1,$2,'access',$3,$4,now()+interval '1 hour')",
      [hash(bearer), id, expandAgentScopes(agentScopes), `${origin}/mcp`],
    );
  }
  for (const [sdk, bearer] of [
    [client, access],
    [peer, reviewAccess],
  ] as const)
    await sdk.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      }),
    );
  const call = (name: string, args: Record<string, unknown>, sdk = client) =>
    sdk.callTool({ name, arguments: args });
  const read = (result: Awaited<ReturnType<typeof call>>) => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    const value = JSON.parse((result.content as { text: string }[])[0].text);
    assert.deepEqual(result.structuredContent, { result: value });
    return value;
  };
  const account = read(await call("get_account", {}));
  assert.equal(account.profile.id, owner);
  assert.ok(account.tools.includes("update_draft"));
  assert.ok(account.tools.includes("upload_media"));
  assert.ok(
    !account.tools.some((name: string) => /publish|delete_draft/.test(name)),
  );
  const input = {
    posts: [
      "Opening https://example.com/" + "a".repeat(100),
      "Keep this second post",
    ],
    requestId: randomUUID(),
  };
  const created = read(await call("create_draft", input));
  assert.equal(read(await call("create_draft", input)).id, created.id);
  const conflict = await call("create_draft", {
    ...input,
    posts: ["Different content"],
  });
  assert.equal((conflict.structuredContent as any).error.code, "conflict");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM drafts WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].n,
    1,
  );
  const checks = read(await call("check_draft", { id: created.id }));
  assert.equal(checks.posts[0].weightedLength, 31); // 8 chars + X's 23-char URL.
  assert.equal(
    read(await call("list_drafts", { query: "second", status: "draft" }))[0].id,
    created.id,
  );
  assert.deepEqual(read(await call("list_drafts", { query: "absent" })), []);

  const bytes = await sharp({
    create: { width: 24, height: 12, channels: 3, background: "coral" },
  })
    .png()
    .toBuffer();
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    (
      await call(
        "upload_media",
        { id: created.id, filename: "foreign.png", sha256: digest },
        peer,
      )
    ).isError,
    true,
  );
  const grant = read(
    await call("upload_media", {
      id: created.id,
      filename: "screenshot.png",
      sha256: digest,
    }),
  ).transfer;
  assert.equal(new URL(grant.url).search, "");
  assert.equal((await http.post(grant.url, { data: bytes })).status(), 401);
  assert.equal(
    (
      await http.post(grant.url, {
        headers: grant.headers,
        data: Buffer.from("wrong bytes"),
      })
    ).status(),
    400,
  );
  const uploaded = await http.post(grant.url, {
    headers: grant.headers,
    data: bytes,
  });
  assert.equal(uploaded.status(), 201);
  const media = await uploaded.json();
  uploads.push(media.id);
  assert.equal(
    (
      await (
        await http.post(grant.url, { headers: grant.headers, data: bytes })
      ).json()
    ).id,
    media.id,
  );
  assert.equal(
    (
      await db.query("SELECT count(*)::int AS n FROM media WHERE draft_id=$1", [
        created.id,
      ])
    ).rows[0].n,
    1,
  );
  assert.equal(
    read(await call("get_draft", { id: created.id })).media[0].attached,
    false,
  );
  read(
    await call("edit_post", {
      id: created.id,
      version: 1,
      postId: created.content.posts[0].id,
      media: [media.id],
      text: "Revised opening",
    }),
  );
  const edited = read(await call("get_draft", { id: created.id }));
  assert.equal(edited.media[0].attached, true);
  assert.equal(edited.content.posts[1].text, "Keep this second post");
  assert.equal(
    (
      await call("edit_post", {
        id: created.id,
        version: 1,
        postId: created.content.posts[0].id,
        text: "Stale",
      })
    ).isError,
    true,
  );
  const downloadResult = await call("read_media", {
    id: created.id,
    mediaId: media.id,
  });
  const download = read(downloadResult).transfer;
  assert.ok(
    (downloadResult.content as any[]).some((block) => block.type === "image"),
  );
  const ranged = await http.get(download.url, {
    headers: { ...download.headers, Range: "bytes=2-9" },
  });
  assert.equal(ranged.status(), 206);
  assert.deepEqual(await ranged.body(), bytes.subarray(2, 10));
  assert.equal(
    (
      await http.get(download.url, {
        headers: { ...download.headers, Range: "bytes=999999-" },
      })
    ).status(),
    416,
  );
  await db.query(
    "UPDATE agent_transfers SET expires_at=now()-interval '1 second' WHERE hash=$1",
    [hash(download.headers.Authorization.slice(7))],
  );
  assert.equal(
    (await http.get(download.url, { headers: download.headers })).status(),
    403,
  );
  await db.query(
    "UPDATE agent_transfers SET expires_at=now()+interval '10 minutes' WHERE hash=$1",
    [hash(download.headers.Authorization.slice(7))],
  );
  const inlineInput = {
    id: created.id,
    filename: "inline.png",
    sha256: digest,
    dataBase64: bytes.toString("base64"),
    requestId: randomUUID(),
  };
  const inline = read(await call("upload_media", inlineInput));
  uploads.push(inline.media.id);
  assert.equal(
    read(await call("upload_media", inlineInput)).media.id,
    inline.media.id,
  );
  assert.equal(
    (await call("get_review", { id: created.id })).isError,
    true,
    "reading sharing state must not create a review link",
  );
  // A valid MP4 with a padding/free atom exceeds the MCP JSON body ceiling.
  const padding = Buffer.alloc(1_010_000);
  padding.writeUInt32BE(padding.length, 0);
  padding.write("free", 4);
  const video = Buffer.concat([
    await readFile("tests/fixtures/video.mp4"),
    padding,
  ]);
  const videoGrant = read(
    await call("upload_media", {
      id: created.id,
      filename: "clip.mp4",
      sha256: createHash("sha256").update(video).digest("hex"),
    }),
  ).transfer;
  const videoResponse = await http.post(videoGrant.url, {
    headers: videoGrant.headers,
    data: video,
  });
  assert.equal(videoResponse.status(), 201);
  const videoMedia = await videoResponse.json();
  uploads.push(videoMedia.id);
  assert.equal(videoMedia.mime, "video/mp4");
  assert.equal(videoMedia.bytes, video.length);

  const postId = "1900000000000000001";
  const source = {
    kind: "reply",
    url: `https://x.com/example/status/${postId}`,
  };
  const context = {
    id: postId,
    url: source.url,
    text: "The original announcement",
    author: {
      name: "Original",
      username: "example",
      avatar: "https://pbs.twimg.com/profile_images/test.png",
    },
    createdAt: "2026-11-01T12:00:00.000Z",
    links: [],
    media: [],
  };
  await db.query(
    "INSERT INTO x_source_posts(post_id,content,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [postId, context],
  );
  const reply = read(
    await call("create_draft", {
      posts: ["A reply, not a standalone post"],
      source,
    }),
  );
  assert.equal(reply.content.source.kind, "reply");
  assert.equal(
    read(await call("get_source_post", { id: reply.id })).context.text,
    context.text,
  );
  read(
    await call("update_draft", {
      id: reply.id,
      version: 1,
      posts: reply.content.posts,
      source: { ...source, kind: "quote" },
    }),
  );
  assert.equal(
    read(await call("get_draft", { id: reply.id })).content.source.kind,
    "quote",
  );
  assert.equal(
    (
      await call("create_draft", {
        posts: ["Bad URL"],
        source: { kind: "reply", url: "http://127.0.0.1/private" },
      })
    ).isError,
    true,
  );
  assert.equal(
    (await call("request_ai_review", { id: created.id, version: 1 })).isError,
    true,
    "stale review must be rejected before a provider call",
  );

  const friendship = randomUUID();
  await db.query(
    "INSERT INTO friendships(id,requester_id,recipient_id,accepted_at) VALUES($1,$2,$3,now())",
    [friendship, owner, reviewer],
  );
  const shared = read(
    await call("share_draft", {
      id: created.id,
      version: 2,
      audience: "friend",
      friendId: reviewer,
    }),
  );
  assert.equal(
    read(await call("get_sharing", { id: created.id })).recipients[0].id,
    reviewer,
  );
  assert.equal(
    read(await call("list_reviews", { status: "pending" }, peer))[0].id,
    created.id,
  );
  const review = read(await call("get_review", { token: shared.token }, peer));
  assert.equal(review.media[0].id, media.id);
  const privateGrant = read(
    await call(
      "read_media",
      { id: created.id, mediaId: media.id, reviewToken: shared.token },
      peer,
    ),
  ).transfer;
  read(
    await call("share_draft", { id: created.id, version: 2, audience: "link" }),
  );
  assert.equal(
    (
      await http.get(privateGrant.url, { headers: privateGrant.headers })
    ).status(),
    200,
    "creating a bearer link preserves an existing private media transfer",
  );
  const feedbackInput = {
    token: shared.token,
    revision: shared.revision,
    body: "Make the opening clearer",
    requestId: randomUUID(),
  };
  const feedback = read(await call("send_feedback", feedbackInput, peer));
  assert.equal(
    read(await call("send_feedback", feedbackInput, peer)).id,
    feedback.id,
  );
  assert.equal(
    read(await call("list_reviews", { status: "done" }, peer))[0].completed,
    true,
  );
  const feed = read(
    await call("list_feedback", { query: "clearer", status: "open" }),
  );
  assert.equal(feed[0].agent_name, "Test Codex");
  assert.equal(feed[0].name, "Reviewer");
  assert.equal(
    read(await call("get_review", { id: created.id })).feedback[0].agent_name,
    "Test Codex",
  );
  assert.equal(
    review.media.length,
    1,
    "unattached uploads must not leak into a review",
  );
  read(
    await call("send_feedback", {
      id: created.id,
      revision: shared.revision,
      body: "Updated, thank you",
    }),
  );
  assert.equal(read(await call("list_friends", {}))[0].id, reviewer);
  read(await call("remove_recipient", { id: created.id, friendId: reviewer }));
  assert.equal(
    (
      await http.get(privateGrant.url, { headers: privateGrant.headers })
    ).status(),
    404,
  );
  assert.equal(
    (await call("get_review", { token: shared.token }, peer)).isError,
    true,
  );
  assert.equal(
    read(await call("get_sharing", { id: created.id })).recipients.length,
    0,
  );

  await db.query(
    "UPDATE agent_connections SET scopes='{reviews:read,media:read}' WHERE id=$1",
    [connection],
  );
  assert.equal(
    (await http.get(download.url, { headers: download.headers })).status(),
    403,
    "review attachment access cannot substitute for reading owned drafts",
  );
  assert.equal(
    (await call("read_media", { id: created.id, mediaId: media.id })).isError,
    true,
  );
  await db.query(
    "UPDATE agent_connections SET scopes=array_remove(scopes,'media:read') WHERE id=$1",
    [connection],
  );
  assert.equal(
    (await http.get(download.url, { headers: download.headers })).status(),
    403,
  );
  assert.ok(
    !(await client.listTools()).tools.some(
      (tool) => tool.name === "read_media",
    ),
  );
  await db.query("UPDATE agent_connections SET revoked_at=now() WHERE id=$1", [
    connection,
  ]);
  assert.equal(
    (
      await http.post(grant.url, { headers: grant.headers, data: bytes })
    ).status(),
    403,
  );
});
