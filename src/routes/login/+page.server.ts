import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db";
import {
  createSession,
  passwordHash,
  passwordMatches,
  rateLimit,
} from "$lib/server/auth";
import type { Actions, PageServerLoad } from "./$types";

// Prepare once: missing accounts must not do a second derivation per request.
const unavailablePasswordHash = passwordHash("unavailable-account");

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, "/");
};
export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    await rateLimit(`login:${getClientAddress()}`, 20, 900);
    const form = await request.formData();
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!z.email().safeParse(email).success || password.length > 256)
      return fail(400, { message: "Enter your email and password.", email });
    const user = (await db.query("SELECT * FROM users WHERE email=$1", [email]))
      .rows[0];
    // A missing account also pays the password-derivation cost.
    const valid = await passwordMatches(
      password,
      user?.password_hash ?? (await unavailablePasswordHash),
    );
    if (!user || !valid)
      return fail(400, {
        message: "That email and password don’t match.",
        email,
      });
    await createSession(cookies, user.id, url.protocol === "https:");
    redirect(303, "/");
  },
};
