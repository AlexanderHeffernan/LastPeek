import { error, redirect, type RequestEvent } from "@sveltejs/kit";
import { createLocalJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { db, transaction } from "./db";
import {
  createSession,
  hash,
  passwordHash,
  rateLimit,
  token,
  type User,
} from "./auth";
import { hasFeatureAccess } from "./features";

const cookie = "lastpeek_linkedin_oauth";
const issuer = "https://www.linkedin.com/oauth";
const callbackPath = "/auth/linkedin/callback";

export const linkedinAuthConfigured = () =>
  Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);

// Guests have no experiment grants. Removing this trial check later enables
// the already implemented sign-in/invitation flows without changing account rules.
export async function linkedinAuthAvailable(user: Pick<User, "id"> | null) {
  return (
    linkedinAuthConfigured() &&
    Boolean(user && (await hasFeatureAccess(user.id, "linkedin")))
  );
}

export async function requireLinkedInAccess(event: RequestEvent) {
  if (!(await linkedinAuthAvailable(event.locals.user)))
    error(404, "Not found");
}

// Routes own the experiment gate; these operations also implement the guest
// flows for release, while retaining all browser/session/invitation checks.
export async function startLinkedInAuth(event: RequestEvent): Promise<never> {
  if (!linkedinAuthConfigured())
    error(503, "LinkedIn sign-in isn’t configured yet.");
  await rateLimit(`linkedin-auth:${event.getClientAddress()}`, 20, 900);
  const form = await event.request.formData();
  const invite = String(form.get("invite") || "");
  let email: string | null = null;
  if (invite) {
    if (event.locals.user)
      error(400, "Sign out before accepting an invitation.");
    const parsed = z
      .email()
      .max(254)
      .safeParse(
        String(form.get("email") || "")
          .trim()
          .toLowerCase(),
      );
    if (!parsed.success)
      error(400, "Enter the invitation email before continuing with LinkedIn.");
    email = parsed.data;
    if (
      !(
        await db.query(
          "SELECT 1 FROM invites WHERE hash=$1 AND email=$2 AND expires_at>now() AND used_at IS NULL AND revoked_at IS NULL",
          [hash(invite), email],
        )
      ).rowCount
    )
      error(400, "This invitation is no longer available.");
  }
  const state = token(),
    browser = token(),
    nonce = token();
  await db.query("DELETE FROM linkedin_oauth_flows WHERE expires_at<now()");
  await db.query(
    "INSERT INTO linkedin_oauth_flows(state_hash,browser_hash,nonce_hash,origin,user_id,invite_hash,email) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      hash(state),
      hash(browser),
      hash(nonce),
      event.url.origin,
      event.locals.user?.id || null,
      invite ? hash(invite) : null,
      email,
    ],
  );
  event.cookies.set(cookie, browser, {
    path: "/auth/linkedin",
    httpOnly: true,
    sameSite: "lax",
    secure: event.url.protocol === "https:",
    maxAge: 600,
  });
  const url = new URL(`${issuer}/v2/authorization`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: `${event.url.origin}${callbackPath}`,
    scope: "openid profile email",
    state,
    nonce,
  }).toString();
  redirect(303, url.href, { external: [url.origin] });
}

export async function finishLinkedInAuth(event: RequestEvent): Promise<never> {
  if (!linkedinAuthConfigured())
    error(503, "LinkedIn sign-in isn’t configured yet.");
  const state = event.url.searchParams.get("state") || "";
  const browser = event.cookies.get(cookie) || "";
  const result = await db.query(
    "DELETE FROM linkedin_oauth_flows WHERE state_hash=$1 AND browser_hash=$2 AND origin=$3 AND expires_at>now() RETURNING *",
    [hash(state), hash(browser), event.url.origin],
  );
  event.cookies.delete(cookie, { path: "/auth/linkedin" });
  const flow = result.rows[0];
  if (
    !flow ||
    (flow.user_id
      ? event.locals.user?.id !== flow.user_id
      : Boolean(event.locals.user))
  )
    error(
      400,
      "This LinkedIn sign-in has expired or belongs to another session. Start again.",
    );
  if (event.url.searchParams.has("error"))
    redirect(
      303,
      `${flow.user_id ? "/settings?tab=security&" : "/login?"}linkedin=cancelled`,
    );
  const code = event.url.searchParams.get("code");
  if (!code || code.length > 2048)
    error(
      400,
      "LinkedIn did not return a valid authorization code. Start again.",
    );
  let profile: { sub: string; name: string };
  try {
    const response = await fetch(`${issuer}/v2/accessToken`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: process.env.LINKEDIN_CLIENT_ID!,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        redirect_uri: `${flow.origin}${callbackPath}`,
      }),
    });
    if (!response.ok) throw new Error("Token exchange failed");
    const credentials = z
      .object({
        access_token: z.string().min(1).max(8192),
        id_token: z.string().min(1).max(16384),
      })
      .parse(await response.json());
    const keys = await fetch(`${issuer}/openid/jwks`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!keys.ok) throw new Error("Signing keys unavailable");
    const { payload } = await jwtVerify(
      credentials.id_token,
      createLocalJWKSet(await keys.json()),
      {
        issuer,
        audience: process.env.LINKEDIN_CLIENT_ID!,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "iat", "exp", "nonce"],
        maxTokenAge: "10m",
      },
    );
    if (
      typeof payload.nonce !== "string" ||
      hash(payload.nonce) !== flow.nonce_hash ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        payload.azp !== process.env.LINKEDIN_CLIENT_ID) ||
      (payload.azp !== undefined &&
        payload.azp !== process.env.LINKEDIN_CLIENT_ID)
    )
      throw new Error("Invalid identity binding");
    const identity = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!identity.ok) throw new Error("Identity unavailable");
    profile = z
      .object({
        sub: z.string().min(1).max(255),
        name: z.string().trim().min(1).max(80),
      })
      .parse(await identity.json());
    if (profile.sub !== payload.sub) throw new Error("Identity mismatch");
  } catch {
    error(
      502,
      "Couldn’t verify your LinkedIn account. Return to Security or your invitation and try again.",
    );
  }
  // Keep no provider credentials: this flow authenticates, it cannot publish.
  const password = flow.invite_hash ? await passwordHash(token()) : null;
  const outcome = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `linkedin-account:${profile.sub}`,
    ]);
    const existing = (
      await client.query(
        "SELECT user_id FROM linkedin_accounts WHERE subject=$1",
        [profile.sub],
      )
    ).rows[0];
    let userId: string;
    let created = false;
    if (flow.user_id) {
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        flow.user_id,
      ]);
      if (existing && existing.user_id !== flow.user_id)
        error(
          409,
          "That LinkedIn account is already linked to another LastPeek account.",
        );
      const linked = (
        await client.query(
          "SELECT subject FROM linkedin_accounts WHERE user_id=$1",
          [flow.user_id],
        )
      ).rows[0];
      if (linked && linked.subject !== profile.sub)
        error(
          409,
          "A different LinkedIn account is already linked. Disconnect it first.",
        );
      userId = flow.user_id;
    } else if (existing) {
      userId = existing.user_id;
    } else {
      if (!flow.invite_hash) redirect(303, "/login?linkedin=unlinked");
      const invite = await client.query(
        "SELECT id,plan FROM invites WHERE hash=$1 AND email=$2 AND expires_at>now() AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE",
        [flow.invite_hash, flow.email],
      );
      if (!invite.rowCount)
        error(400, "This invitation is no longer available.");
      userId = crypto.randomUUID();
      const inserted = await client.query(
        "INSERT INTO users(id,email,name,password_hash,has_password,plan,pro_limits) SELECT $1,$2,$3,$4,false,$5,limits FROM plan_allowances WHERE plan='pro' ON CONFLICT(email) DO NOTHING RETURNING id",
        [userId, flow.email, profile.name, password, invite.rows[0].plan],
      );
      if (!inserted.rowCount)
        error(
          409,
          "An account with that email already exists. Sign in to that account and link LinkedIn from Security.",
        );
      await client.query("UPDATE invites SET used_at=now() WHERE id=$1", [
        invite.rows[0].id,
      ]);
      created = true;
    }
    await client.query(
      "INSERT INTO linkedin_accounts(user_id,subject,name) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET name=EXCLUDED.name,updated_at=now()",
      [userId, profile.sub, profile.name],
    );
    return { userId, created };
  });
  if (!flow.user_id)
    await createSession(
      event.cookies,
      outcome.userId,
      event.url.protocol === "https:",
    );
  redirect(
    303,
    flow.user_id || outcome.created ? "/settings?tab=security" : "/",
  );
}

export async function disconnectLinkedIn(userId: string) {
  await transaction(async (client) => {
    const linked = (
      await client.query(
        "SELECT subject FROM linkedin_accounts WHERE user_id=$1",
        [userId],
      )
    ).rows[0];
    if (linked)
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`linkedin-account:${linked.subject}`],
      );
    const account = (
      await client.query(
        "SELECT has_password FROM users WHERE id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    // Password is always usable even if the LinkedIn trial is subsequently revoked.
    if (!account.has_password)
      error(
        400,
        "Set a password before disconnecting LinkedIn so you can still sign in.",
      );
    await client.query("DELETE FROM linkedin_accounts WHERE user_id=$1", [
      userId,
    ]);
    await client.query("DELETE FROM linkedin_oauth_flows WHERE user_id=$1", [
      userId,
    ]);
  });
}
