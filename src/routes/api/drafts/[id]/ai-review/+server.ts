import { error, json } from "@sveltejs/kit";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { ownedDraft } from "$lib/server/drafts";
import { readBody } from "$lib/server/request";
import { reviewText } from "$lib/server/ai-review";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  await ownedDraft(event.params.id, user.id);
  const raw = await readBody(event.request, 100000);
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    error(400, "Send valid post text to review.");
  }
  return json(await reviewText(user.id, body), {
    headers: { "Cache-Control": "no-store" },
  });
};
