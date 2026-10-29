import { error, json } from "@sveltejs/kit";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { ownedDraft, saveDraft, publishDraft } from "$lib/server/drafts";
import { db, transaction } from "$lib/server/db";
import { readBody } from "$lib/server/request";
import { rm } from "node:fs/promises";
import { mediaPath } from "$lib/server/media";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals),
    id = event.params.id;
  await ownedDraft(id, user.id);
  const raw = await readBody(event.request, 1_000_000);
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    error(400, "Send a valid draft action.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    error(400, "Send a valid draft action.");
  if (body.action === "save") {
    if (!Number.isInteger(body.version))
      error(400, "A draft version is required.");
    return json(await saveDraft(id, user.id, body.content, body.version));
  }
  if (body.action === "publish") {
    if (!Number.isInteger(body.version))
      error(400, "A draft version is required.");
    return json(await publishDraft(id, user.id, body.version));
  }
  if (body.action === "revoke") {
    await db.query(
      "UPDATE drafts SET share_token=NULL WHERE id=$1 AND owner_id=$2",
      [id, user.id],
    );
    return json({ ok: true });
  }
  if (body.action === "resolve") {
    if (!/^[0-9a-f-]{36}$/i.test(body.commentId))
      error(400, "Feedback not found.");
    await db.query(
      "UPDATE comments SET resolved=$1 WHERE id=$2 AND draft_id=$3",
      [body.resolved === true, body.commentId, id],
    );
    return json({ ok: true });
  }
  if (body.action === "delete") {
    const files = await transaction(async (client) => {
      await client.query(
        "SELECT id FROM drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, user.id],
      );
      const files = await client.query(
        "SELECT id FROM media WHERE draft_id=$1",
        [id],
      );
      await client.query("DELETE FROM drafts WHERE id=$1 AND owner_id=$2", [
        id,
        user.id,
      ]);
      return files;
    });
    await Promise.all(
      files.rows.map((row) => rm(mediaPath(row.id), { force: true })),
    );
    return json({ ok: true });
  }
  error(400, "Unknown draft action.");
};
