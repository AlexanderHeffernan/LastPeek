import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { sameOrigin, rateLimit } from "$lib/server/auth";
import { guestCommenter, reactToComment } from "$lib/server/feedback";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  await rateLimit(
    `comment-react:${event.locals.user?.id ?? event.getClientAddress()}`,
    120,
    600,
  );
  const input = z
    .object({
      token: z.string().optional(),
      emoji: z.enum(["👍", "❤️", "🎉"]),
      active: z.boolean(),
    })
    .safeParse(
      await readBody(event.request, 1024)
        .then((body) => JSON.parse(body.toString()))
        .catch(() => null),
    );
  if (!input.success) error(400, "Choose a supported reaction.");
  return json(
    await reactToComment(
      event.params.id,
      event.locals.user?.id,
      guestCommenter(event.cookies, event.url.protocol === "https:", true),
      input.data,
    ),
  );
};
