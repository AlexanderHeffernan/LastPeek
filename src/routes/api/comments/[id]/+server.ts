import { json, error } from "@sveltejs/kit";
import { sameOrigin, rateLimit } from "$lib/server/auth";
import { changeComment, guestCommenter } from "$lib/server/feedback";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  await rateLimit(
    `comment-edit:${event.locals.user?.id ?? event.getClientAddress()}`,
    60,
    600,
  );
  let input;
  try {
    input = JSON.parse((await readBody(event.request, 12000)).toString("utf8"));
  } catch {
    error(400, "Send a valid message action.");
  }
  if (
    !input ||
    !["edit", "delete"].includes(input.action) ||
    (input.token !== undefined && typeof input.token !== "string") ||
    !Number.isInteger(input.version) ||
    (input.action === "edit" &&
      (typeof input.body !== "string" ||
        !input.body.trim() ||
        input.body.length > 2000))
  )
    error(400, "Write a message of up to 2,000 characters.");
  return json(
    await changeComment(
      event.params.id,
      event.locals.user?.id,
      guestCommenter(event.cookies, event.url.protocol === "https:"),
      {
        token: input.token,
        version: input.version,
        body: input.body,
        remove: input.action === "delete",
      },
    ),
  );
};
