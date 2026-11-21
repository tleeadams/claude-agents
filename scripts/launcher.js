'use strict';

// Builds the Windows launcher: makes its icon from public/icons, the icons
// scripts/icons.js makes from the logo, then compiles launcher/Tabherd.cs with
// the C# compiler that comes with Windows. Used by install-shortcut.js and
// build-release.js.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { decode } = require('./png');
const { iconFile } = require('./icons');

const SOURCE = path.join(__dirname, '..', 'launcher', 'Tabherd.cs');
const { version: VERSION } = require('../package.json');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

// ---- icon: public/icons/tabherd-<size>.png, made from the logo -----------------

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

// The large size is stored as the PNG it is.
function icon(sizes) {
  const images = sizes.map((size) => {
    const file = fs.readFileSync(iconFile(size));
    return { size, data: size >= 256 ? file : bitmap(size, decode(file).rgba) };
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

// ---- build ---------------------------------------------------------------------

// The product name and version shown in the program's file details, which
// code signing checks. File versions are numbers only, so a prerelease such as
// 0.2.0-beta.1 is 0.2.0 there and in full only in the product version.
function versionInfo(version) {
  const numbers = version.split(/[-+]/)[0];
  if (!/^\d+\.\d+\.\d+$/.test(numbers)) throw new Error(`Not a version: ${version}`);
  return [
    'using System.Reflection;',
    '[assembly: AssemblyTitle("Tabherd")]',
    '[assembly: AssemblyProduct("Tabherd")]',
    `[assembly: AssemblyVersion("${numbers}.0")]`,
    `[assembly: AssemblyFileVersion("${numbers}.0")]`,
    `[assembly: AssemblyInformationalVersion("${version}")]`,
    '',
  ].join('\r\n');
}

// Writes the icon to `ico` and the program to `exe`, with the version info
// beside the icon.
function buildLauncher(exe, ico) {
  if (process.platform !== 'win32') throw new Error('The launcher can only be built on Windows.');
  if (!fs.existsSync(CSC)) throw new Error(`The C# compiler that comes with Windows wasn't found at ${CSC}.`);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(ico, icon(ICON_SIZES));
  const info = path.join(path.dirname(ico), 'VersionInfo.cs');
  fs.writeFileSync(info, versionInfo(VERSION));
  execFileSync(
    CSC,
    ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${ico}`, `/out:${exe}`, '/reference:System.Windows.Forms.dll', SOURCE, info],
    { stdio: 'inherit' },
  );
}

module.exports = { buildLauncher, versionInfo, icon };
