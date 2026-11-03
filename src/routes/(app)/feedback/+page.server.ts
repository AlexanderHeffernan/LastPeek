import { redirect } from "@sveltejs/kit";
import { requireUser } from "$lib/server/auth";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  requireUser(locals);
  redirect(307, "/");
};
