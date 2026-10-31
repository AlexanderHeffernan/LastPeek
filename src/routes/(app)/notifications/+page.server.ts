import { requireUser } from "$lib/server/auth";
import { error, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db";
import type { NotificationKind } from "$lib/notifications";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const rows = (
    await db.query<{
      id: string;
      kind: NotificationKind;
      name: string | null;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT n.id,n.kind,u.name,n.created_at,n.read_at FROM notifications n
     LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=$1
     ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,
      [user.id],
    )
  ).rows;
  return {
    notifications: rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
      read_at: row.read_at?.toISOString() ?? null,
    })),
  };
};
export const actions: Actions = {
  open: async ({ locals, request }) => {
    const user = requireUser(locals);
    const id = z.uuid().safeParse((await request.formData()).get("id"));
    if (!id.success) error(400, "Notification unavailable.");
    const found = await db.query(
      "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND id=$2 RETURNING id",
      [user.id, id.data],
    );
    if (!found.rowCount) error(404, "Notification unavailable.");
    redirect(303, `/notifications/${id.data}`);
  },
  read: async ({ locals }) => {
    const user = requireUser(locals);
    await db.query(
      "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",
      [user.id],
    );
    return {};
  },
  delete: async ({ locals, request }) => {
    const user = requireUser(locals);
    const id = z.uuid().safeParse((await request.formData()).get("id"));
    if (!id.success) error(400, "Notification unavailable.");
    const found = await db.query(
      "DELETE FROM notifications WHERE user_id=$1 AND id=$2 RETURNING id",
      [user.id, id.data],
    );
    if (!found.rowCount) error(404, "Notification unavailable.");
    return {};
  },
  deleteAll: async ({ locals }) => {
    const user = requireUser(locals);
    await db.query("DELETE FROM notifications WHERE user_id=$1", [user.id]);
    return {};
  },
};
