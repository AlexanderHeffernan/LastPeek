import { error, redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { createDevSession, devSignIn } from "$lib/server/auth";
import { featureSchema } from "$lib/features";
import { setFeatureAccess } from "$lib/server/features";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => redirect(303, "/login");
// Development only: sign in as the seeded account without a password.
export const actions: Actions = {
  default: async ({ cookies, url }) => {
    if (!devSignIn()) error(404, "Not found");
    const user = (
      await db.query("SELECT id,email FROM users WHERE email=$1", [
        process.env.SEED_EMAIL?.trim().toLowerCase(),
      ])
    ).rows[0];
    if (!user) error(400, "No seeded account. Run npm run db:seed first.");
    for (const feature of featureSchema.options)
      await setFeatureAccess(
        user.email,
        feature,
        true,
        "dev-sign-in",
        "Enable all registered features for the development account.",
      );
    await createDevSession(cookies, user.id, url.protocol === "https:");
    redirect(303, "/");
  },
};
