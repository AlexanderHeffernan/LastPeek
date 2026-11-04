import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { signIn, rateLimit } from "$lib/server/auth";
import { landing } from "$lib/server/landing";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url, cookies }) => {
  if (locals.user) redirect(303, "/");
  return {
    ...landing(cookies),
    xCancelled: url.searchParams.get("x") === "cancelled",
    xUnlinked: url.searchParams.get("x") === "unlinked",
  };
};
export const actions: Actions = {
  default: async (event) => {
    const { request, getClientAddress } = event;
    await rateLimit(`login:${getClientAddress()}`, 20, 900);
    const form = await request.formData();
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!z.email().safeParse(email).success || password.length > 256)
      return fail(400, { message: "Enter your email and password.", email });
    if (!(await signIn(event, email, password)))
      return fail(400, {
        message: "That email and password don’t match.",
        email,
      });
    redirect(303, "/");
  },
};
