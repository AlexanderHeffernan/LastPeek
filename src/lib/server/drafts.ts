import { error } from "@sveltejs/kit";
import type { PoolClient, Pool } from "pg";
import {
  contentSchema,
  mediaIds,
  hasContent,
  type Content,
  type Media,
  type Feedback,
} from "../contracts";
import { db, transaction } from "./db";
import { notify } from "./notifications";
import { token } from "./auth";
import { claimDraft, isPro } from "./plans";
import { sourcePost } from "./x-post";
import { X_SOURCE_UNAVAILABLE } from "../x-post";

export async function createDraft(
  id: string,
  userId: string,
  content: Content,
) {
  await transaction(async (client) => {
    await claimDraft(client, userId);
    await client.query(
      "INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)",
      [id, userId, JSON.stringify(content)],
    );
  });
}

export type Draft = {
  id: string;
  owner_id: string;
  content: Content;
  edit_version: number;
  share_token: string | null;
  friend_token: string | null;
  shared_revision: number | null;
  posted_at: Date | null;
  updated_at: Date;
};
export async function sharedDraft(shareToken: string, userId?: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(shareToken))
    error(404, "This review link is unavailable. It may have been revoked.");
  const row = (
    await db.query(
      `SELECT d.id,d.owner_id,d.shared_revision,r.content,d.friend_token IS NOT NULL AS private,d.posted_at,
       CASE WHEN d.posted_at IS NOT NULL THEN COALESCE(
         'https://x.com/' || COALESCE(NULLIF(x.profile->>'username',''),'i/web') || '/status/' || p.post_id,
         l.url) END AS posted_url
       FROM drafts d
       JOIN revisions r ON r.draft_id=d.id AND r.number=d.shared_revision
       LEFT JOIN x_publications p ON p.draft_id=d.id AND p.status='posted'
       LEFT JOIN posted_x_links l ON l.draft_id=d.id AND l.status='linked'
       LEFT JOIN x_accounts x ON x.user_id=d.owner_id
       WHERE d.share_token=$1 OR (d.friend_token=$1 AND
         (d.owner_id=$2 OR EXISTS (SELECT 1 FROM friend_reviews fr
          JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
          WHERE fr.draft_id=d.id AND fr.recipient_id=$2)))`,
      [shareToken, userId ?? null],
    )
  ).rows[0];
  if (!row)
    error(404, "This review link is unavailable. It may have been revoked.");
  return {
    id: row.id as string,
    owner_id: row.owner_id as string,
    private: row.private as boolean,
    shared_revision: row.shared_revision as number,
    posted_at: row.posted_at as Date | null,
    posted_url: row.posted_url as string | null,
    content: contentSchema.parse(row.content),
  };
}
export async function ownedDraft(
  id: string,
  ownerId: string,
  client: Pool | PoolClient = db,
): Promise<Draft> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) error(404, "Draft not found.");
  const result = await client.query(
    "SELECT * FROM drafts WHERE id=$1 AND owner_id=$2",
    [id, ownerId],
  );
  if (!result.rows[0]) error(404, "Draft not found.");
  return result.rows[0];
}
export async function validateContent(
  raw: unknown,
  draftId: string,
  client: PoolClient,
) {
  const parsed = contentSchema.safeParse(raw);
  if (!parsed.success) error(400, parsed.error.issues[0].message);
  const ids = mediaIds(parsed.data);
  const result = await client.query(
    "SELECT id,mime FROM media WHERE draft_id=$1 AND id=ANY($2::uuid[])",
    [draftId, ids],
  );
  if (result.rowCount !== ids.length)
    error(400, "An attachment is unavailable. Upload it again.");
  for (const post of parsed.data.posts) {
    const items = result.rows.filter((m) => post.media.includes(m.id));
    if (items.some((m) => m.mime.startsWith("video/")) && items.length !== 1)
      error(400, "A video must be the only attachment on its post.");
    if (items.some((m) => m.mime === "image/gif") && items.length !== 1)
      error(400, "An animated GIF must be the only attachment on its post.");
  }
  return parsed.data;
}
export async function saveDraft(
  id: string,
  userId: string,
  raw: unknown,
  version: number,
) {
  const parsedSource = contentSchema.safeParse(raw);
  const previous = version > 0 ? await ownedDraft(id, userId) : null;
  const sourceChanged =
    parsedSource.success &&
    (previous?.content.source?.kind !== parsedSource.data.source?.kind ||
      previous?.content.source?.url !== parsedSource.data.source?.url);
  if (version === 0 && parsedSource.success && parsedSource.data.source)
    error(400, "Create replies and quotes from an X post link.");
  if (sourceChanged && previous) {
    if (previous.edit_version !== version)
      error(409, "This draft changed. Reload before changing its type.");
    if (
      previous.posted_at ||
      (await db.query("SELECT 1 FROM x_publications WHERE draft_id=$1", [id]))
        .rowCount
    )
      error(409, "Draft type cannot change after publishing has started.");
  }
  if (sourceChanged && parsedSource.success && parsedSource.data.source) {
    if (!(await isPro(userId))) error(403, "Replies and quotes require Pro.");
    if (
      previous?.content.source?.url !== parsedSource.data.source.url &&
      !(await sourcePost(userId, parsedSource.data.source.url))
    )
      error(400, X_SOURCE_UNAVAILABLE);
  }
  return transaction(async (client) => {
    if (version === 0) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) error(400, "Invalid draft ID.");
      const parsed = contentSchema.safeParse(raw);
      if (!parsed.success) error(400, parsed.error.issues[0].message);
      if (parsed.data.source)
        error(400, "Create replies and quotes from an X post link.");
      await claimDraft(client, userId);
      await client.query(
        `INSERT INTO drafts(id,owner_id,content,edit_version) VALUES($1,$2,$3,0)
         ON CONFLICT (id) DO NOTHING`,
        [id, userId, JSON.stringify(parsed.data)],
      );
    }
    // Serialize reference validation with media cleanup and draft deletion.
    await client.query(
      "SELECT id FROM drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [id, userId],
    );
    const current = await ownedDraft(id, userId, client);
    if (
      sourceChanged &&
      (current.posted_at ||
        (
          await client.query("SELECT 1 FROM x_publications WHERE draft_id=$1", [
            id,
          ])
        ).rowCount)
    )
      error(409, "Draft type cannot change after publishing has started.");
    const content = await validateContent(raw, id, client);
    const profile = await client.query(
      "SELECT u.name,COALESCE(x.profile->>'username','') AS handle,u.avatar_id AS avatar FROM users u LEFT JOIN x_accounts x ON x.user_id=u.id WHERE u.id=$1",
      [userId],
    );
    content.author = profile.rows[0];
    const result = await client.query(
      "UPDATE drafts SET content=$1,edit_version=edit_version+1,updated_at=now() WHERE id=$2 AND owner_id=$3 AND edit_version=$4 RETURNING edit_version",
      [JSON.stringify(content), id, userId, version],
    );
    if (!result.rows[0])
      error(
        409,
        "This draft changed in another tab. Your edits are still here. Copy them before reloading.",
      );
    const draft = await ownedDraft(id, userId, client);
    let revision = draft.shared_revision;
    if (draft.share_token || draft.friend_token) {
      revision = await snapshotDraft(client, draft);
      await client.query("UPDATE drafts SET shared_revision=$1 WHERE id=$2", [
        revision,
        id,
      ]);
    }
    return {
      version: result.rows[0].edit_version as number,
      author: content.author,
      revision,
    };
  });
}

export async function snapshotDraft(client: PoolClient, draft: Draft) {
  const last = await client.query(
    "SELECT number,content FROM revisions WHERE draft_id=$1 ORDER BY number DESC LIMIT 1",
    [draft.id],
  );
  let number = last.rows[0]?.number ?? 0;
  if (
    !last.rows[0] ||
    JSON.stringify(last.rows[0].content) !== JSON.stringify(draft.content)
  ) {
    number++;
    await client.query(
      "INSERT INTO revisions(draft_id,number,content) VALUES($1,$2,$3)",
      [draft.id, number, JSON.stringify(draft.content)],
    );
  }
  return number;
}
export async function publishDraft(
  id: string,
  userId: string,
  version: number,
) {
  return transaction(async (client) => {
    await client.query("SELECT id FROM drafts WHERE id=$1 FOR UPDATE", [id]);
    const draft = await ownedDraft(id, userId, client);
    if (draft.edit_version !== version)
      error(409, "The draft changed. Save your latest edits before sharing.");
    if (!hasContent(draft.content))
      error(400, "Write a post or add media before sharing.");
    const number = await snapshotDraft(client, draft);
    const shareToken = draft.share_token ?? token();
    await client.query(
      "UPDATE drafts SET share_token=$1,shared_revision=$2,friend_token=NULL WHERE id=$3",
      [shareToken, number, id],
    );
    await client.query("DELETE FROM friend_reviews WHERE draft_id=$1", [id]);
    return { token: shareToken, revision: number };
  });
}
export async function shareWithFriend(
  id: string,
  userId: string,
  version: number,
  recipientId: string,
) {
  return transaction(async (client) => {
    await client.query("SELECT id FROM drafts WHERE id=$1 FOR UPDATE", [id]);
    const draft = await ownedDraft(id, userId, client);
    if (draft.edit_version !== version)
      error(409, "Save your latest edits before sharing.");
    if (!hasContent(draft.content))
      error(400, "Write a post or add media before sharing.");
    const friendship = (
      await client.query(
        `SELECT id FROM friendships WHERE accepted_at IS NOT NULL
      AND ((requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1)) FOR SHARE`,
        [userId, recipientId],
      )
    ).rows[0];
    if (!friendship) error(400, "Choose an accepted friend.");
    const revision = await snapshotDraft(client, draft);
    const key = draft.friend_token ?? token();
    await client.query(
      "UPDATE drafts SET share_token=NULL,friend_token=$1,shared_revision=$2 WHERE id=$3",
      [key, revision, id],
    );
    const added = await client.query(
      `INSERT INTO friend_reviews(draft_id,recipient_id,friendship_id) VALUES($1,$2,$3)
      ON CONFLICT DO NOTHING RETURNING draft_id`,
      [id, recipientId, friendship.id],
    );
    if (added.rowCount)
      await notify(client, {
        userId: recipientId,
        actorId: userId,
        kind: "shared_draft",
        draftId: id,
      });
    return { token: key, revision };
  });
}
export async function draftMedia(id: string): Promise<Media[]> {
  return (
    await db.query(
      "SELECT id,mime,bytes::float8,filename,width,height FROM media WHERE draft_id=$1 ORDER BY created_at",
      [id],
    )
  ).rows;
}
export async function draftComments(
  id: string,
  userId?: string,
  guestHash?: string,
): Promise<Feedback[]> {
  return (
    await db.query(
      `SELECT c.id,c.user_id,c.agent_name,c.revision,c.post_id,c.parent_id,c.thread_parent_id,c.media_id,c.media_time,COALESCE(u.name,c.name) AS name,
       u.avatar_id,COALESCE(x.profile->>'username','') AS handle,c.body,c.suggestion,c.quote,c.resolved,c.created_at,
       c.deleted_at,c.edited_at,c.edit_version,
       (c.deleted_at IS NULL AND (c.user_id=$2 OR (c.user_id IS NULL AND c.guest_hash=$3))) IS TRUE AS can_manage,
       EXISTS(SELECT 1 FROM notifications n WHERE n.comment_id=c.id AND n.user_id=$2 AND n.read_at IS NULL) AS unread_notification,
       COALESCE((SELECT jsonb_agg(reaction ORDER BY reaction.emoji) FROM (
         SELECT cr.emoji,count(*)::int AS count,bool_or(cr.user_id=$2 OR ($2::uuid IS NULL AND cr.user_id IS NULL AND cr.guest_hash=$3)) IS TRUE AS mine
         FROM comment_reactions cr WHERE cr.comment_id=c.id GROUP BY cr.emoji
       ) reaction),'[]'::jsonb) AS reactions,
       (SELECT p FROM jsonb_array_elements(r.content->'posts') p WHERE p->>'id'=c.post_id::text) AS original_post,
       r.content->'source' AS original_source
       FROM comments c LEFT JOIN users u ON u.id=c.user_id
       LEFT JOIN x_accounts x ON x.user_id=u.id
       JOIN revisions r ON r.draft_id=c.draft_id AND r.number=c.revision
       WHERE c.draft_id=$1 ORDER BY c.created_at DESC,c.id DESC`,
      [id, userId ?? null, guestHash ?? null],
    )
  ).rows.map((row) => ({
    ...row,
    created_at: row.created_at.toISOString(),
    deleted_at: row.deleted_at?.toISOString() ?? null,
    edited_at: row.edited_at?.toISOString() ?? null,
  }));
}
