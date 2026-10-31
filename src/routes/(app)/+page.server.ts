import { fail, redirect, isHttpError } from "@sveltejs/kit";
import { db, transaction } from "$lib/server/db";
import { requireUser } from "$lib/server/auth";
import { sourcePost } from "$lib/server/x-post";
import { isPro, claimDraft } from "$lib/server/plans";
import { X_SOURCE_UNAVAILABLE } from "$lib/x-post";
import {
  blankContent,
  xPostURLSchema,
  type Content,
  type Media,
} from "$lib/contracts";
import type { Actions, PageServerLoadEvent } from "./$types";
export const load = async ({ locals }: PageServerLoadEvent) => {
  const user = requireUser(locals);
  const drafts = await db.query<{
    id: string;
    content: Content;
    updated_at: Date;
    created_at: Date;
    shared: boolean;
    shared_revision: number | null;
    feedback: number;
    posted_at: Date | null;
  }>(
    `SELECT d.id,d.content,d.updated_at,d.created_at,d.shared_revision,d.posted_at,
    (d.share_token IS NOT NULL OR EXISTS (SELECT 1 FROM friend_reviews fr WHERE fr.draft_id=d.id)) AS shared,
    (SELECT count(*)::int FROM comments c WHERE c.draft_id=d.id AND NOT c.resolved) AS feedback
    FROM drafts d WHERE owner_id=$1 ORDER BY updated_at DESC`,
    [user.id],
  );
  const reviews = await db.query<{
    id: string;
    content: Content;
    updated_at: Date;
    created_at: Date;
    completed_at: Date | null;
    token: string;
    feedback: number;
  }>(
    `SELECT d.id,r.content,d.updated_at,fr.created_at,d.friend_token AS token,
      (SELECT max(c.created_at) FROM comments c
       WHERE c.draft_id=d.id AND c.user_id=fr.recipient_id AND c.revision=d.shared_revision) AS completed_at,
      (SELECT count(*)::int FROM comments c WHERE c.draft_id=d.id AND NOT c.resolved) AS feedback
     FROM friend_reviews fr
     JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
     JOIN drafts d ON d.id=fr.draft_id AND d.friend_token IS NOT NULL
     JOIN revisions r ON r.draft_id=d.id AND r.number=d.shared_revision
     WHERE fr.recipient_id=$1 ORDER BY fr.created_at DESC`,
    [user.id],
  );
  const comments = await db.query<{
    id: string;
    draft_id: string;
    name: string;
    avatar_id: string | null;
    body: string;
    suggestion: string | null;
    quote: string | null;
    revision: number;
    resolved: boolean;
    created_at: Date;
  }>(
    `SELECT c.id,c.draft_id,COALESCE(u.name,c.name) AS name,u.avatar_id,c.body,c.suggestion,c.quote,c.revision,c.resolved,c.created_at
     FROM comments c JOIN drafts d ON d.id=c.draft_id
     LEFT JOIN users u ON u.id=c.user_id
     WHERE d.owner_id=$1 AND d.id=ANY($2::uuid[]) ORDER BY c.created_at DESC,c.id DESC`,
    [user.id, drafts.rows.map((draft) => draft.id)],
  );
  const openingMedia = [...drafts.rows, ...reviews.rows].flatMap(
    (d) => d.content.posts[0].media,
  );
  const media = await db.query<Media>(
    "SELECT id,mime,bytes,filename,width,height FROM media WHERE id=ANY($1::uuid[])",
    [openingMedia],
  );
  return {
    comments: comments.rows.map((c) => ({
      ...c,
      created_at: c.created_at.toISOString(),
    })),
    xSourcesEnabled: await isPro(user.id),
    media: media.rows,
    reviews: reviews.rows.map((r) => ({
      ...r,
      shared: true,
      posted_at: r.completed_at?.toISOString() ?? null,
      updated_at: r.updated_at.toISOString(),
      created_at: r.created_at.toISOString(),
      completed_at: r.completed_at?.toISOString() ?? null,
    })),
    drafts: drafts.rows.map((d) => ({
      ...d,
      token: null,
      posted_at: d.posted_at?.toISOString() ?? null,
      content: {
        ...d.content,
        author: {
          name: user.name,
          handle: user.handle,
          avatar: user.avatar_id,
        },
      },
      updated_at: d.updated_at.toISOString(),
      created_at: d.created_at.toISOString(),
    })),
  };
};
export const actions = {
  create: async ({ locals, request }) => {
    const user = requireUser(locals),
      id = crypto.randomUUID();
    const form = await request.formData();
    const kind = form.get("kind");
    const content = blankContent(user.name, user.handle, user.avatar_id);
    if (kind !== null) {
      if (kind !== "quote" && kind !== "reply")
        return fail(400, { error: "Choose a quote or reply.", kind: null });
      const parsed = xPostURLSchema.safeParse(form.get("url"));
      if (!parsed.success)
        return fail(400, { error: parsed.error.issues[0].message, kind });
      if (!(await sourcePost(user.id, parsed.data)))
        return fail(503, { error: X_SOURCE_UNAVAILABLE, kind });
      content.source = { kind, url: parsed.data };
    }
    try {
      await transaction(async (client) => {
        await claimDraft(client, user.id);
        await client.query(
          "INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)",
          [id, user.id, JSON.stringify(content)],
        );
      });
    } catch (cause) {
      if (isHttpError(cause))
        return fail(cause.status, { error: cause.body.message, kind: null });
      throw cause;
    }
    redirect(303, `/drafts/${id}`);
  },
} satisfies Actions;
