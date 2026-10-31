import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  error,
  redirect,
  type Cookies,
  type RequestEvent,
} from "@sveltejs/kit";
import { db } from "./db";
import { betterAuth } from "better-auth";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { APIError } from "better-auth/api";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const bytes = Buffer.from(expected, "hex");
  return bytes.length === derived.length && timingSafeEqual(bytes, derived);
}

// Keep the signing key outside PostgreSQL: database session tokens alone must
// not suffice to forge a signed cookie. The private media backup includes it.
export async function signingSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const directory = process.env.MEDIA_DIR || "./data/media";
  await mkdir(directory, { recursive: true });
  const path = join(directory, ".auth-secret");
  try {
    await writeFile(path, randomBytes(48).toString("base64url"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const secret = await readFile(path, "utf8");
  if (secret.length < 32) throw new Error("Invalid authentication signing key");
  return secret;
}

let secret: ReturnType<typeof signingSecret> | undefined;
const instances = new Map<string, ReturnType<typeof configureAuth>>();
async function configureAuth(origin: string) {
  return betterAuth({
    appName: "LastPeek",
    baseURL: origin,
    secret: await (secret ??= signingSecret()),
    database: db,
    telemetry: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      password: {
        hash: passwordHash,
        verify: ({ password, hash }) => passwordMatches(password, hash),
      },
    },
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        // LastPeek's invite/recovery flows own this compatibility column.
        legacyPassword: {
          type: "string",
          fieldName: "password_hash",
          required: true,
          input: false,
          returned: false,
        },
      },
    },
    account: { modelName: "auth_accounts" },
    session: {
      modelName: "auth_sessions",
      expiresIn: 30 * 86400,
      // Every request checks PostgreSQL; recovery revokes access immediately.
      cookieCache: { enabled: false },
    },
    verification: { modelName: "auth_verifications" },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      cookiePrefix: "lastpeek",
      useSecureCookies: origin.startsWith("https:"),
    },
  });
}

function getAuth(origin: string) {
  let instance = instances.get(origin);
  if (!instance) {
    instance = configureAuth(origin);
    instances.set(origin, instance);
  }
  return instance;
}

export type User = {
  id: string;
  name: string;
  handle: string;
  avatar_id: string | null;
  email: string;
  is_admin: boolean;
};
function setAuthCookies(cookies: Cookies, headers: Headers) {
  for (const [name, attributes] of parseSetCookieHeader(
    headers.get("set-cookie") || "",
  )) {
    cookies.set(name, attributes.value, {
      ...toCookieOptions(attributes),
      path: attributes.path || "/",
    });
  }
}

export async function signIn(
  event: Pick<RequestEvent, "cookies" | "url" | "request">,
  email: string,
  password: string,
) {
  const auth = await getAuth(event.url.origin);
  try {
    const result = await auth.api.signInEmail({
      body: { email, password },
      headers: event.request.headers,
      returnHeaders: true,
    });
    setAuthCookies(event.cookies, result.headers);
    // A successful new login must not leave an older identity cookie behind.
    const legacy = event.cookies.get("lastpeek_session");
    if (legacy)
      await db.query("DELETE FROM sessions WHERE hash=$1", [hash(legacy)]);
    event.cookies.delete("lastpeek_session", { path: "/" });
    return true;
  } catch (error) {
    if (error instanceof APIError && error.status === "UNAUTHORIZED")
      return false;
    throw error;
  }
}

export async function signOut(
  event: Pick<RequestEvent, "cookies" | "url" | "request">,
) {
  const auth = await getAuth(event.url.origin);
  const result = await auth.api.signOut({
    headers: event.request.headers,
    returnHeaders: true,
  });
  setAuthCookies(event.cookies, result.headers);
  const legacy = event.cookies.get("lastpeek_session");
  if (legacy)
    await db.query("DELETE FROM sessions WHERE hash=$1", [hash(legacy)]);
  event.cookies.delete("lastpeek_session", { path: "/" });
}

export async function sessionUser(event: RequestEvent): Promise<User | null> {
  const { cookies } = event;
  // Don't initialize auth or create its key for anonymous review/health requests.
  const authCookie =
    cookies.get("lastpeek.session_token") ||
    cookies.get("__Secure-lastpeek.session_token");
  if (authCookie) {
    const auth = await getAuth(event.url.origin);
    const result = await auth.api.getSession({
      headers: event.request.headers,
      returnHeaders: true,
    });
    setAuthCookies(cookies, result.headers);
    if (!result.response) return null;
    const user = await db.query(
      "SELECT id,name,handle,avatar_id,email,is_admin FROM users WHERE id=$1",
      [result.response.user.id],
    );
    event.locals.pushSession = `auth:${result.response.session.id}`;
    return user.rows[0] ?? null;
  }
  // Hashed author sessions (including X OAuth) remain usable until expiry/revocation.
  const value = cookies.get("lastpeek_session");
  if (!value) return null;
  const result = await db.query(
    "SELECT u.id,u.name,u.handle,u.avatar_id,u.email,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now()",
    [hash(value)],
  );
  if (result.rowCount) event.locals.pushSession = `legacy:${hash(value)}`;
  return result.rows[0] ?? null;
}
export async function createDevSession(
  cookies: Cookies,
  userId: string,
  secure: boolean,
) {
  if (!devSignIn()) error(404, "Not found");
  return createSession(cookies, userId, secure);
}

// X OAuth uses the same hashed, server-side sessions as existing accounts.
export async function createSession(
  cookies: Cookies,
  userId: string,
  secure: boolean,
) {
  cookies.delete("lastpeek.session_token", { path: "/" });
  cookies.delete("__Secure-lastpeek.session_token", { path: "/" });
  const value = token();
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [hash(value), userId],
  );
  cookies.set("lastpeek_session", value, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 30 * 86400,
  });
}
export function requireUser(locals: App.Locals) {
  if (!locals.user) redirect(303, "/login");
  return locals.user;
}
export async function rateLimit(key: string, maximum: number, seconds: number) {
  const result = await db.query(
    `INSERT INTO rate_limits(key,window_at,attempts) VALUES($1,now(),1)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN rate_limits.window_at<now()-make_interval(secs=>$2) THEN 1 ELSE rate_limits.attempts+1 END,
    window_at=CASE WHEN rate_limits.window_at<now()-make_interval(secs=>$2) THEN now() ELSE rate_limits.window_at END RETURNING attempts`,
    [hash(key), seconds],
  );
  if (result.rows[0].attempts > maximum)
    error(429, "Too many attempts. Please try again shortly.");
}
export function sameOrigin(event: RequestEvent) {
  if (event.request.headers.get("origin") !== event.url.origin)
    error(403, "This request must come from LastPeek.");
}
// Passwordless sign-in as the seeded account. Never set DEV_SIGN_IN in production.
export const devSignIn = () =>
  import.meta.env?.DEV === true || process.env.DEV_SIGN_IN === "1";
