'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// What the server keeps between runs, one JSON file per kind, in
// ~/.claude-agents (or AGENTS_DATA_DIR).
const DATA_DIR = process.env.AGENTS_DATA_DIR || path.join(os.homedir(), '.claude-agents');

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

module.exports = { DATA_DIR, read, write };
