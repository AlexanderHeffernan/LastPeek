import test from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import sharp from "sharp";
import { isHttpError, isRedirect, type RequestEvent } from "@sveltejs/kit";
import { db } from "../src/lib/server/db";
import {
  hash,
  passwordHash,
  signingSecret,
  token,
  type User,
} from "../src/lib/server/auth";
import { finishXAuth, startXAuth } from "../src/lib/server/x-auth";
import { avatarPath } from "../src/lib/server/avatars";

// Real disposable PostgreSQL/filesystem; only the external X provider is stubbed.
test("X OAuth binds browser/session, consumes invitations once, and never merges identities", async (t) => {
  process.env.X_CLIENT_ID = "test-only-client";
  process.env.X_CLIENT_SECRET = "test-only-secret";
  const ownerId = randomUUID(),
    otherId = randomUUID();
  const email = `x-${randomUUID()}@example.test`;
  const invite = token();
  const users = [ownerId, otherId];
  const avatarIds: string[] = [];
  const cookies = new Map<string, string>();
  let profile = {
    id: `${Date.now()}123`,
    name: "X Imported Name",
    username: "x_imported",
    profile_image_url:
      "https://pbs.twimg.com/profile_images/123/photo_normal.png",
  };
  const image = await sharp({
    create: { width: 32, height: 48, channels: 3, background: "#ff6b5b" },
  })
    .png()
    .toBuffer();
  let providerFailure = false;
  let grantedScope = "tweet.read users.read offline.access";
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL, init?: RequestInit) => {
      if (providerFailure) return new Response("unavailable", { status: 503 });
      if (String(url) === "https://api.x.com/2/oauth2/token") {
        assert.equal(
          new URLSearchParams(init?.body as URLSearchParams).get("grant_type"),
          "authorization_code",
        );
        return Response.json({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 7200,
          scope: grantedScope,
        });
      }
      if (String(url).startsWith("https://api.x.com/2/users/me"))
        return Response.json({ data: profile });
      assert.equal(
        String(url),
        "https://pbs.twimg.com/profile_images/123/photo.png",
      );
      return new Response(image);
    },
  );
  function event(
    path: string,
    form: Record<string, string> = {},
    user: User | null = null,
  ) {
    return {
      url: new URL(`https://lastpeek.example${path}`),
      request: new Request("https://lastpeek.example/auth/x/start", {
        method: "POST",
        body: new URLSearchParams(form),
      }),
      locals: { user },
      getClientAddress: () => ownerId,
      cookies: {
        get: (name: string) => cookies.get(name),
        set: (name: string, value: string) => cookies.set(name, value),
        delete: (name: string) => cookies.delete(name),
      },
    } as unknown as RequestEvent;
  }
  async function redirectFrom(work: Promise<unknown>) {
    try {
      await work;
      assert.fail("Expected redirect");
    } catch (e) {
      if (!isRedirect(e)) throw e;
      return e.location;
    }
  }
  async function start(form = {}, user: User | null = null) {
    const url = new URL(
      await redirectFrom(startXAuth(event("/auth/x/start", form, user))),
    );
    assert.equal(url.origin, "https://x.com");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      url.searchParams.get("scope"),
      "tweet.read users.read offline.access",
    );
    const state = url.searchParams.get("state")!;
    const flow = (
      await db.query("SELECT verifier FROM x_oauth_flows WHERE state_hash=$1", [
        hash(state),
      ])
    ).rows[0];
    assert.equal(
      url.searchParams.get("code_challenge"),
      createHash("sha256").update(flow.verifier).digest("base64url"),
    );
    return state;
  }
  const callback = (
    state: string,
    user: User | null = null,
    extra = "code=test-code",
  ) => finishXAuth(event(`/auth/x/callback?state=${state}&${extra}`, {}, user));
  const status = (expected: number) => (e: unknown) =>
    isHttpError(e) && e.status === expected;
  try {
    const password = await passwordHash("test-only-password");
    for (const id of users)
      await db.query(
        "INSERT INTO users(id,email,name,handle,password_hash) VALUES($1,$2,'Original Name','original',$3)",
        [id, `${id}@example.test`, password],
      );
    const owner = (await db.query("SELECT * FROM users WHERE id=$1", [ownerId]))
      .rows[0] as User;
    const other = (await db.query("SELECT * FROM users WHERE id=$1", [otherId]))
      .rows[0] as User;
    await db.query(
      "INSERT INTO invites(id,hash,created_by,email,plan,expires_at) VALUES($1,$2,$3,$4,'pro',now()+interval '1 day')",
      [randomUUID(), hash(invite), ownerId, email],
    );

    const wrongBrowser = await start({}, owner);
    cookies.set("lastpeek_x_oauth", "wrong-browser");
    await assert.rejects(callback(wrongBrowser, owner), status(400));
    const wrongSession = await start({}, owner);
    await assert.rejects(callback(wrongSession, other), status(400));
    const expired = await start();
    await db.query(
      "UPDATE x_oauth_flows SET expires_at=now()-interval '1 second' WHERE state_hash=$1",
      [hash(expired)],
    );
    await assert.rejects(callback(expired), status(400));
    const denied = await start({}, owner);
    assert.equal(
      await redirectFrom(callback(denied, owner, "error=access_denied")),
      "/settings?x=cancelled",
    );
    assert.equal(
      (await db.query("SELECT 1 FROM x_accounts WHERE user_id=$1", [ownerId]))
        .rowCount,
      0,
    );
    const unavailable = await start({}, owner);
    providerFailure = true;
    await assert.rejects(callback(unavailable, owner), status(502));
    providerFailure = false;

    const noInvite = await start();
    assert.equal(await redirectFrom(callback(noInvite)), "/login?x=unlinked");
    assert.equal(cookies.has("lastpeek_session"), false);
    assert.equal(
      (await db.query("SELECT 1 FROM x_accounts WHERE x_id=$1", [profile.id]))
        .rowCount,
      0,
    );
    assert.equal(
      (await db.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount,
      0,
    );
    await assert.rejects(callback(noInvite), status(400));
    const state = await start({ invite, email });
    assert.equal(await redirectFrom(callback(state)), "/settings?x=joined");
    const joined = (
      await db.query("SELECT * FROM users WHERE email=$1", [email])
    ).rows[0];
    users.push(joined.id);
    avatarIds.push(joined.avatar_id);
    assert.equal(joined.name, profile.name);
    assert.equal(joined.handle, profile.username);
    assert.equal(joined.has_password, false);
    assert.ok(joined.avatar_id);
    assert.ok(
      (
        await db.query("SELECT used_at FROM invites WHERE hash=$1", [
          hash(invite),
        ])
      ).rows[0].used_at,
    );
    assert.ok(cookies.get("lastpeek_session"));
    await assert.rejects(callback(state), status(400));
    const account = (
      await db.query("SELECT * FROM x_accounts WHERE user_id=$1", [joined.id])
    ).rows[0];
    assert.notEqual(account.access_token, "test-access-token");
    const encrypted = Buffer.from(account.refresh_token, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256")
        .update(await signingSecret())
        .digest(),
      encrypted.subarray(0, 12),
    );
    decipher.setAuthTag(encrypted.subarray(12, 28));
    assert.equal(
      Buffer.concat([
        decipher.update(encrypted.subarray(28)),
        decipher.final(),
      ]).toString(),
      "test-refresh-token",
    );
    assert.equal(await redirectFrom(callback(await start())), "/");
    await assert.rejects(callback(await start({}, owner), owner), status(409));

    // Existing email cannot claim an account, and the invitation is not consumed.
    profile = { ...profile, id: `${Date.now()}456` };
    const unused = token();
    await db.query(
      "INSERT INTO invites(id,hash,created_by,email,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
      [randomUUID(), hash(unused), ownerId, owner.email],
    );
    await assert.rejects(
      callback(await start({ invite: unused, email: owner.email })),
      status(409),
    );
    assert.equal(
      (
        await db.query("SELECT used_at FROM invites WHERE hash=$1", [
          hash(unused),
        ])
      ).rows[0].used_at,
      null,
    );
    assert.equal(
      await redirectFrom(callback(await start({}, owner), owner)),
      "/settings?x=linked",
    );
    const unchanged = (
      await db.query("SELECT name,handle,avatar_id FROM users WHERE id=$1", [
        ownerId,
      ])
    ).rows[0];
    assert.deepEqual(unchanged, {
      name: "Original Name",
      handle: "original",
      avatar_id: null,
    });
    assert.equal(
      (
        await db.query(
          "SELECT import_pending FROM x_accounts WHERE user_id=$1",
          [ownerId],
        )
      ).rows[0].import_pending,
      true,
    );
    const publishingDraft = randomUUID();
    await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
      publishingDraft,
      ownerId,
      {
        author: { name: "Owner", handle: "" },
        posts: [{ id: randomUUID(), text: "Ready", media: [] }],
      },
    ]);
    await assert.rejects(
      startXAuth(
        event("/auth/x/start", { publishDraft: publishingDraft }, owner),
      ),
      status(403),
    );
    await db.query(
      "INSERT INTO feature_grants(user_id,feature) VALUES($1,'x-publishing')",
      [ownerId],
    );
    const publishingStart = async () =>
      new URL(
        await redirectFrom(
          startXAuth(
            event("/auth/x/start", { publishDraft: publishingDraft }, owner),
          ),
        ),
      );
    let publishingURL = await publishingStart();
    assert.ok(
      publishingURL.searchParams
        .get("scope")
        ?.split(" ")
        .includes("tweet.write"),
    );
    await assert.rejects(
      callback(publishingURL.searchParams.get("state")!, owner),
      status(502),
    );
    assert.ok(
      publishingURL.searchParams
        .get("scope")
        ?.split(" ")
        .includes("media.write"),
    );
    grantedScope += " tweet.write media.write";
    publishingURL = await publishingStart();
    assert.equal(
      await redirectFrom(
        callback(publishingURL.searchParams.get("state")!, owner),
      ),
      `/drafts/${publishingDraft}`,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM x_publications WHERE draft_id=$1",
          [publishingDraft],
        )
      ).rows[0].count,
      0,
      "Authorisation must never publish automatically",
    );
  } finally {
    await db.query(
      "DELETE FROM x_oauth_flows WHERE user_id=ANY($1::uuid[]) OR email=$2",
      [users, email],
    );
    await db.query("DELETE FROM invites WHERE created_by=$1", [ownerId]);
    await db.query("DELETE FROM drafts WHERE owner_id=ANY($1::uuid[])", [
      users,
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    for (const id of avatarIds.filter(Boolean))
      await rm(avatarPath(id), { force: true });
    await db.end();
  }
});
