import { error, fail, redirect } from "@sveltejs/kit";
import { db, transaction } from "$lib/server/db";
import {
  requireUser,
  token,
  hash,
  passwordHash,
  passwordMatches,
  signIn,
  signOut,
  rateLimit,
} from "$lib/server/auth";
import { storageLimit } from "$lib/server/media";
import { authorSchema } from "$lib/contracts";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const used = (
    await db.query(
      "SELECT ((SELECT COALESCE(sum(bytes),0) FROM media WHERE owner_id=$1)+(SELECT COALESCE(sum(bytes),0) FROM avatars WHERE owner_id=$1))::float8 AS bytes",
      [user.id],
    )
  ).rows[0].bytes;
  const invites = user.is_admin
    ? (
        await db.query(
          "SELECT id,expires_at,used_at,revoked_at FROM invites WHERE created_by=$1 ORDER BY created_at DESC LIMIT 20",
          [user.id],
        )
      ).rows
    : [];
  return {
    used,
    limit: storageLimit,
    invites: invites.map((i) => ({
      ...i,
      expires_at: i.expires_at.toISOString(),
      used_at: i.used_at?.toISOString(),
      revoked_at: i.revoked_at?.toISOString(),
    })),
  };
};
export const actions: Actions = {
  profile: async ({ locals, request }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const parsed = authorSchema.safeParse({
      name: String(form.get("name") || ""),
      handle: String(form.get("handle") || "").trim(),
    });
    if (!parsed.success)
      return fail(400, { message: parsed.error.issues[0].message });
    await db.query("UPDATE users SET name=$1,handle=$2 WHERE id=$3", [
      parsed.data.name,
      parsed.data.handle.replace(/^@/, ""),
      user.id,
    ]);
    return { message: "Profile saved." };
  },
  invite: async ({ locals, url }) => {
    const user = requireUser(locals);
    if (!user.is_admin) error(403, "Only administrators can invite authors.");
    await rateLimit(`invite:${user.id}`, 20, 86400);
    const value = token();
    await db.query(
      "INSERT INTO invites(id,hash,created_by,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [crypto.randomUUID(), hash(value), user.id],
    );
    return { inviteURL: `${url.origin}/join/${value}` };
  },
  revoke: async ({ locals, request }) => {
    const user = requireUser(locals);
    if (!user.is_admin)
      error(403, "Only administrators can revoke invitations.");
    const id = String((await request.formData()).get("id"));
    if (!/^[0-9a-f-]{36}$/i.test(id)) error(400, "Invalid invitation.");
    await db.query(
      "UPDATE invites SET revoked_at=now() WHERE id=$1 AND created_by=$2 AND used_at IS NULL",
      [id, user.id],
    );
    return { message: "Invitation revoked." };
  },
  password: async (event) => {
    const { locals, request } = event;
    const user = requireUser(locals);
    await rateLimit(`password:${user.id}`, 10, 900);
    const form = await request.formData(),
      old = String(form.get("current") || ""),
      next = String(form.get("password") || "");
    if (old.length > 256 || next.length < 12 || next.length > 256)
      return fail(400, {
        message: "Use a new password between 12 and 256 characters.",
      });
    const stored = (
      await db.query("SELECT password_hash FROM users WHERE id=$1", [user.id])
    ).rows[0];
    if (!(await passwordMatches(old, stored.password_hash)))
      return fail(400, { message: "The current password doesn’t match." });
    const password = await passwordHash(next);
    await transaction(async (client) => {
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        password,
        user.id,
      ]);
      await client.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
    });
    await signIn(event, user.email, next);
    return {
      message: "Password changed. Other sessions have been signed out.",
    };
  },
  logout: async (event) => {
    await signOut(event);
    redirect(303, "/login");
  },
};
