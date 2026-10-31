import { fail, redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { requireUser } from "$lib/server/auth";
import { sourcePost } from "$lib/server/x-post";
import { hasFeature } from "$lib/server/features";
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
  }>(
    `SELECT d.id,d.content,d.updated_at,d.created_at,d.shared_revision,d.share_token IS NOT NULL AS shared,
    (SELECT count(*)::int FROM comments c WHERE c.draft_id=d.id AND NOT c.resolved) AS feedback
    FROM drafts d WHERE owner_id=$1 ORDER BY updated_at DESC`,
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
  const openingMedia = drafts.rows.flatMap((d) => d.content.posts[0].media);
  const media = await db.query<Media>(
    "SELECT id,mime,bytes,filename,width,height FROM media WHERE owner_id=$1 AND id=ANY($2::uuid[])",
    [user.id, openingMedia],
  );
  return {
    comments: comments.rows.map((c) => ({
      ...c,
      created_at: c.created_at.toISOString(),
    })),
    xSourcesEnabled: await hasFeature(user.id, "x-source-posts"),
    media: media.rows,
    drafts: drafts.rows.map((d) => ({
      ...d,
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
    await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
      id,
      user.id,
      JSON.stringify(content),
    ]);
    redirect(303, `/drafts/${id}`);
  },
} satisfies Actions;
