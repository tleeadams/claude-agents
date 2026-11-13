#!/usr/bin/env node
'use strict';

// Builds launcher/ClaudeAgents.exe and adds "Claude Agents" shortcuts to the
// Desktop and the Start menu. --uninstall removes the shortcuts.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LAUNCHER = path.join(ROOT, 'launcher');
const SOURCE = path.join(LAUNCHER, 'ClaudeAgents.cs');
const EXE = path.join(LAUNCHER, 'ClaudeAgents.exe');
const ICON = path.join(LAUNCHER, 'app.ico');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const SHORTCUT = 'Claude Agents.lnk';
const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

// ---- icon: public/favicon.svg, drawn at each size ----------------------------

const TERRACOTTA = [0xc9, 0x64, 0x42];
const DOTS = [
  [10, 11, 1],
  [22, 11, 0.75],
  [10, 21, 0.75],
  [22, 21, 0.45],
];
const DOT_RADIUS = 3.2;
const CORNER = 8;
const SUBSAMPLES = 4;

function inRoundedSquare(u, v) {
  if (u < 0 || v < 0 || u > 32 || v > 32) return false;
  const dx = Math.max(CORNER - u, 0, u - (32 - CORNER));
  const dy = Math.max(CORNER - v, 0, v - (32 - CORNER));
  return dx * dx + dy * dy <= CORNER * CORNER;
}

// RGBA rows, top to bottom, antialiased by supersampling each pixel.
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = 32 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let i = 0; i < SUBSAMPLES; i++) {
        for (let j = 0; j < SUBSAMPLES; j++) {
          const u = (x + (i + 0.5) / SUBSAMPLES) * scale;
          const v = (y + (j + 0.5) / SUBSAMPLES) * scale;
          if (!inRoundedSquare(u, v)) continue;
          let color = TERRACOTTA;
          for (const [cx, cy, alpha] of DOTS) {
            if ((u - cx) ** 2 + (v - cy) ** 2 <= DOT_RADIUS ** 2) color = color.map((c) => c * (1 - alpha) + 255 * alpha);
          }
          r += color[0];
          g += color[1];
          b += color[2];
          covered++;
        }
      }
      const o = (y * size + x) * 4;
      if (covered) {
        pixels[o] = Math.round(r / covered);
        pixels[o + 1] = Math.round(g / covered);
        pixels[o + 2] = Math.round(b / covered);
      }
      pixels[o + 3] = Math.round((255 * covered) / SUBSAMPLES ** 2);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function png(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Small icon sizes are stored as bitmaps: BGRA rows bottom to top, then an
// empty AND mask, since the alpha channel already carries the shape.
function bitmap(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(Math.ceil(size / 32) * 4 * size)]);
}

function icon(sizes) {
  const images = sizes.map((size) => {
    const rgba = draw(size);
    return { size, data: size >= 256 ? png(size, rgba) : bitmap(size, rgba) };
  });
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, i) => {
    const entry = 6 + 16 * i;
    directory[entry] = image.size % 256; // 0 means 256
    directory[entry + 1] = image.size % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });
  return Buffer.concat([directory, ...images.map((image) => image.data)]);
}

// ---- shortcuts -----------------------------------------------------------------

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
}

const FOLDERS = "[Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')";

function createShortcuts() {
  return powershell(`
    $shell = New-Object -ComObject WScript.Shell
    foreach ($dir in ${FOLDERS}) {
      $link = $shell.CreateShortcut((Join-Path $dir ${psQuote(SHORTCUT)}))
      $link.TargetPath = ${psQuote(EXE)}
      $link.WorkingDirectory = ${psQuote(LAUNCHER)}
      $link.IconLocation = ${psQuote(`${EXE},0`)}
      $link.Description = 'See every running Claude Code agent'
      $link.Save()
      $link.FullName
    }`);
}

function removeShortcuts() {
  return powershell(`
    foreach ($dir in ${FOLDERS}) {
      $file = Join-Path $dir ${psQuote(SHORTCUT)}
      if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file; $file }
    }`);
}

function main() {
  if (process.platform !== 'win32') {
    console.error('The desktop launcher is Windows-only. Run "npm start" instead.');
    process.exit(1);
  }
  if (process.argv.includes('--uninstall')) {
    const removed = removeShortcuts();
    console.log(removed ? `Removed:\n${removed}` : 'No shortcuts to remove.');
    return;
  }
  if (!fs.existsSync(CSC)) {
    console.error(`The C# compiler that comes with Windows wasn't found at ${CSC}.`);
    process.exit(1);
  }
  fs.writeFileSync(ICON, icon(ICON_SIZES));
  execFileSync(
    CSC,
    ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${ICON}`, `/out:${EXE}`, '/reference:System.Windows.Forms.dll', SOURCE],
    { stdio: 'inherit' },
  );
  // The launcher prefers the Node running this script, so it works even when
  // node isn't on the PATH that Explorer gives programs.
  fs.writeFileSync(path.join(LAUNCHER, 'node-path.txt'), process.execPath);
  console.log(`Built ${EXE}\nShortcuts:\n${createShortcuts()}`);
}

if (require.main === module) main();

module.exports = { draw, png };
