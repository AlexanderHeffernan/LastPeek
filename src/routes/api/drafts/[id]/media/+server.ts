import { error, json } from "@sveltejs/kit";
import { sameOrigin, requireUser, rateLimit } from "$lib/server/auth";
import { ownedDraft } from "$lib/server/drafts";
import { uploadLimit, storeMedia } from "$lib/server/media";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  await ownedDraft(event.params.id, user.id);
  await rateLimit(`upload:${user.id}`, 60, 3600);
  const body = await readBody(event.request, uploadLimit + 65536);
  const form = await new Response(body, {
    headers: {
      "content-type": event.request.headers.get("content-type") || "",
    },
  })
    .formData()
    .catch(() => error(400, "Choose a file to upload."));
  const file = form.get("file");
  if (!(file instanceof File)) error(400, "Choose a file to upload.");
  return json(
    await storeMedia(
      Buffer.from(await file.arrayBuffer()),
      file.name,
      event.params.id,
      user.id,
    ),
    { status: 201 },
  );
};
