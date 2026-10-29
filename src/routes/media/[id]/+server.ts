import { error } from "@sveltejs/kit";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { db } from "$lib/server/db";
import { mediaIds } from "$lib/contracts";
import { mediaPath } from "$lib/server/media";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ params, locals, url, request }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id))
    error(404, "Attachment unavailable.");
  const row = (
    await db.query(
      `SELECT m.*,d.share_token,d.shared_revision FROM media m JOIN drafts d ON d.id=m.draft_id WHERE m.id=$1`,
      [params.id],
    )
  ).rows[0];
  if (!row) error(404, "Attachment unavailable.");
  if (locals.user?.id !== row.owner_id) {
    const key = url.searchParams.get("key");
    if (!key || key !== row.share_token || !row.shared_revision)
      error(404, "Attachment unavailable.");
    const revisions = await db.query(
      "SELECT content FROM revisions WHERE draft_id=$1",
      [row.draft_id],
    );
    if (!revisions.rows.some((r) => mediaIds(r.content).includes(row.id)))
      error(404, "Attachment unavailable.");
  }
  const path = mediaPath(row.id);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    error(404, "Attachment unavailable.");
  }
  let start = 0,
    end = size - 1,
    status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
    }
    if (
      start >= size ||
      start > end ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end)
    )
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    status = 206;
  }
  const headers: Record<string, string> = {
    "Content-Type": row.mime,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (status === 206)
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  if (url.searchParams.has("download"))
    headers["Content-Disposition"] =
      `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`;
  return new Response(
    Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream,
    { status, headers },
  );
};
