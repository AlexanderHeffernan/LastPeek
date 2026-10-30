import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { requireUser } from "$lib/server/auth";
import { blankContent, type Content, type Media } from "$lib/contracts";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const drafts = await db.query<{
    id: string;
    content: Content;
    updated_at: Date;
    created_at: Date;
    shared: boolean;
    feedback: number;
  }>(
    `SELECT d.id,d.content,d.updated_at,d.created_at,d.share_token IS NOT NULL AS shared,
    (SELECT count(*)::int FROM comments c WHERE c.draft_id=d.id AND NOT c.resolved) AS feedback
    FROM drafts d WHERE owner_id=$1 ORDER BY updated_at DESC`,
    [user.id],
  );
  const openingMedia = drafts.rows.flatMap((d) => d.content.posts[0].media);
  const media = await db.query<Media>(
    "SELECT id,mime,bytes,filename,width,height FROM media WHERE owner_id=$1 AND id=ANY($2::uuid[])",
    [user.id, openingMedia],
  );
  return {
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
export const actions: Actions = {
  create: async ({ locals }) => {
    const user = requireUser(locals),
      id = crypto.randomUUID();
    await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
      id,
      user.id,
      JSON.stringify(blankContent(user.name, user.handle, user.avatar_id)),
    ]);
    redirect(303, `/drafts/${id}`);
  },
};
