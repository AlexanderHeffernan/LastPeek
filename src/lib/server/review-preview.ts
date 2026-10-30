import sharp, { type OverlayOptions } from "sharp";
import { readFile } from "node:fs/promises";
import type { Content, Media } from "../contracts";
import { mediaPath } from "./media";
import { avatarPath } from "./avatars";

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
  const image = post.media
    .map((id) => media.find((item) => item.id === id))
    .find((item) => item?.mime.startsWith("image/"));
  let photo: Buffer | undefined;
  if (image) {
    // A missing old attachment must not prevent the rest of the card from rendering.
    try {
      photo = await sharp(mediaPath(image.id), { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(hasText ? 352 : 1088, 380, { fit: "cover" })
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
    (post.media.length ? (image ? "" : "Video attachment") : "");
  if (body.trim())
    layers.push({
      input: await text(body, photo ? 680 : 1088, 38, "#e7e9ea", 380),
      left: 56,
      top: 162,
    });
  layers.push({
    input: await text(
      content.posts.length > 1
        ? `${content.posts.length} posts · Give a second look`
        : "Give a second look",
      780,
      22,
      "#71767b",
      32,
    ),
    left: 56,
    top: 574,
  });
  layers.push({
    input: await text("LastPeek", 180, 26, "#ff6b5b", 36),
    left: 1000,
    top: 570,
  });
  return sharp({
    create: { width: 1200, height: 630, channels: 3, background: "#000000" },
  })
    .composite(layers)
    .png()
    .toBuffer();
}
