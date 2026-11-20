'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// What the server keeps between runs, one JSON file per kind, in ~/.tabherd
// (or TABHERD_DATA_DIR). Before the project was renamed Tabherd, the folder
// was ~/.claude-agents; it's moved on the first run after the rename. If it
// can't be moved, it's used where it is.
function dataDir(home = os.homedir(), env = process.env) {
  if (env.TABHERD_DATA_DIR) return env.TABHERD_DATA_DIR;
  const dir = path.join(home, '.tabherd');
  const old = path.join(home, '.claude-agents');
  if (fs.existsSync(dir) || !fs.existsSync(old)) return dir;
  try {
    fs.renameSync(old, dir);
    return dir;
  } catch {
    return old;
  }
}

const DATA_DIR = dataDir();

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'));
  } catch {
    return fallback;
  }
}

// Written beside the old file and renamed over it, so a crash mid-write can't
// leave half a file.
function write(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${name}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, file);
}

module.exports = { DATA_DIR, dataDir, read, write };
