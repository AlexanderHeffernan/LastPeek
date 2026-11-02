import { error, json } from "@sveltejs/kit";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { ownedDraft } from "$lib/server/drafts";
import { readBody } from "$lib/server/request";
import { mentionRequest } from "$lib/x-mentions";
import { lookupMentions } from "$lib/server/x-mentions";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  await ownedDraft(event.params.id, user.id);
  const body = await readBody(event.request, 256);
  let input: unknown;
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    error(400, "Send a mention search or handle.");
  }
  const parsed = mentionRequest.safeParse(input);
  if (!parsed.success) error(400, "Enter a valid X handle.");
  return json(await lookupMentions(user.id, parsed.data), {
    headers: { "Cache-Control": "no-store" },
  });
};
