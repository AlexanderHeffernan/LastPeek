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
import { token } from "./auth";

export type Draft = {
  id: string;
  owner_id: string;
  content: Content;
  edit_version: number;
  share_token: string | null;
  shared_revision: number | null;
  updated_at: Date;
};
export async function sharedDraft(shareToken: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(shareToken))
    error(404, "This review link is unavailable. It may have been revoked.");
  const row = (
    await db.query(
      `SELECT d.id,d.owner_id,d.shared_revision,r.content FROM drafts d
       JOIN revisions r ON r.draft_id=d.id AND r.number=d.shared_revision
       WHERE d.share_token=$1`,
      [shareToken],
    )
  ).rows[0];
  if (!row)
    error(404, "This review link is unavailable. It may have been revoked.");
  return {
    id: row.id as string,
    owner_id: row.owner_id as string,
    shared_revision: row.shared_revision as number,
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
  return transaction(async (client) => {
    // Serialize reference validation with media cleanup and draft deletion.
    await client.query(
      "SELECT id FROM drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [id, userId],
    );
    await ownedDraft(id, userId, client);
    const content = await validateContent(raw, id, client);
    const profile = await client.query(
      "SELECT name,handle,avatar_id AS avatar FROM users WHERE id=$1",
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
    if (draft.share_token) {
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

async function snapshotDraft(client: PoolClient, draft: Draft) {
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
      "UPDATE drafts SET share_token=$1,shared_revision=$2 WHERE id=$3",
      [shareToken, number, id],
    );
    return { token: shareToken, revision: number };
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
export async function draftComments(id: string): Promise<Feedback[]> {
  return (
    await db.query(
      "SELECT id,revision,post_id,name,body,suggestion,quote,resolved,created_at FROM comments WHERE draft_id=$1 ORDER BY created_at DESC",
      [id],
    )
  ).rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
}
