#!/usr/bin/env node
'use strict';

// Builds a release for the platform this runs on, in dist/: the app, its
// launcher and Node in one folder, zipped, with a SHA-256 checksum and the
// release notes for this version from CHANGELOG.md.
//
//   node scripts/build-release.js                bundles the Node running this
//   node scripts/build-release.js --node <path>  bundles that node executable
//   node scripts/build-release.js --stage        builds the folder, not the zip
//   node scripts/build-release.js --pack         zips the folder --stage built
//
// The release workflow builds the folder, has the launcher signed, puts it
// back and then zips the folder.
//
// Only Windows is supported so far. Each platform is one entry in TARGETS.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { buildLauncher } = require('./launcher');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const { version } = require('../package.json');
const MIN_NODE = 18;

// What every release holds, whatever the platform. The launcher's and the
// build's source come too, as the GPL asks of anything shipped compiled.
const APP_FILES = ['server.js', 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'lib', 'public', 'launcher/ClaudeAgents.cs', 'scripts'];

const TARGETS = {
  win32: {
    name: `windows-${process.arch}`,
    build(stage, node) {
      // Beside server.js, where the launcher looks for it.
      buildLauncher(path.join(stage, 'Claude Agents.exe'), path.join(DIST, 'app.ico'));
      bundleNode(node, path.join(stage, 'node', 'node.exe'));
      // Double-click versions of the launcher's --install and --uninstall.
      fs.writeFileSync(path.join(stage, 'Install shortcuts.cmd'), '@"%~dp0Claude Agents.exe" --install\r\n');
      fs.writeFileSync(path.join(stage, 'Remove shortcuts.cmd'), '@"%~dp0Claude Agents.exe" --uninstall\r\n');
    },
    // Windows' own tar (bsdtar) writes zips; Git's GNU tar, which may come
    // first on the PATH, doesn't.
    zip(stage, file) {
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      execFileSync(tar, ['-a', '-c', '-f', file, '-C', path.dirname(stage), path.basename(stage)]);
    },
  },
};

// Copies node with its licence, which has to travel with it.
function bundleNode(from, to) {
  const major = Number(execFileSync(from, ['-p', 'process.versions.node'], { encoding: 'utf8' }).split('.')[0]);
  if (!(major >= MIN_NODE)) throw new Error(`${from} is Node ${major}; the app needs ${MIN_NODE} or later.`);
  const license = path.join(path.dirname(from), 'LICENSE');
  if (!fs.existsSync(license)) throw new Error(`Node's LICENSE isn't next to ${from}. Use a Node installed from nodejs.org.`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.copyFileSync(license, path.join(path.dirname(to), 'LICENSE'));
}

// The section of the changelog headed with this version. A Windows checkout
// has CRLF line endings, so they're evened out first.
function releaseNotes(changelog, version) {
  const text = changelog.replace(/\r\n/g, '\n');
  const escaped = version.replace(/\./g, '\\.');
  const match = text.match(new RegExp(`^## \\[?${escaped}\\]?.*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  if (!match || !match[1].trim()) throw new Error(`CHANGELOG.md has no notes under "## ${version}".`);
  return `${match[1].trim()}\n`;
}

function main() {
  const target = TARGETS[process.platform];
  if (!target) throw new Error(`Releases for ${process.platform} aren't supported yet. Run the app from source with "npm start".`);
  const notes = releaseNotes(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  const name = `claude-agents-v${version}-${target.name}`;
  const stage = path.join(DIST, name);
  const only = ['--stage', '--pack'].find((flag) => process.argv.includes(flag));

  if (only !== '--pack') {
    const at = process.argv.indexOf('--node');
    const node = at > 0 ? path.resolve(process.argv[at + 1] || '') : process.execPath;
    fs.rmSync(DIST, { recursive: true, force: true });
    for (const rel of APP_FILES) fs.cpSync(path.join(ROOT, rel), path.join(stage, rel), { recursive: true });
    target.build(stage, node);
    if (only) return console.log(`Built ${path.relative(ROOT, stage)}`);
  }
  if (!fs.existsSync(stage)) throw new Error(`${path.relative(ROOT, stage)} isn't built. Run with --stage first.`);

  const zip = path.join(DIST, `${name}.zip`);
  target.zip(stage, zip);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  fs.writeFileSync(`${zip}.sha256`, `${hash}  ${path.basename(zip)}\n`);
  fs.writeFileSync(path.join(DIST, 'RELEASE_NOTES.md'), notes);
  console.log(`Built ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)\nSHA-256 ${hash}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { releaseNotes };
