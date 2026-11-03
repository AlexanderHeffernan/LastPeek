import { error, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { requireUser } from "$lib/server/auth";
import { db } from "$lib/server/db";
import {
  discussionInbox,
  discussionDestination,
} from "$lib/server/discussions";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ locals }) => ({
  discussions: await discussionInbox(requireUser(locals).id),
});
export const actions: Actions = {
  open: async ({ locals, request }) => {
    const user = requireUser(locals);
    const id = z.uuid().safeParse((await request.formData()).get("id"));
    if (!id.success) error(400, "Choose a conversation.");
    const conversation = await discussionDestination(user.id, id.data);
    await db.query(
      `INSERT INTO discussion_reads(user_id,comment_id) VALUES($1,$2)
      ON CONFLICT(user_id,comment_id) DO UPDATE SET read_at=now()`,
      [user.id, conversation.root],
    );
    redirect(303, conversation.href);
  },
};
