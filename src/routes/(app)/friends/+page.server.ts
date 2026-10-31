import { requireUser } from "$lib/server/auth";
import { connections } from "$lib/server/friends";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ locals }) => ({
  connections: await connections(requireUser(locals).id),
});
