import { canViewAdmin } from "$lib/server/admin";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals }) => ({
  canViewAdmin: canViewAdmin(locals.user),
});
