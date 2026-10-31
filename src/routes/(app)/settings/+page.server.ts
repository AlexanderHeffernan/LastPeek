import { error, fail, isHttpError, redirect } from "@sveltejs/kit";
import { db, transaction } from "$lib/server/db";
import {
  requireUser,
  passwordHash,
  passwordMatches,
  signIn,
  signOut,
  rateLimit,
} from "$lib/server/auth";
import { planUsage } from "$lib/server/plans";
import { authorSchema } from "$lib/contracts";
import { avatarLimit, storeAvatar } from "$lib/server/avatars";
import {
  importXAvatar,
  xAuthEnabled,
  xAvatarURL,
  type XProfile,
} from "$lib/server/x-auth";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals);
  const account = (
    await db.query("SELECT has_password FROM users WHERE id=$1", [user.id])
  ).rows[0];
  const linked = (
    await db.query(
      "SELECT profile,import_pending,(expires_at<=now() AND refresh_token IS NULL) AS needs_reconnect FROM x_accounts WHERE user_id=$1",
      [user.id],
    )
  ).rows[0];
  const used = (
    await db.query(
      "SELECT ((SELECT COALESCE(sum(bytes),0) FROM media WHERE owner_id=$1)+(SELECT COALESCE(sum(bytes),0) FROM avatars WHERE owner_id=$1))::float8 AS bytes",
      [user.id],
    )
  ).rows[0].bytes;
  const usage = await planUsage(user.id);
  return {
    xEnabled: xAuthEnabled(),
    hasPassword: account.has_password as boolean,
    xProfile: linked ? (linked.profile as XProfile) : null,
    xImportPending: Boolean(linked?.import_pending),
    xPhotoURL: linked ? xAvatarURL(linked.profile as XProfile) : null,
    xNeedsReconnect: Boolean(linked?.needs_reconnect),
    xPhotoImportFailed: url.searchParams.get("x") === "photo-failed",
    used,
    limit: usage.limits.storage_mb * 1024 * 1024,
    usage,
  };
};
export const actions: Actions = {
  importX: async ({ locals, request }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    if (form.get("intent") === "keep") {
      await db.query(
        "UPDATE x_accounts SET import_pending=false WHERE user_id=$1",
        [user.id],
      );
      return { xImported: true };
    }
    await rateLimit(`x-import:${user.id}`, 10, 900);
    const linked = (
      await db.query(
        "SELECT profile FROM x_accounts WHERE user_id=$1 AND import_pending",
        [user.id],
      )
    ).rows[0];
    if (!linked)
      return fail(400, {
        xImportError:
          "This profile selection is no longer available. Reload Account.",
      });
    const profile = linked.profile as XProfile;
    if (form.get("photo") === "on") {
      try {
        await importXAvatar(profile, user.id);
      } catch {
        return fail(400, {
          xImportError:
            "Couldn’t import the X photo. Your other profile fields haven’t changed. Try again or leave the photo unticked.",
        });
      }
    }
    await db.query(
      "UPDATE users SET name=CASE WHEN $1 THEN $2 ELSE name END,handle=CASE WHEN $3 THEN $4 ELSE handle END WHERE id=$5",
      [
        form.get("name") === "on",
        profile.name,
        form.get("handle") === "on",
        profile.username,
        user.id,
      ],
    );
    await db.query(
      "UPDATE x_accounts SET import_pending=false WHERE user_id=$1",
      [user.id],
    );
    return { xImported: true };
  },
  disconnectX: async ({ locals }) => {
    const user = requireUser(locals);
    await transaction(async (client) => {
      const linked = (
        await client.query("SELECT x_id FROM x_accounts WHERE user_id=$1", [
          user.id,
        ])
      ).rows[0];
      // Serialize with callbacks so an in-flight sign-in cannot resurrect a deleted link.
      if (linked)
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`x-account:${linked.x_id}`],
        );
      const account = (
        await client.query(
          "SELECT has_password FROM users WHERE id=$1 FOR UPDATE",
          [user.id],
        )
      ).rows[0];
      if (!account.has_password)
        error(
          400,
          "Set a password before disconnecting X so you can still sign in.",
        );
      await client.query("DELETE FROM x_accounts WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM x_oauth_flows WHERE user_id=$1", [
        user.id,
      ]);
    });
    return { xDisconnected: true };
  },
  profile: async ({ locals, request }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const parsed = authorSchema.safeParse({
      name: String(form.get("name") || ""),
      handle: String(form.get("handle") || "").trim(),
    });
    if (!parsed.success)
      return fail(400, { message: parsed.error.issues[0].message });
    const photo = form.get("photo");
    if (photo instanceof File && photo.size) {
      if (photo.size > avatarLimit)
        return fail(413, { message: "Choose an avatar smaller than 5 MB." });
      await rateLimit(`avatar:${user.id}`, 20, 3600);
      try {
        await storeAvatar(Buffer.from(await photo.arrayBuffer()), user.id);
      } catch (cause) {
        if (isHttpError(cause))
          return fail(cause.status, { message: cause.body.message });
        throw cause;
      }
    } else if (form.get("removePhoto") === "yes") {
      await db.query("UPDATE users SET avatar_id=NULL WHERE id=$1", [user.id]);
    }
    await db.query("UPDATE users SET name=$1,handle=$2 WHERE id=$3", [
      parsed.data.name,
      parsed.data.handle.replace(/^@/, ""),
      user.id,
    ]);
    return { message: "Profile saved." };
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
    const password = await passwordHash(next);
    const changed = await transaction(async (client) => {
      const stored = (
        await client.query(
          "SELECT password_hash,has_password FROM users WHERE id=$1 FOR UPDATE",
          [user.id],
        )
      ).rows[0];
      if (
        stored.has_password &&
        !(await passwordMatches(old, stored.password_hash))
      )
        return false;
      await client.query(
        "UPDATE users SET password_hash=$1,has_password=true WHERE id=$2",
        [password, user.id],
      );
      await client.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      return true;
    });
    if (!changed)
      return fail(400, { message: "The current password doesn’t match." });
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
