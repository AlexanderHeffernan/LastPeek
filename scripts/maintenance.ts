import { readdir, stat, rm } from "node:fs/promises";
import { db, transaction } from "../src/lib/server/db";
import { mediaDir, mediaPath } from "../src/lib/server/media";
import { mediaIds } from "../src/lib/contracts";
try {
  await db.query("DELETE FROM sessions WHERE expires_at<now()");
  await db.query(
    "DELETE FROM rate_limits WHERE window_at<now()-interval '2 days'",
  );
  await transaction(async (client) => {
    // EXCLUSIVE also blocks the ROW SHARE locks taken before save/upload validation.
    await client.query("LOCK TABLE drafts,revisions,media IN EXCLUSIVE MODE");
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
} finally {
  await db.end();
}
