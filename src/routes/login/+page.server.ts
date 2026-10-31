import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { signIn, rateLimit, devSignIn } from "$lib/server/auth";
import { xAuthEnabled } from "$lib/server/x-auth";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) redirect(303, "/");
  return {
    devSignIn: devSignIn(),
    xEnabled: xAuthEnabled(),
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
