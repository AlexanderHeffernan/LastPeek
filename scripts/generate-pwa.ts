import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import { appleLaunchImages } from "../src/lib/pwa";

// Keep installation assets tied to the existing hand-drawn brand, not a second logo.
const source = await readFile("static/favicon.svg", "utf8");
const square = source.replace('rx="16"', "");
await mkdir("static/pwa", { recursive: true });
for (const size of [192, 512]) {
  await sharp(Buffer.from(square))
    .resize(size, size)
    .png()
    .toFile(`static/pwa/icon-${size}.png`);
}
const mask = await sharp(Buffer.from(square)).resize(360, 360).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 3, background: "#161618" },
})
  .composite([{ input: mask, gravity: "centre" }])
  .png()
  .toFile("static/pwa/maskable-512.png");
for (const image of appleLaunchImages) {
  const mark = await sharp(Buffer.from(source))
    .resize(88 * image.ratio)
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: image.width,
      height: image.height,
      channels: 3,
      background: "#0b0b0c",
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(`static${image.href}`);
}
console.log(
  `Generated PWA icons and ${appleLaunchImages.length} Apple launch screens.`,
);
