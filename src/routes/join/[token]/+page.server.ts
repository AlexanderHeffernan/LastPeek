import { error, fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { db, transaction } from "$lib/server/db";
import { hash, passwordHash, signIn, rateLimit } from "$lib/server/auth";
import { xAuthEnabled } from "$lib/server/x-auth";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals }) => {
  if (locals.user) redirect(303, "/");
  const invitation = (
    await db.query(
      "SELECT email FROM invites WHERE hash=$1 AND email IS NOT NULL AND expires_at>now() AND used_at IS NULL AND revoked_at IS NULL",
      [hash(params.token)],
    )
  ).rows[0];
  if (!invitation)
    error(
      404,
      "This invitation has expired, was revoked, or has already been used. Ask your friend for a new one.",
    );
  return {
    xEnabled: xAuthEnabled(),
    invite: params.token,
    email: invitation.email as string,
  };
};
export const actions: Actions = {
  default: async (event) => {
    const { request, params, getClientAddress } = event;
    await rateLimit(`join:${getClientAddress()}`, 10, 900);
    const form = await request.formData();
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80),
        email: z.email().transform((s) => s.toLowerCase()),
        password: z.string().min(12).max(256),
      })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success)
      return fail(400, {
        message:
          "Enter your name, a valid email and a password of at least 12 characters.",
      });
    const credentials = await passwordHash(parsed.data.password);
    const userId = await transaction(async (client) => {
      const invite = await client.query(
        "SELECT id,email,plan FROM invites WHERE hash=$1 AND email IS NOT NULL AND expires_at>now() AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE",
        [hash(params.token)],
      );
      if (!invite.rowCount)
        error(400, "This invitation is no longer available.");
      if (invite.rows[0].email !== parsed.data.email)
        error(400, "Use the email address this invitation was issued to.");
      const id = crypto.randomUUID();
      const result = await client.query(
        "INSERT INTO users(id,email,name,password_hash,plan,pro_limits) SELECT $1,$2,$3,$4,$5,limits FROM plan_allowances WHERE plan='pro' ON CONFLICT(email) DO NOTHING RETURNING id",
        [
          id,
          parsed.data.email,
          parsed.data.name,
          credentials,
          invite.rows[0].plan,
        ],
      );
      if (!result.rowCount) return null;
      await client.query("UPDATE invites SET used_at=now() WHERE id=$1", [
        invite.rows[0].id,
      ]);
      return id;
    });
    if (!userId)
      return fail(400, {
        message:
          "This account could not be created. If you already have an account, sign in.",
      });
    await signIn(event, parsed.data.email, parsed.data.password);
    redirect(303, "/");
  },
};
