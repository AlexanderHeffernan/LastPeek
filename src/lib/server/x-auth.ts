import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { error, redirect, type RequestEvent } from "@sveltejs/kit";
import { z } from "zod";
import { db, transaction } from "./db";
import {
  createSession,
  hash,
  passwordHash,
  rateLimit,
  signingSecret,
  token,
} from "./auth";
import { avatarLimit, storeAvatar } from "./avatars";

const scopes = "tweet.read users.read offline.access";
const cookie = "lastpeek_x_oauth";
export const xAuthEnabled = () =>
  Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
const profileSchema = z.object({
  id: z.string().regex(/^\d{1,30}$/),
  name: z.string().trim().min(1).max(80),
  username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  profile_image_url: z.url().optional(),
});
export type XProfile = z.infer<typeof profileSchema>;

// Tokens are recoverable for future user-specific API features, but not from a
// database backup alone. Keep the private auth key with the media backup.
async function encrypt(value: string) {
  const key = createHash("sha256")
    .update(await signingSecret())
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

export async function startXAuth(event: RequestEvent): Promise<never> {
  if (!xAuthEnabled()) error(503, "X sign-in isn’t configured yet.");
  await rateLimit(`x-auth:${event.getClientAddress()}`, 20, 900);
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
      error(400, "Enter a valid account email before continuing with X.");
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
    verifier = token();
  await db.query("DELETE FROM x_oauth_flows WHERE expires_at<now()");
  await db.query(
    "INSERT INTO x_oauth_flows(state_hash,browser_hash,verifier,origin,user_id,invite_hash,email) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      hash(state),
      hash(browser),
      verifier,
      event.url.origin,
      event.locals.user?.id || null,
      invite ? hash(invite) : null,
      email,
    ],
  );
  event.cookies.set(cookie, browser, {
    path: "/auth/x",
    httpOnly: true,
    sameSite: "lax",
    secure: event.url.protocol === "https:",
    maxAge: 600,
  });
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: `${event.url.origin}/auth/x/callback`,
    scope: scopes,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  redirect(303, url.href, { external: ["https://x.com"] });
}

export async function finishXAuth(event: RequestEvent): Promise<never> {
  if (!xAuthEnabled()) error(503, "X sign-in isn’t configured yet.");
  const state = event.url.searchParams.get("state") || "";
  const browser = event.cookies.get(cookie) || "";
  const result = await db.query(
    "DELETE FROM x_oauth_flows WHERE state_hash=$1 AND browser_hash=$2 AND origin=$3 AND expires_at>now() RETURNING *",
    [hash(state), hash(browser), event.url.origin],
  );
  event.cookies.delete(cookie, { path: "/auth/x" });
  const flow = result.rows[0];
  if (
    !flow ||
    (flow.user_id
      ? event.locals.user?.id !== flow.user_id
      : Boolean(event.locals.user))
  )
    error(
      400,
      "This X sign-in has expired or belongs to another session. Start again.",
    );
  if (event.url.searchParams.has("error"))
    redirect(
      303,
      flow.user_id ? "/settings?x=cancelled" : "/login?x=cancelled",
    );
  const code = event.url.searchParams.get("code");
  if (!code || code.length > 2048)
    error(400, "X did not return a valid authorization code. Start again.");
  let credentials: {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    },
    profile: XProfile;
  try {
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: flow.verifier,
        redirect_uri: `${flow.origin}/auth/x/callback`,
      }),
    });
    if (!response.ok) throw new Error("X token exchange failed");
    credentials = z
      .object({
        access_token: z.string().min(1).max(8192),
        refresh_token: z.string().min(1).max(8192).optional(),
        expires_in: z.number().positive().max(31536000),
        scope: z.string().max(2048),
      })
      .parse(await response.json());
    if (
      !["users.read", "tweet.read"].every((scope) =>
        credentials.scope.split(" ").includes(scope),
      )
    )
      throw new Error("Missing X permissions");
    const identity = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      {
        headers: { Authorization: `Bearer ${credentials.access_token}` },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!identity.ok) throw new Error("X identity unavailable");
    profile = profileSchema.parse((await identity.json()).data);
  } catch {
    error(
      502,
      "Couldn’t connect to X. Return to the account or invitation page and try again.",
    );
  }
  const accessToken = await encrypt(credentials.access_token);
  const refreshToken = credentials.refresh_token
    ? await encrypt(credentials.refresh_token)
    : null;
  // A random, undisclosed password preserves compatibility with the preceding
  // image. X-only users can explicitly set their first password in Account.
  const password = flow.invite_hash ? await passwordHash(token()) : null;
  const outcome = await transaction(async (client) => {
    // Serialize identity claims, including when there isn't an account row yet.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `x-account:${profile.id}`,
    ]);
    const existing = (
      await client.query("SELECT user_id FROM x_accounts WHERE x_id=$1", [
        profile.id,
      ])
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
          "That X account is already linked to another LastPeek account.",
        );
      const linked = (
        await client.query("SELECT x_id FROM x_accounts WHERE user_id=$1", [
          flow.user_id,
        ])
      ).rows[0];
      if (linked && linked.x_id !== profile.id)
        error(
          409,
          "A different X account is already linked. Disconnect it first.",
        );
      userId = flow.user_id;
    } else if (existing) {
      userId = existing.user_id;
    } else {
      if (!flow.invite_hash) redirect(303, "/login?x=unlinked");
      const invite = await client.query(
        "SELECT id,plan FROM invites WHERE hash=$1 AND email=$2 AND expires_at>now() AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE",
        [flow.invite_hash, flow.email],
      );
      if (!invite.rowCount)
        error(400, "This invitation is no longer available.");
      userId = crypto.randomUUID();
      const inserted = await client.query(
        "INSERT INTO users(id,email,name,handle,password_hash,has_password,plan,pro_limits) SELECT $1,$2,$3,$4,$5,false,$6,limits FROM plan_allowances WHERE plan='pro' ON CONFLICT(email) DO NOTHING RETURNING id",
        [
          userId,
          flow.email,
          profile.name,
          profile.username,
          password,
          invite.rows[0].plan,
        ],
      );
      if (!inserted.rowCount)
        error(
          409,
          "An account with that email already exists. Sign in to that account and link X from Account.",
        );
      await client.query("UPDATE invites SET used_at=now() WHERE id=$1", [
        invite.rows[0].id,
      ]);
      created = true;
    }
    await client.query(
      `INSERT INTO x_accounts(user_id,x_id,access_token,refresh_token,expires_at,scope,profile,import_pending)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO UPDATE SET access_token=EXCLUDED.access_token,refresh_token=EXCLUDED.refresh_token,expires_at=EXCLUDED.expires_at,scope=EXCLUDED.scope,profile=EXCLUDED.profile,import_pending=EXCLUDED.import_pending,updated_at=now()`,
      [
        userId,
        profile.id,
        accessToken,
        refreshToken,
        new Date(Date.now() + credentials.expires_in * 1000),
        credentials.scope,
        profile,
        Boolean(flow.user_id),
      ],
    );
    return { userId, created };
  });
  if (!flow.user_id)
    await createSession(
      event.cookies,
      outcome.userId,
      event.url.protocol === "https:",
    );
  let photoFailed = false;
  if (outcome.created && profile.profile_image_url) {
    try {
      await importXAvatar(profile, outcome.userId);
    } catch {
      photoFailed = true;
    }
  }
  redirect(
    303,
    flow.user_id || outcome.created
      ? `/settings?x=${photoFailed ? "photo-failed" : outcome.created ? "joined" : "linked"}`
      : "/",
  );
}

export function xAvatarURL(profile: XProfile) {
  if (!profile.profile_image_url) return null;
  const url = new URL(profile.profile_image_url);
  if (
    url.origin !== "https://pbs.twimg.com" ||
    !url.pathname.startsWith("/profile_images/") ||
    url.username ||
    url.password
  )
    return null;
  url.pathname = url.pathname.replace(/_normal(\.[^/.]+)$/, "$1");
  return url.href;
}

export async function importXAvatar(profile: XProfile, userId: string) {
  const url = xAvatarURL(profile);
  if (!url)
    error(
      400,
      "X didn’t provide a supported profile photo. Upload a photo instead.",
    );
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !response.body)
    error(502, "Couldn’t download the X photo. Try again or upload a photo.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > avatarLimit)
        error(
          413,
          "The X photo is too large. Upload a photo under 5 MB instead.",
        );
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  await storeAvatar(Buffer.concat(chunks), userId);
}
