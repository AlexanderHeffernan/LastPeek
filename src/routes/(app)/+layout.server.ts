import { requireUser } from "$lib/server/auth";
import type { LayoutServerLoad } from "./$types";
export const load: LayoutServerLoad = ({ locals }) => ({
  user: requireUser(locals),
});
