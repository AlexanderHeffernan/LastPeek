import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { requireUser } from "$lib/server/auth";
import { blankContent } from "$lib/contracts";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const drafts = await db.query(
    `SELECT d.id,d.content,d.updated_at,d.shared_revision,d.share_token IS NOT NULL AS shared,
    (SELECT count(*)::int FROM comments c WHERE c.draft_id=d.id AND NOT c.resolved) AS feedback
    FROM drafts d WHERE owner_id=$1 ORDER BY updated_at DESC`,
    [user.id],
  );
  return {
    drafts: drafts.rows.map((d) => ({
      ...d,
      updated_at: d.updated_at.toISOString(),
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
