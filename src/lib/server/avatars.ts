import { resolve } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { error } from "@sveltejs/kit";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { transaction } from "./db";
import { mediaDir, storageLimit } from "./media";

export const avatarLimit = 5 * 1024 * 1024;
export const avatarDir = resolve(mediaDir, "avatars");
export const avatarPath = (id: string) => resolve(avatarDir, id);

export async function storeAvatar(bytes: Buffer, ownerId: string) {
  if (!bytes.length || bytes.length > avatarLimit)
    error(413, "Choose an avatar smaller than 5 MB.");
  const type = await fileTypeFromBuffer(bytes);
  if (
    !type ||
    !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(type.mime)
  )
    error(400, "Use a JPEG, PNG, WebP or AVIF image for your avatar.");
  let image: Buffer;
  try {
    image = await sharp(bytes, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    error(
      400,
      "This image is damaged or too large. Use an image under 16 megapixels.",
    );
  }
  const id = crypto.randomUUID();
  await mkdir(avatarDir, { recursive: true, mode: 0o700 });
  try {
    await transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        ownerId,
      ]);
      const used = await client.query(
        "SELECT (SELECT COALESCE(sum(bytes),0) FROM media WHERE owner_id=$1)+(SELECT COALESCE(sum(bytes),0) FROM avatars WHERE owner_id=$1) AS bytes",
        [ownerId],
      );
      if (Number(used.rows[0].bytes) + image.length > storageLimit)
        error(
          413,
          "Your media storage is full. Delete an old draft to free space.",
        );
      await writeFile(avatarPath(id), image, { mode: 0o600, flag: "wx" });
      await client.query(
        "INSERT INTO avatars(id,owner_id,bytes) VALUES($1,$2,$3)",
        [id, ownerId, image.length],
      );
      await client.query("UPDATE users SET avatar_id=$1 WHERE id=$2", [
        id,
        ownerId,
      ]);
    });
  } catch (e) {
    await rm(avatarPath(id), { force: true });
    throw e;
  }
  return id;
}
