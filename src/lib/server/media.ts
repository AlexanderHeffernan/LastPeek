import { resolve } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { error } from "@sveltejs/kit";
import { transaction } from "./db";

export const mediaDir = resolve(process.env.MEDIA_DIR || "./data/media");
export const uploadLimit =
  Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024;
export const storageLimit =
  Number(process.env.MAX_STORAGE_MB || 500) * 1024 * 1024;
export function mediaPath(id: string) {
  return resolve(mediaDir, id);
}
export async function storeMedia(
  bytes: Buffer,
  filename: string,
  draftId: string,
  ownerId: string,
) {
  if (!bytes.length || bytes.length > uploadLimit)
    error(413, `Choose a file smaller than ${uploadLimit / 1024 / 1024} MB.`);
  const type = await fileTypeFromBuffer(bytes);
  if (
    !type ||
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
      "video/mp4",
      "video/webm",
    ].includes(type.mime)
  )
    error(
      400,
      "Use JPEG, PNG, WebP, GIF, AVIF, MP4 or WebM. Export HEIC/MOV files first.",
    );
  let width = null,
    height = null;
  if (type.mime.startsWith("image/")) {
    try {
      const metadata = await sharp(bytes, {
        limitInputPixels: 40_000_000,
      }).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
      if (!width || !height) error(400, "This image could not be read.");
    } catch {
      error(400, "This image is damaged or too large to display.");
    }
  }
  const id = crypto.randomUUID();
  await mkdir(mediaDir, { recursive: true, mode: 0o700 });
  try {
    return await transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        ownerId,
      ]);
      const used = await client.query(
        "SELECT ((SELECT COALESCE(sum(bytes),0) FROM media WHERE owner_id=$1)+(SELECT COALESCE(sum(bytes),0) FROM avatars WHERE owner_id=$1))::float8 AS bytes",
        [ownerId],
      );
      if (used.rows[0].bytes + bytes.length > storageLimit)
        error(
          413,
          "Your media storage is full. Delete an old draft to free space.",
        );
      // Recheck the draft inside the transaction: deletion must not leave a dangling upload.
      const draft = await client.query(
        "SELECT id FROM drafts WHERE id=$1 AND owner_id=$2 FOR KEY SHARE",
        [draftId, ownerId],
      );
      if (!draft.rowCount) error(404, "Draft not found.");
      await writeFile(mediaPath(id), bytes, { mode: 0o600, flag: "wx" });
      const result = await client.query(
        "INSERT INTO media(id,draft_id,owner_id,mime,bytes,filename,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,mime,bytes::float8,filename,width,height",
        [
          id,
          draftId,
          ownerId,
          type.mime,
          bytes.length,
          filename.slice(0, 180),
          width,
          height,
        ],
      );
      return result.rows[0];
    });
  } catch (e) {
    await rm(mediaPath(id), { force: true });
    throw e;
  }
}
