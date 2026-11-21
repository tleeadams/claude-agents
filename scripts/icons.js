#!/usr/bin/env node
'use strict';

// Makes Tabherd's icons from the logo, assets/logo.png: public/icons/
// tabherd-<size>.png at each size the page, the Windows launcher, the macOS
// app and the Linux menu use, and public/favicon.svg, which holds the 64px
// one. Run it after changing the logo, and commit what it writes:
//
//   npm run icons
//
// The logo is a rounded square on a light background. Everything outside
// the square is made transparent, keeping its edge smooth, so the icons sit
// on any background.

const fs = require('fs');
const path = require('path');
const { encode, decode } = require('./png');

const ROOT = path.join(__dirname, '..');
const LOGO = path.join(ROOT, 'assets', 'logo.png');
const ICONS = path.join(ROOT, 'public', 'icons');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512];

const iconFile = (size) => path.join(ICONS, `tabherd-${size}.png`);

const pixel = (img, x, y) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Clears the background around the rounded square. Starting from the
// corners, each pixel that's background, or a blend of it and the square's
// edge colour, becomes that edge colour with the blend as its opacity.
function cutOut(img) {
  const { width, height, rgba } = img;
  const background = pixel(img, 4, 4);
  const edge = pixel(img, Math.round(width * 0.06), Math.round(height / 2));
  const span = distance(edge, background);
  const blend = (p) => Math.min(1, distance(pixel(img, p % width, Math.floor(p / width)), background) / span);
  const seen = new Uint8Array(width * height);
  const queue = [0, width - 1, (height - 1) * width, height * width - 1];
  for (const p of queue) seen[p] = 1;
  while (queue.length) {
    const p = queue.pop();
    const t = blend(p);
    const o = p * 4;
    rgba[o] = edge[0];
    rgba[o + 1] = edge[1];
    rgba[o + 2] = edge[2];
    rgba[o + 3] = t < 0.04 ? 0 : Math.round(t * 255);
    if (t >= 0.9) continue;
    const x = p % width;
    for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (n >= 0 && n < width * height && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  return img;
}

// One axis of an area-average resample: each output sample is the average
// of the input it covers, counting partly covered inputs by how much.
function resample(src, count, outCount, lineCount, step, lineStep) {
  const out = new Float64Array(outCount * lineCount * 4);
  const scale = count / outCount;
  for (let line = 0; line < lineCount; line++) {
    for (let i = 0; i < outCount; i++) {
      const start = i * scale;
      const end = start + scale;
      const sum = [0, 0, 0, 0];
      for (let j = Math.floor(start); j < Math.ceil(end); j++) {
        const weight = Math.min(end, j + 1) - Math.max(start, j);
        const at = (line * lineStep + j * step) * 4;
        for (let c = 0; c < 4; c++) sum[c] += src[at + c] * weight;
      }
      const to = (line * outCount + i) * 4;
      for (let c = 0; c < 4; c++) out[to + c] = sum[c] / scale;
    }
  }
  return out;
}

// Scaled down to size×size, with colours weighted by opacity so the clear
// background doesn't darken the edge.
function resize(img, size) {
  const { width, height, rgba } = img;
  const src = new Float64Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const a = rgba[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) src[p * 4 + c] = rgba[p * 4 + c] * a;
    src[p * 4 + 3] = rgba[p * 4 + 3];
  }
  // Across each row, then down each column of the narrower result, which is
  // laid out column by column.
  const across = resample(src, width, size, height, 1, width);
  const columns = new Float64Array(size * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 4; c++) columns[(x * height + y) * 4 + c] = across[(y * size + x) * 4 + c];
  const down = resample(columns, height, size, size, 1, height);
  const out = Buffer.alloc(size * size * 4);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const from = (x * size + y) * 4;
      const to = (y * size + x) * 4;
      const a = down[from + 3];
      for (let c = 0; c < 3; c++) out[to + c] = a > 0 ? Math.round(Math.min(255, (down[from + c] / a) * 255)) : 0;
      out[to + 3] = Math.round(Math.min(255, a));
    }
  }
  return out;
}

function main() {
  const img = cutOut(decode(fs.readFileSync(LOGO)));
  fs.mkdirSync(ICONS, { recursive: true });
  for (const size of SIZES) fs.writeFileSync(iconFile(size), encode(size, size, resize(img, size)));
  const favicon = fs.readFileSync(iconFile(64)).toString('base64');
  fs.writeFileSync(
    path.join(ROOT, 'public', 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${favicon}"/></svg>\n`,
  );
  console.log(`Wrote ${SIZES.length} icons to ${path.relative(ROOT, ICONS)}, and public/favicon.svg`);
}

if (require.main === module) main();

module.exports = { SIZES, iconFile, cutOut, resize };
