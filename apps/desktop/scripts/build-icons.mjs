import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';

import { BICUBIC2, createICNS, createICO } from 'png2icons';
import sharp from 'sharp';

const buildDirectory = new URL('../build/', import.meta.url);
const source = fileURLToPath(new URL('../build/source/coqui-icon-original.png', import.meta.url));
const iconPng = fileURLToPath(new URL('../build/icon.png', import.meta.url));
const iconIco = fileURLToPath(new URL('../build/icon.ico', import.meta.url));
const iconIcns = fileURLToPath(new URL('../build/icon.icns', import.meta.url));
const rendererMark = fileURLToPath(new URL('../src/renderer/coqui-mark.png', import.meta.url));

const masterSize = 1024;
const ownerReferenceSha256 = '55dab8864e0463256ffec43de29e4c27da6f820f77737b58c59fbac855c3691a';
// Preserve the owner's supplied frog mark exactly. This crop removes only the
// screenshot padding around the original circular emblem.
const crop = { left: 56, top: 20, width: 190, height: 190 };

const sourceBytes = await readFile(source);
if (createHash('sha256').update(sourceBytes).digest('hex') !== ownerReferenceSha256) {
  throw new Error('The canonical owner-supplied Coqui mark changed. Refusing to rebuild icons.');
}

function circularAlpha(size) {
  const alpha = Buffer.alloc(size * size);
  const center = (size - 1) / 2;
  const radius = size * 0.493;
  const feather = 1.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const opacity = Math.max(0, Math.min(1, radius + feather - distance));
      alpha[(y * size) + x] = Math.round(opacity * 255);
    }
  }
  return alpha;
}

const rgb = await sharp(source)
  .extract(crop)
  .resize(masterSize, masterSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
  .removeAlpha()
  .raw()
  .toBuffer();
const alpha = circularAlpha(masterSize);
const rgba = Buffer.alloc(masterSize * masterSize * 4);
for (let pixel = 0; pixel < masterSize * masterSize; pixel += 1) {
  rgba[(pixel * 4)] = rgb[(pixel * 3)];
  rgba[(pixel * 4) + 1] = rgb[(pixel * 3) + 1];
  rgba[(pixel * 4) + 2] = rgb[(pixel * 3) + 2];
  rgba[(pixel * 4) + 3] = alpha[pixel];
}

await sharp(rgba, { raw: { width: masterSize, height: masterSize, channels: 4 } })
  .png({ compressionLevel: 9, palette: false })
  .toFile(iconPng);

await sharp(iconPng)
  .resize(128, 128, { kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, palette: true, quality: 92 })
  .toFile(rendererMark);

const master = await readFile(iconPng);
const icns = createICNS(master, BICUBIC2, 0);
const ico = createICO(master, BICUBIC2, 0, false, true);
if (icns === null || ico === null) throw new Error('Icon conversion failed.');
await Promise.all([writeFile(iconIcns, icns), writeFile(iconIco, ico)]);

console.log(`Generated Coqui icons in ${buildDirectory.pathname}`);
