import { readdir, stat, rm } from "node:fs/promises";
import { db, transaction } from "../src/lib/server/db";
import { mediaDir, mediaPath } from "../src/lib/server/media";
import { mediaIds } from "../src/lib/contracts";
import { avatarDir, avatarPath } from "../src/lib/server/avatars";
try {
  await db.query("DELETE FROM sessions WHERE expires_at<now()");
  await db.query('DELETE FROM auth_sessions WHERE "expiresAt"<now()');
  await db.query('DELETE FROM auth_verifications WHERE "expiresAt"<now()');
  await db.query(
    "DELETE FROM rate_limits WHERE window_at<now()-interval '2 days'",
  );
  await db.query("DELETE FROM x_source_posts WHERE expires_at<now()");
  await transaction(async (client) => {
    // EXCLUSIVE also blocks the ROW SHARE locks taken before save/upload validation.
    await client.query(
      "LOCK TABLE drafts,revisions,media,avatars IN EXCLUSIVE MODE",
    );
    const referenced = new Set(
      (
        await client.query(
          "SELECT content FROM drafts UNION ALL SELECT content FROM revisions",
        )
      ).rows.flatMap((row) => mediaIds(row.content)),
    );
    const stale = (
      await client.query(
        "SELECT id FROM media WHERE created_at<now()-interval '24 hours'",
      )
    ).rows.filter((row) => !referenced.has(row.id));
    for (const row of stale) {
      await rm(mediaPath(row.id), { force: true });
      await client.query("DELETE FROM media WHERE id=$1", [row.id]);
    }
    const avatars = await client.query(`
      DELETE FROM avatars a WHERE a.created_at<now()-interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_id=a.id)
        AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.content->'author'->>'avatar'=a.id::text)
        AND NOT EXISTS (SELECT 1 FROM revisions r WHERE r.content->'author'->>'avatar'=a.id::text)
      RETURNING id
    `);
    for (const row of avatars.rows)
      await rm(avatarPath(row.id), { force: true });
    console.log(`Removed ${stale.length} unattached media files.`);
  });
  const known = new Set(
    (await db.query("SELECT id FROM media")).rows.map((row) => row.id),
  );
  for (const id of await readdir(mediaDir).catch(() => [] as string[])) {
    if (!/^[0-9a-f-]{36}$/i.test(id) || known.has(id)) continue;
    if ((await stat(mediaPath(id))).mtimeMs < Date.now() - 86400000)
      await rm(mediaPath(id), { force: true });
  }
  const knownAvatars = new Set(
    (await db.query("SELECT id FROM avatars")).rows.map((row) => row.id),
  );
  for (const id of await readdir(avatarDir).catch(() => [] as string[])) {
    if (!/^[0-9a-f-]{36}$/i.test(id) || knownAvatars.has(id)) continue;
    if ((await stat(avatarPath(id))).mtimeMs < Date.now() - 86400000)
      await rm(avatarPath(id), { force: true });
  }
} finally {
  await db.end();
}
