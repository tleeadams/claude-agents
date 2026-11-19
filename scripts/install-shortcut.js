#!/usr/bin/env node
'use strict';

// Builds launcher/ClaudeAgents.exe and adds "Claude Agents" shortcuts to the
// Desktop and the Start menu. --uninstall removes the shortcuts. A release
// has the launcher already built; it does the same with --install.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildLauncher } = require('./launcher');

const LAUNCHER = path.join(__dirname, '..', 'launcher');
const EXE = path.join(LAUNCHER, 'ClaudeAgents.exe');

function main() {
  if (process.platform !== 'win32') {
    console.error('The desktop launcher is Windows-only. Run "npm start" instead.');
    process.exit(1);
  }
  if (process.argv.includes('--uninstall')) {
    if (fs.existsSync(EXE)) execFileSync(EXE, ['--uninstall', '--quiet']);
    console.log('Removed the shortcuts.');
    return;
  }
  try {
    buildLauncher(EXE, path.join(LAUNCHER, 'app.ico'));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  // The launcher prefers the Node running this script, so it works even when
  // node isn't on the PATH that Explorer gives programs.
  fs.writeFileSync(path.join(LAUNCHER, 'node-path.txt'), process.execPath);
  execFileSync(EXE, ['--install', '--quiet']);
  console.log(`Built ${EXE} and added shortcuts to the Desktop and the Start menu.`);
}

main();
