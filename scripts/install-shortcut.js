#!/usr/bin/env node
'use strict';

// Adds Tabherd to the desktop from the source, as a release's launcher does
// with --install, and removes it with --uninstall:
//
// - Windows: builds launcher/Tabherd.exe and adds "Tabherd" shortcuts to the
//   Desktop and the Start menu.
// - macOS and Linux: launcher/tabherd.sh, through Tabherd.app in
//   ~/Applications or an applications-menu entry, and a `tabherd` command.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildLauncher } = require('./launcher');

const LAUNCHER = path.join(__dirname, '..', 'launcher');
const EXE = path.join(LAUNCHER, 'Tabherd.exe');
const SCRIPT = path.join(LAUNCHER, 'tabherd.sh');

function windows(uninstall) {
  if (uninstall) {
    if (fs.existsSync(EXE)) execFileSync(EXE, ['--uninstall', '--quiet']);
    console.log('Removed the shortcuts.');
    return;
  }
  buildLauncher(EXE, path.join(LAUNCHER, 'app.ico'));
  // The launcher prefers the Node running this script, so it works even when
  // node isn't on the PATH that Explorer gives programs.
  fs.writeFileSync(path.join(LAUNCHER, 'node-path.txt'), process.execPath);
  execFileSync(EXE, ['--install', '--quiet']);
  console.log(`Built ${EXE} and added shortcuts to the Desktop and the Start menu.`);
}

function unix(uninstall) {
  fs.chmodSync(SCRIPT, 0o755);
  const args = [path.join(__dirname, 'desktop-entry.js'), uninstall ? '--uninstall' : '--install', SCRIPT];
  execFileSync(process.execPath, args, { stdio: 'inherit' });
}

try {
  (process.platform === 'win32' ? windows : unix)(process.argv.includes('--uninstall'));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
