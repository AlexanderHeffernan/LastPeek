import { adminData } from "$lib/server/admin";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url, params }) =>
  adminData(locals.user, url.searchParams, params.section);
