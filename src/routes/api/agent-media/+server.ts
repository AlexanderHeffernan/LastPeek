import { error, json } from "@sveltejs/kit";
import { agentTransfer, uploadTransfer } from "$lib/server/agent-media";
import { mediaResponse } from "$lib/server/media";
import { db } from "$lib/server/db";
import { rateLimit } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, url }) => {
  if (
    request.headers.has("origin") &&
    request.headers.get("origin") !== url.origin
  )
    error(403, "Origin not allowed.");
  const grant = await agentTransfer(request, "upload");
  await rateLimit(`upload:${grant.user_id}`, 60, 3600);
  return json(await uploadTransfer(request), {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
};
export const GET: RequestHandler = async ({ request, url }) => {
  if (
    request.headers.has("origin") &&
    request.headers.get("origin") !== url.origin
  )
    error(403, "Origin not allowed.");
  const grant = await agentTransfer(request, "download");
  const media = (
    await db.query(
      "SELECT id,mime,filename FROM media WHERE id=$1 AND draft_id=$2",
      [grant.media_id, grant.draft_id],
    )
  ).rows[0];
  if (!media) error(404, "Attachment unavailable.");
  return mediaResponse(media, request);
};
