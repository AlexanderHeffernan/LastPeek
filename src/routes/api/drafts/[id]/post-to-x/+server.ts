import { json, error } from "@sveltejs/kit";
import { z } from "zod";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { readBody } from "$lib/server/request";
import { postToX } from "$lib/server/x-publishing";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  let body;
  try {
    body = JSON.parse((await readBody(event.request, 2048)).toString("utf8"));
  } catch {
    error(400, "Send a valid posting request.");
  }
  const parsed = z
    .object({
      version: z.number().int().positive(),
      xId: z.string().regex(/^\d{1,30}$/),
    })
    .safeParse(body);
  if (!parsed.success)
    error(400, "Confirm a saved draft and connected X account.");
  return json(
    await postToX(
      user.id,
      event.params.id,
      parsed.data.version,
      parsed.data.xId,
    ),
  );
};
