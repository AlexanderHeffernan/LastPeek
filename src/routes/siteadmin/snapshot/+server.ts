import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
  adminData,
  requireOwner,
  setAdminAccess,
  setAccountFeature,
} from "$lib/server/admin";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { featureChangeSchema } from "$lib/features";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, url }) =>
  json(await adminData(locals.user, url.searchParams));

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  requireOwner(event.locals.user);
  const parsed = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("admin-access"),
          userId: z.uuid(),
          enabled: z.boolean(),
        })
        .strict(),
      featureChangeSchema
        .safeExtend({
          action: z.literal("feature-access"),
          userId: z.uuid(),
        })
        .strict(),
      featureChangeSchema
        .safeExtend({
          action: z.literal("all-feature-access"),
        })
        .strict(),
    ])
    .safeParse(
      await readBody(event.request, 4096)
        .then((body) => JSON.parse(body.toString("utf8")))
        .catch(() => null),
    );
  if (!parsed.success)
    return json(
      { message: "Check the account, change and required fields." },
      { status: 400 },
    );
  const actor = requireUser(event.locals);
  const command = parsed.data;
  if (
    command.action === "feature-access" ||
    command.action === "all-feature-access"
  ) {
    await setAccountFeature(
      actor,
      command.action === "all-feature-access" ? null : command.userId,
      command.feature,
      command.enabled,
      command.reason,
    );
    return json({ ok: true });
  }
  await setAdminAccess(actor, command.userId, command.enabled);
  return json({ ok: true });
};
