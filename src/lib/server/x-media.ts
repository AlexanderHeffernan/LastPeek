import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { error } from "@sveltejs/kit";
import { mediaDir, mediaPath } from "./media";

export const xMediaDir = join(mediaDir, ".x-publishing");
const convert = promisify(execFile);
export type Upload = {
  id: string;
  mime: string;
  bytes: number;
  preparedMime?: string;
  preparedBytes?: number;
  stage:
    "prepare" | "initialize" | "append" | "finalize" | "processing" | "ready";
  remote?: string;
  usageId?: string;
  segment?: number;
  expires?: number;
  checkAt?: number;
};

// Prepared bytes never leave private storage except through an explicitly
// authorised X upload. Originals and review snapshots remain unchanged.
export async function prepareXMedia(media: Upload) {
  const path = join(xMediaDir, media.id);
  try {
    return await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const original = await readFile(mediaPath(media.id));
  await mkdir(xMediaDir, { recursive: true, mode: 0o700 });
  if (media.mime.startsWith("video/")) {
    const temp = `${path}.tmp.mp4`;
    try {
      await convert(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          mediaPath(media.id),
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-vf",
          "scale=w='min(1280,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-threads",
          "2",
          "-pix_fmt",
          "yuv420p",
          "-fpsmax",
          "60",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-ac",
          "2",
          "-movflags",
          "+faststart",
          temp,
        ],
        { timeout: 80000, maxBuffer: 1024 * 1024 },
      );
      await chmod(temp, 0o600);
      await rename(temp, path);
    } catch {
      error(
        400,
        "Couldn’t prepare this video for X. Try a shorter H.264 MP4 video.",
      );
    } finally {
      await rm(temp, { force: true });
    }
  } else if (media.mime === "image/gif") {
    if (original.length > 15 * 1024 * 1024)
      error(
        400,
        "X accepts GIFs up to 15 MB. Export a smaller GIF or a video.",
      );
    return original;
  } else if (media.mime === "image/avif" || original.length > 5 * 1024 * 1024) {
    const bytes = await sharp(original, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(4096, 4096, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    await writeFile(path, bytes, { mode: 0o600 });
  } else return original;
  return readFile(path);
}

export function preparedMime(media: Upload) {
  return media.mime.startsWith("video/")
    ? "video/mp4"
    : media.mime === "image/avif" ||
        (media.mime !== "image/gif" && media.bytes > 5 * 1024 * 1024)
      ? "image/jpeg"
      : media.mime;
}

export async function removeXMedia(id: string) {
  await rm(join(xMediaDir, id), { force: true });
}
