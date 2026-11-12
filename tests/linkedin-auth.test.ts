import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { isHttpError, isRedirect, type RequestEvent } from "@sveltejs/kit";
import { db } from "../src/lib/server/db";
import { hash, token, type User } from "../src/lib/server/auth";
import {
  linkedinAuthAvailable,
  requireLinkedInAccess,
  startLinkedInAuth,
  finishLinkedInAuth,
  disconnectLinkedIn,
} from "../src/lib/server/linkedin-auth";

test("LinkedIn validates OIDC and browser identity, links without merging, and registers only through single-use invitations", async (t) => {
  process.env.LINKEDIN_CLIENT_ID = "test-linkedin-client";
  process.env.LINKEDIN_CLIENT_SECRET = "test-linkedin-secret";
  const ownerId = randomUUID(),
    otherId = randomUUID(),
    users = [ownerId, otherId];
  const cookies = new Map<string, string>();
  const key = await generateKeyPair("RS256"),
    wrongKey = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: "linkedin-test",
    alg: "RS256",
  };
  const email = `${randomUUID()}@example.test`,
    invite = token();
  let nonce = "",
    subject = randomUUID(),
    bad = "",
    requests = 0;
  const status = (expected: number) => (e: unknown) =>
    isHttpError(e) && e.status === expected;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL, init?: RequestInit) => {
      requests++;
      if (bad === "unavailable")
        return new Response("unavailable", { status: 503 });
      if (String(url).endsWith("/accessToken")) {
        assert.equal(
          new URLSearchParams(init?.body as URLSearchParams).get(
            "redirect_uri",
          ),
          "https://lastpeek.example/auth/linkedin/callback",
        );
        const id = await new SignJWT({
          nonce: bad === "nonce" ? "wrong" : nonce,
          ...(bad === "azp" ? { azp: "another-client" } : {}),
          ...(bad === "multi-valid" ? { azp: "test-linkedin-client" } : {}),
        })
          .setProtectedHeader({ alg: "RS256", kid: "linkedin-test" })
          .setIssuer(
            bad === "issuer"
              ? "https://www.linkedin.com"
              : "https://www.linkedin.com/oauth",
          )
          .setAudience(
            bad.startsWith("multi-")
              ? ["test-linkedin-client", "another-client"]
              : bad === "audience"
                ? "another-client"
                : "test-linkedin-client",
          )
          .setSubject(subject)
          .setIssuedAt()
          .setExpirationTime(bad === "expired" ? "-1m" : "5m")
          .sign(bad === "signature" ? wrongKey.privateKey : key.privateKey);
        return Response.json({
          access_token: "discard-this-token",
          id_token: id,
        });
      }
      if (String(url).endsWith("/jwks")) return Response.json({ keys: [jwk] });
      assert.equal(String(url), "https://api.linkedin.com/v2/userinfo");
      return Response.json({
        sub: bad === "subject" ? "another-person" : subject,
        name: "LinkedIn Name",
        email,
      });
    },
  );
  function event(path: string, form = {}, user: User | null = null) {
    return {
      url: new URL(`https://lastpeek.example${path}`),
      request: new Request("https://lastpeek.example/auth/linkedin/start", {
        method: "POST",
        body: new URLSearchParams(form),
      }),
      locals: { user },
      getClientAddress: () => randomUUID(),
      cookies: {
        get: (n: string) => cookies.get(n),
        set: (n: string, v: string) => cookies.set(n, v),
        delete: (n: string) => cookies.delete(n),
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
      await redirectFrom(
        startLinkedInAuth(event("/auth/linkedin/start", form, user)),
      ),
    );
    assert.equal(url.origin, "https://www.linkedin.com");
    assert.equal(url.searchParams.get("scope"), "openid profile email");
    nonce = url.searchParams.get("nonce")!;
    return url.searchParams.get("state")!;
  }
  const callback = (
    state: string,
    user: User | null = null,
    extra = "code=test-code",
  ) =>
    finishLinkedInAuth(
      event(`/auth/linkedin/callback?state=${state}&${extra}`, {}, user),
    );
  try {
    for (const id of users)
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Original name','unused')",
        [id, `${id}@example.test`],
      );
    const owner = (await db.query("SELECT * FROM users WHERE id=$1", [ownerId]))
      .rows[0] as User;
    const other = (await db.query("SELECT * FROM users WHERE id=$1", [otherId]))
      .rows[0] as User;
    assert.equal(await linkedinAuthAvailable(null), false);
    assert.equal(await linkedinAuthAvailable(owner), false);
    await assert.rejects(
      requireLinkedInAccess(event("/auth/linkedin/start", {}, owner)),
      status(404),
    );
    await db.query(
      "INSERT INTO feature_grants(user_id,feature) VALUES($1,'linkedin')",
      [ownerId],
    );
    assert.equal(await linkedinAuthAvailable(owner), true);
    await requireLinkedInAccess(event("/auth/linkedin/start", {}, owner));
    const wrongBrowser = await start({}, owner);
    cookies.set("lastpeek_linkedin_oauth", "wrong-browser");
    await assert.rejects(callback(wrongBrowser, owner), status(400));
    await assert.rejects(callback(await start({}, owner), other), status(400));
    const expired = await start({}, owner);
    await db.query(
      "UPDATE linkedin_oauth_flows SET expires_at=now()-interval '1 second' WHERE state_hash=$1",
      [hash(expired)],
    );
    await assert.rejects(callback(expired, owner), status(400));
    const wrongOrigin = await start({}, owner);
    const originEvent = {
      ...event(
        `/auth/linkedin/callback?state=${wrongOrigin}&code=test-code`,
        {},
        owner,
      ),
      url: new URL(
        `https://other.example/auth/linkedin/callback?state=${wrongOrigin}&code=test-code`,
      ),
    };
    await assert.rejects(finishLinkedInAuth(originEvent), status(400));
    assert.equal(
      await redirectFrom(
        callback(await start({}, owner), owner, "error=access_denied"),
      ),
      "/settings?tab=security&linkedin=cancelled",
    );
    const before = requests;
    await assert.rejects(
      callback(await start({}, owner), owner, ""),
      status(400),
    );
    assert.equal(requests, before);
    for (bad of [
      "nonce",
      "issuer",
      "audience",
      "azp",
      "multi-missing-azp",
      "expired",
      "signature",
      "subject",
      "unavailable",
    ]) {
      const state = await start({}, owner);
      await assert.rejects(callback(state, owner), status(502), bad);
      await assert.rejects(
        callback(state, owner),
        status(400),
        "Failed flows cannot replay",
      );
    }
    bad = "";
    assert.equal(
      (
        await db.query("SELECT 1 FROM linkedin_accounts WHERE user_id=$1", [
          ownerId,
        ])
      ).rowCount,
      0,
    );
    const state = await start({}, owner);
    assert.equal(
      await redirectFrom(callback(state, owner)),
      "/settings?tab=security",
    );
    await assert.rejects(callback(state, owner), status(400));
    bad = "multi-valid";
    assert.equal(
      await redirectFrom(callback(await start({}, owner), owner)),
      "/settings?tab=security",
    );
    bad = "";
    assert.equal(
      (await db.query("SELECT name FROM users WHERE id=$1", [ownerId])).rows[0]
        .name,
      "Original name",
    );
    assert.equal(await redirectFrom(callback(await start())), "/");
    assert.ok(cookies.has("lastpeek_session"));
    await assert.rejects(callback(await start({}, other), other), status(409));
    subject = randomUUID();
    await assert.rejects(callback(await start({}, owner), owner), status(409));
    assert.equal(
      await redirectFrom(callback(await start())),
      "/login?linkedin=unlinked",
    );
    await db.query(
      "INSERT INTO invites(id,hash,created_by,email,plan,expires_at) VALUES($1,$2,$3,$4,'free',now()+interval '1 day')",
      [randomUUID(), hash(invite), ownerId, email],
    );
    await assert.rejects(start({ invite, email: owner.email }), status(400));
    const signup = await start({ invite, email });
    assert.equal(
      await redirectFrom(callback(signup)),
      "/settings?tab=security",
    );
    const joined = (
      await db.query("SELECT * FROM users WHERE email=$1", [email])
    ).rows[0];
    users.push(joined.id);
    assert.equal(joined.name, "LinkedIn Name");
    assert.equal(joined.plan, "free");
    assert.equal(joined.has_password, false);
    assert.equal(joined.handle, "");
    assert.ok(
      (
        await db.query("SELECT used_at FROM invites WHERE hash=$1", [
          hash(invite),
        ])
      ).rows[0].used_at,
    );
    await assert.rejects(start({ invite, email }), status(400));
    await assert.rejects(disconnectLinkedIn(joined.id), status(400));
    await db.query("UPDATE users SET has_password=true WHERE id=$1", [
      joined.id,
    ]);
    await disconnectLinkedIn(joined.id);
    assert.equal(
      (
        await db.query("SELECT 1 FROM linkedin_accounts WHERE user_id=$1", [
          joined.id,
        ])
      ).rowCount,
      0,
    );
    // The provider's email must not claim a local account or consume an invitation on conflict.
    const conflict = token();
    subject = randomUUID();
    await db.query(
      "INSERT INTO invites(id,hash,created_by,email,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
      [randomUUID(), hash(conflict), ownerId, owner.email],
    );
    await assert.rejects(
      callback(await start({ invite: conflict, email: owner.email })),
      status(409),
    );
    assert.equal(
      (
        await db.query("SELECT used_at FROM invites WHERE hash=$1", [
          hash(conflict),
        ])
      ).rows[0].used_at,
      null,
    );
    const revoked = token();
    await db.query(
      "INSERT INTO invites(id,hash,created_by,email,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
      [randomUUID(), hash(revoked), ownerId, `new-${email}`],
    );
    const revokedState = await start({
      invite: revoked,
      email: `new-${email}`,
    });
    await db.query("UPDATE invites SET revoked_at=now() WHERE hash=$1", [
      hash(revoked),
    ]);
    await assert.rejects(callback(revokedState), status(400));
    await db.query("DELETE FROM feature_grants WHERE user_id=$1", [ownerId]);
    await assert.rejects(
      requireLinkedInAccess(event("/auth/linkedin/callback", {}, owner)),
      status(404),
    );
    const pending = await start({}, owner);
    await disconnectLinkedIn(ownerId);
    await assert.rejects(callback(pending, owner), status(400));
  } finally {
    await db.query(
      "DELETE FROM linkedin_oauth_flows WHERE user_id=ANY($1::uuid[]) OR email IN ($2,$3,$4)",
      [users, email, `${ownerId}@example.test`, `new-${email}`],
    );
    await db.query("DELETE FROM invites WHERE created_by=$1", [ownerId]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await db.end();
  }
});
