import sharp, { type OverlayOptions } from "sharp";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { render } from "svelte/server";
import Brand from "../components/Brand.svelte";
import type { Content, Media } from "../contracts";
import { mediaPath } from "./media";
import { avatarPath } from "./avatars";

const extractFrame = promisify(execFile);

// Use the app's outlined wordmark and resting eyes, not a font approximation.
const brand = render(Brand)
  .body.match(/<svg[\s\S]*?<\/svg>/)![0]
  .replace(
    "<svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="43"',
  )
  .replace(
    "</svg>",
    "<style>.brand-bubble{fill:#ff6b5b;stroke:#ff6b5b}.brand-eye,.brand-word{fill:#f2f0ec}.brand-pupil{fill:#0b0b0c}.brand-iris{fill:#ff6b5b}</style></svg>",
  );

function escape(value: string) {
  return value.replace(/\0/g, "�").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

// Pango wraps and shapes real Unicode text; never interpolate draft HTML into SVG.
async function text(
  value: string,
  width: number,
  size: number,
  color: string,
  height: number,
) {
  const characters = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      value,
    ),
  ].map((part) => part.segment);
  let length = Math.min(characters.length, 700);
  while (true) {
    const excerpt =
      characters.slice(0, length).join("").trimEnd() +
      (length < characters.length ? "…" : "");
    const { data, info } = await sharp({
      text: {
        text: `<span foreground="${color}">${escape(excerpt)}</span>`,
        font: `sans ${size}`,
        width,
        spacing: 8,
        wrap: "word-char",
        rgba: true,
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (info.height <= height || length <= 1) return data;
    length = Math.max(1, Math.floor(length * 0.85));
  }
}

export async function reviewPreview(content: Content, media: Media[]) {
  const post = content.posts[0];
  const hasText = !!post.text.trim();
  const attachment = post.media
    .map((id) => media.find((item) => item.id === id))
    .find((item) => item);
  let photo: Buffer | undefined;
  if (attachment) {
    // A missing old attachment must not prevent the rest of the card from rendering.
    try {
      let input: string | Buffer = mediaPath(attachment.id);
      if (attachment.mime.startsWith("video/")) {
        // Decode only one local frame, with bounded work/output and no network protocols.
        const { stdout } = await extractFrame(
          "ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-f",
            attachment.mime === "video/mp4" ? "mov" : "matroska",
            "-threads",
            "1",
            "-i",
            input,
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-vf",
            "scale=1088:380:force_original_aspect_ratio=decrease",
            "-threads",
            "1",
            "-filter_threads",
            "1",
            "-f",
            "image2pipe",
            "-c:v",
            "png",
            "pipe:1",
          ],
          {
            encoding: "buffer",
            timeout: 5000,
            killSignal: "SIGKILL",
            maxBuffer: 2 * 1024 * 1024,
          },
        );
        input = stdout;
      }
      photo = await sharp(input, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(hasText ? 352 : 1088, 380, {
          fit: "contain",
          background: "#000000",
        })
        .png()
        .toBuffer();
    } catch {
      /* Text remains useful if the original file is unavailable. */
    }
  }
  const layers: OverlayOptions[] = [];
  if (photo) layers.push({ input: photo, left: hasText ? 792 : 56, top: 162 });
  let avatar: Buffer | undefined;
  if (content.author.avatar) {
    try {
      avatar = await sharp(await readFile(avatarPath(content.author.avatar)))
        .resize(64, 64)
        .png()
        .toBuffer();
    } catch {
      /* Fall back to the author's initial. */
    }
  }
  avatar ??= await sharp({
    create: { width: 64, height: 64, channels: 4, background: "#161618" },
  })
    .composite([
      {
        input: await text(
          Array.from(content.author.name)[0],
          64,
          36,
          "#ff6b5b",
          64,
        ),
        gravity: "centre",
      },
    ])
    .png()
    .toBuffer();
  layers.push({
    input: await sharp(avatar)
      .composite([
        {
          input: Buffer.from(
            '<svg width="64" height="64"><circle cx="32" cy="32" r="32" fill="white"/></svg>',
          ),
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer(),
    left: 56,
    top: 54,
  });
  layers.push({
    input: await text(content.author.name, 940, 30, "#e7e9ea", 42),
    left: 140,
    top: 52,
  });
  const handle = content.author.handle.replace(/^@/, "");
  if (handle)
    layers.push({
      input: await text(`@${handle}`, 940, 24, "#71767b", 36),
      left: 140,
      top: 96,
    });
  const body =
    post.text.trim() ||
    (attachment?.mime.startsWith("video/") && !photo ? "Video attachment" : "");
  if (body.trim())
    layers.push({
      input: await text(body, photo ? 680 : 1088, 38, "#e7e9ea", 380),
      left: 56,
      top: 162,
    });
  layers.push({
    input: await sharp(Buffer.from(brand)).png().toBuffer(),
    left: 924,
    top: 564,
  });
  return sharp({
    create: { width: 1200, height: 630, channels: 3, background: "#000000" },
  })
    .composite(layers)
    .png()
    .toBuffer();
}
