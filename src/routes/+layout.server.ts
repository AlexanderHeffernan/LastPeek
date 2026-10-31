import { canViewAdmin } from "$lib/server/admin";
import { connections } from "$lib/server/friends";
import { db } from "$lib/server/db";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => ({
  canViewAdmin: canViewAdmin(locals.user),
  connections: locals.user ? await connections(locals.user.id) : [],
  viewerId: locals.user?.id ?? null,
  unreadNotifications: locals.user
    ? Number(
        (
          await db.query(
            "SELECT count(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL",
            [locals.user.id],
          )
        ).rows[0].count,
      )
    : 0,
});
