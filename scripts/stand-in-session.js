#!/usr/bin/env node
'use strict';

// A stand-in for a Claude Code session, for checking the terminal drivers
// without using Claude. It registers itself as Claude Code does, in
// <config>/sessions/<pid>.json, sets its tab's title, and records what's typed
// into it: each burst of input on its own line in <config>/typed-<pid>.txt, so
// a check can tell the prompt and the Enter after it arrived separately.
//
//   node scripts/stand-in-session.js --config <dir> --title <title>
//
// It ends on Ctrl+C, or when it's stopped.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const config = arg('config', process.env.CLAUDE_CONFIG_DIR);
const title = arg('title', 'Stand-in session');
if (!config) {
  console.error('Give --config <dir>, the folder to register the session in.');
  process.exit(2);
}

const sessions = path.join(config, 'sessions');
fs.mkdirSync(sessions, { recursive: true });
const record = path.join(sessions, `${process.pid}.json`);
const typed = path.join(config, `typed-${process.pid}.txt`);
fs.writeFileSync(typed, '');
fs.writeFileSync(
  record,
  JSON.stringify({
    pid: process.pid,
    sessionId: crypto.randomUUID(),
    cwd: process.cwd(),
    startedAt: Date.now(),
    kind: 'interactive',
    entrypoint: 'cli',
    status: 'idle',
    name: title,
  }),
);

// The spinner glyph in front is what Claude Code puts there too. Like Claude
// Code, it asks the terminal to mark pastes.
process.stdout.write(`\u001b]0;✳ ${title}\u0007\u001b[?2004h`);
process.stdout.write(`Stand-in session ${process.pid}: "${title}". Typing is recorded. Ctrl+C ends it.\r\n`);

function end() {
  process.stdout.write('\u001b[?2004l');
  try {
    fs.unlinkSync(record);
  } catch {}
  process.exit(0);
}
process.on('SIGTERM', end);
process.on('SIGHUP', end);

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text.includes('\u0003')) end();
  // One line per burst, with Enter shown as <Enter> and paste marks as
  // <paste> and </paste>.
  const shown = text.replace(/\u001b\[200~/g, '<paste>').replace(/\u001b\[201~/g, '</paste>').replace(/\r/g, '<Enter>');
  fs.appendFileSync(typed, `${JSON.stringify(shown)}\n`);
  process.stdout.write(`${shown}\r\n`);
});
process.stdin.on('end', end);
