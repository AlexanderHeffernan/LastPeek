import { error, json } from "@sveltejs/kit";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { readBody } from "$lib/server/request";
import { reviewDraft, deleteDraftReview } from "$lib/server/ai-review";
import { z } from "zod";
import type { RequestHandler } from "./$types";

export const DELETE: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  const raw = await readBody(event.request, 1000);
  let input;
  try {
    input = JSON.parse(raw.toString("utf8"));
  } catch {
    error(400, "Send a review ID.");
  }
  const parsed = z.object({ reviewId: z.uuid() }).safeParse(input);
  if (!parsed.success) error(400, "Send a valid review ID.");
  await deleteDraftReview(event.params.id, user.id, parsed.data.reviewId);
  return json({ ok: true });
};

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  const raw = await readBody(event.request, 100000);
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    error(400, "Send valid post text to review.");
  }
  return json(await reviewDraft(event.params.id, user.id, body), {
    headers: { "Cache-Control": "no-store" },
  });
};
