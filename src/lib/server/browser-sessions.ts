import { error } from "@sveltejs/kit";
import { db, transaction } from "./db";

// Browser labels are hints from the user agent, never verified device identities.
function browserLabel(agent: string | null) {
  if (!agent) return "Unknown browser";
  const browser = /Edg(?:e|A|iOS)?\//.test(agent)
    ? "Edge"
    : /(?:Firefox|FxiOS)\//.test(agent)
      ? "Firefox"
      : /(?:Chrome|CriOS)\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const platform = /iPhone|iPad|iPod/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Windows/.test(agent)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : null;
  return platform ? `${browser} on ${platform}` : browser;
}

export async function recordBrowserSession(
  session: string,
  userId: string,
  agent: string | null,
) {
  const legacy = session.startsWith("legacy:");
  await db.query(
    legacy
      ? `UPDATE sessions SET last_used_at=now(),user_agent=COALESCE(user_agent,$3)
         WHERE hash=$1 AND user_id=$2
         AND (last_used_at IS NULL OR last_used_at < now()-interval '1 minute')`
      : `UPDATE auth_sessions SET last_used_at=now(),"userAgent"=COALESCE("userAgent",$3)
         WHERE id=$1 AND "userId"=$2
         AND (last_used_at IS NULL OR last_used_at < now()-interval '1 minute')`,
    [
      session.slice(session.indexOf(":") + 1),
      userId,
      agent?.slice(0, 512) || null,
    ],
  );
}

export async function browserSessions(userId: string, current: string) {
  const result = await db.query(
    `SELECT 'auth:'||id AS id,"userAgent" AS agent,"createdAt" AS created_at,
       last_used_at,('auth:'||id=$2) AS current
     FROM auth_sessions WHERE "userId"=$1 AND "expiresAt">now()
     UNION ALL
     SELECT 'legacy:'||id::text,user_agent,created_at,last_used_at,
       ('legacy:'||hash=$2) AS current
     FROM sessions WHERE user_id=$1 AND expires_at>now()
     ORDER BY current DESC,last_used_at DESC NULLS LAST,created_at DESC NULLS LAST`,
    [userId, current],
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    label: browserLabel(row.agent),
    current: row.current as boolean,
    createdAt: row.created_at?.toISOString() as string | undefined,
    lastUsedAt: row.last_used_at?.toISOString() as string | undefined,
  }));
}

export async function revokeBrowserSessions(
  userId: string,
  current: string,
  target: string,
) {
  if (target !== "others" && !/^(auth|legacy):[0-9a-f-]{36}$/i.test(target))
    error(400, "Choose a signed-in browser.");
  await transaction(async (client) => {
    // Serialize management from two browsers before locking either session.
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    // Recheck the requesting session under a lock: a concurrent revocation may
    // have happened after authentication at the start of this request.
    const legacy = current.startsWith("legacy:");
    const active = await client.query(
      legacy
        ? "SELECT hash FROM sessions WHERE hash=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE"
        : 'SELECT id FROM auth_sessions WHERE id=$1 AND "userId"=$2 AND "expiresAt">now() FOR UPDATE',
      [current.slice(current.indexOf(":") + 1), userId],
    );
    if (!active.rowCount) error(401, "Sign in again to manage your sessions.");
    if (target === "others") {
      await client.query(
        `DELETE FROM auth_sessions WHERE "userId"=$1 AND 'auth:'||id<>$2`,
        [userId, current],
      );
      await client.query(
        `DELETE FROM sessions WHERE user_id=$1 AND 'legacy:'||hash<>$2`,
        [userId, current],
      );
    } else {
      const deleted = await client.query(
        target.startsWith("legacy:")
          ? `DELETE FROM sessions WHERE user_id=$1 AND id::text=$2 AND 'legacy:'||hash<>$3 RETURNING id`
          : `DELETE FROM auth_sessions WHERE "userId"=$1 AND id=$2 AND 'auth:'||id<>$3 RETURNING id`,
        [userId, target.slice(target.indexOf(":") + 1), current],
      );
      if (!deleted.rowCount)
        error(
          404,
          "This session is no longer available. Reload and try again.",
        );
    }
  });
}
