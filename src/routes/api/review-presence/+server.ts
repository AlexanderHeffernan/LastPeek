import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { hash, token, sameOrigin, rateLimit } from "$lib/server/auth";
import { ownedDraft, sharedDraft } from "$lib/server/drafts";
import { db } from "$lib/server/db";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";

const schema = z
  .object({
    draftId: z.uuid().optional(),
    connection: z.uuid(),
    token: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    name: z.string().trim().max(80).default(""),
    leave: z.boolean().default(false),
  })
  .strict()
  .refine((value) => !!value.draftId !== !!value.token);

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  await rateLimit(`review-presence:${event.getClientAddress()}`, 240, 60);
  const input = schema.safeParse(
    await readBody(event.request, 2048)
      .then((body) => JSON.parse(body.toString()))
      .catch(() => null),
  );
  if (!input.success) error(400, "Invalid review presence request.");
  const data = input.data;
  const draft = data.token
    ? await sharedDraft(data.token, event.locals.user?.id)
    : event.locals.user
      ? await ownedDraft(data.draftId!, event.locals.user.id)
      : error(404, "Draft not found.");
  let viewer = event.cookies.get("lastpeek_viewer");
  if (!viewer || !/^[A-Za-z0-9_-]{43}$/.test(viewer)) {
    viewer = token();
    event.cookies.set("lastpeek_viewer", viewer, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: event.url.protocol === "https:",
      maxAge: 86400,
    });
  }
  const viewerHash = hash(`${viewer}:${data.connection}`);
  if (data.leave) {
    await db.query(
      "DELETE FROM review_presence WHERE draft_id=$1 AND viewer_hash=$2",
      [draft.id, viewerHash],
    );
    return json({ viewers: [], activity: null });
  }
  await db.query(
    `INSERT INTO review_presence(draft_id,viewer_hash,user_id,guest_name) VALUES($1,$2,$3,$4)
     ON CONFLICT(draft_id,viewer_hash) DO UPDATE SET user_id=$3,guest_name=$4,seen_at=now()`,
    [draft.id, viewerHash, event.locals.user?.id ?? null, data.name || "Guest"],
  );
  const viewers = await db.query(
    `SELECT DISTINCT ON (COALESCE(p.user_id::text,p.viewer_hash))
       COALESCE(p.user_id::text,p.viewer_hash) AS id,
       COALESCE(u.name,p.guest_name) AS name,u.avatar_id,p.user_id IS NULL AS guest
     FROM review_presence p LEFT JOIN users u ON u.id=p.user_id
     JOIN drafts d ON d.id=p.draft_id
     WHERE p.draft_id=$1 AND p.seen_at>now()-interval '20 seconds'
       AND p.viewer_hash<>$2 AND (p.user_id IS NULL OR p.user_id IS DISTINCT FROM $3::uuid)
       AND (p.user_id=d.owner_id OR d.share_token IS NOT NULL OR
         (d.friend_token IS NOT NULL AND EXISTS (
           SELECT 1 FROM friend_reviews fr JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
           WHERE fr.draft_id=d.id AND fr.recipient_id=p.user_id)))
     ORDER BY COALESCE(p.user_id::text,p.viewer_hash),p.seen_at DESC LIMIT 30`,
    [draft.id, viewerHash, event.locals.user?.id ?? null],
  );
  const activity = (
    await db.query(
      `SELECT d.edit_version::text || ':' || COALESCE(d.shared_revision::text,'') || ':' ||
       (SELECT md5(COALESCE(string_agg(c.id::text || c.resolved::text,',' ORDER BY c.id),''))
        FROM comments c WHERE c.draft_id=d.id) AS stamp FROM drafts d WHERE d.id=$1`,
      [draft.id],
    )
  ).rows[0]?.stamp;
  return json({ viewers: viewers.rows, activity });
};
