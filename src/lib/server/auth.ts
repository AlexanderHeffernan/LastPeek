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
export type User = {
  id: string;
  name: string;
  handle: string;
  avatar_id: string | null;
  email: string;
  is_admin: boolean;
};
export async function sessionUser(cookies: Cookies): Promise<User | null> {
  const value = cookies.get("lastpeek_session");
  if (!value) return null;
  const result = await db.query(
    "SELECT u.id,u.name,u.handle,u.avatar_id,u.email,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now()",
    [hash(value)],
  );
  return result.rows[0] ?? null;
}
export async function createSession(
  cookies: Cookies,
  userId: string,
  secure: boolean,
) {
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
