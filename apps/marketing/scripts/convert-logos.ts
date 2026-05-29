import sharp from "sharp";
import toIco from "to-ico";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DL = "C:/Users/THIS PC/Downloads";
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

const SRC = {
  wordmark: `${DL}/ChatGPT Image May 26, 2026, 09_04_24 PM.png`,
  favicon: `${DL}/KamiCode Favicon.png`,
  desktopIcon: `${DL}/KamiCode Desktop Icon.png`,
};

async function info(label: string, path: string) {
  const meta = await sharp(path).metadata();
  console.log(`${label}: ${meta.width}x${meta.height} ${meta.format} alpha=${meta.hasAlpha}`);
  return meta;
}

async function run() {
  console.log("Source metadata:");
  await info("  wordmark    ", SRC.wordmark);
  await info("  favicon     ", SRC.favicon);
  await info("  desktopIcon ", SRC.desktopIcon);

  // Hero wordmark — trim transparent padding around the K mark before
  // resizing so the hero doesn't show a giant gap under the logo.
  await sharp(SRC.wordmark)
    .trim({ threshold: 10 })
    .resize(600, 600, { fit: "inside", withoutEnlargement: false })
    .webp({ quality: 92 })
    .toFile(`${PUBLIC}/kamicode-wordmark.webp`);
  const wm = await sharp(`${PUBLIC}/kamicode-wordmark.webp`).metadata();
  console.log(`Wrote kamicode-wordmark.webp (${wm.width}x${wm.height}, trimmed)`);

  // Nav / footer icon — the desktop icon (rounded square) at app/icon size.
  await sharp(SRC.desktopIcon)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(`${PUBLIC}/icon.png`);
  await sharp(SRC.desktopIcon)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 92 })
    .toFile(`${PUBLIC}/icon.webp`);
  console.log("Wrote icon.png + icon.webp (512x512)");

  // Apple touch icon — 180x180, no alpha (iOS adds its own rounding).
  await sharp(SRC.desktopIcon)
    .resize(180, 180, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(`${PUBLIC}/apple-touch-icon.png`);
  await sharp(SRC.desktopIcon)
    .resize(180, 180, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .webp({ quality: 92 })
    .toFile(`${PUBLIC}/apple-touch-icon.webp`);
  console.log("Wrote apple-touch-icon.png + .webp (180x180)");

  // Browser tab favicons — circular black mark.
  for (const size of [16, 32]) {
    await sharp(SRC.favicon)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(`${PUBLIC}/favicon-${size}x${size}.png`);
    await sharp(SRC.favicon)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 92 })
      .toFile(`${PUBLIC}/favicon-${size}x${size}.webp`);
  }
  console.log("Wrote favicon-16x16 + favicon-32x32 (png + webp)");

  // favicon.ico — bundle 16, 32, 48 sizes
  const icoBuffers = await Promise.all(
    [16, 32, 48].map((size) =>
      sharp(SRC.favicon)
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  );
  const icoBuf = await toIco(icoBuffers);
  await writeFile(`${PUBLIC}/favicon.ico`, icoBuf);
  console.log("Wrote favicon.ico (16/32/48)");

  console.log("\nDone.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
