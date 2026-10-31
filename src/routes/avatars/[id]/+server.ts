import { error } from "@sveltejs/kit";
import { readFile } from "node:fs/promises";
import { db } from "$lib/server/db";
import { avatarPath } from "$lib/server/avatars";
import { canViewAdmin } from "$lib/server/admin";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals, url }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) error(404, "Avatar unavailable.");
  const allowed = await db.query(
    `SELECT id FROM avatars WHERE id=$1 AND (
      owner_id=$2 OR ($4 AND EXISTS (SELECT 1 FROM users WHERE avatar_id=avatars.id)) OR EXISTS (
        SELECT 1 FROM drafts d JOIN revisions r ON r.draft_id=d.id
        WHERE d.share_token=$3 AND d.shared_revision IS NOT NULL
          AND r.content->'author'->>'avatar'=$1::text
      ) OR EXISTS (
        SELECT 1 FROM comments c JOIN users u ON u.id=c.user_id
        JOIN drafts d ON d.id=c.draft_id
        WHERE u.avatar_id=$1 AND (d.owner_id=$2 OR (
          d.share_token=$3 AND d.shared_revision IS NOT NULL
        ))
      )
    )`,
    [
      params.id,
      locals.user?.id ?? null,
      url.searchParams.get("key"),
      canViewAdmin(locals.user),
    ],
  );
  if (!allowed.rowCount) error(404, "Avatar unavailable.");
  let bytes;
  try {
    bytes = await readFile(avatarPath(params.id));
  } catch {
    error(404, "Avatar unavailable.");
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
    },
  });
};
