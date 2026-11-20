#!/usr/bin/env node
'use strict';

// Checks the terminals Tabherd can drive on this computer. For each one, it
// opens a tab running a stand-in session (scripts/stand-in-session.js, not
// Claude), then tries what the dashboard does with it: Go to window, reading
// its tab's title, Catch up (typing a prompt, then Enter on its own) and Stop.
// It prints what worked. Each check takes about 15 seconds, and the tabs it
// opens are closed or left at a shell prompt.
//
//   npm run check-terminals                  every terminal found here
//   npm run check-terminals -- kitty tmux    just these
//
// Watch the screen while it runs: windows will come forward. On macOS, allow
// the prompts asking to let it control Terminal or iTerm2.

const fs = require('fs');
const os = require('os');
const path = require('path');
const terminals = require('../lib/terminals');
const { shQuote } = require('../lib/terminals/unix');

const STAND_IN = path.join(__dirname, 'stand-in-session.js');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await pause(250)) {
    const value = check();
    if (value) return value;
  }
  return null;
}

function registered(config) {
  try {
    const name = fs.readdirSync(path.join(config, 'sessions')).find((n) => /^\d+\.json$/.test(n));
    return name ? Number(name.slice(0, -5)) : null;
  } catch {
    return null;
  }
}

const typedLines = (config, pid) => {
  try {
    return fs.readFileSync(path.join(config, `typed-${pid}.txt`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

async function check(terminal) {
  const result = { terminal: terminal.name };
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'tabherd-check-'));
  const title = `Tabherd check ${terminal.id}`;
  const command = `${shQuote(process.execPath)} ${shQuote(STAND_IN)} --config ${shQuote(config)} --title ${shQuote(title)}`;

  const opened = await terminals.open(os.homedir(), command, { terminal: terminal.id });
  result.open = opened.ok ? 'yes' : `no: ${opened.error}`;
  if (!opened.ok) return result;
  const pid = await waitFor(() => registered(config), 15000);
  if (!pid) {
    result.open = "opened, but the stand-in session didn't start";
    return result;
  }

  const focused = await terminals.focus(pid);
  result.goToWindow = focused.ok ? `yes${focused.tab ? ', exact tab' : ', window only'}` : `no: ${focused.error}`;

  // Titles are read every few seconds in the background, as for the dashboard.
  const seen = await waitFor(() => {
    terminals.refreshTitles([pid]);
    return terminals.titleFor(pid);
  }, 10000);
  result.title = seen === title ? 'yes' : seen ? `read "${seen}"` : 'no';

  const statusFile = path.join(config, 'sessions', `${pid}.json`);
  const sent = await terminals.focus(pid, { send: 'tabherd check', statusFile });
  if (!sent.ok) result.catchUp = `no: ${sent.error}`;
  else {
    const lines = await waitFor(() => {
      const l = typedLines(config, pid);
      return l.some((x) => x.includes('<Enter>')) ? l : null;
    }, 3000) || typedLines(config, pid);
    const text = lines.findIndex((x) => x.includes('tabherd check'));
    const enter = lines.findIndex((x) => x === '<Enter>');
    if (text >= 0 && enter > text) result.catchUp = 'yes';
    else if (lines.some((x) => x.includes('tabherd check<Enter>'))) result.catchUp = 'typed, but with Enter in the same burst (Claude would take it as a paste)';
    else result.catchUp = `no: received ${JSON.stringify(lines)}`;
  }

  const stopped = await terminals.stop(pid);
  result.stop = stopped.ok ? 'yes' : `no: ${stopped.error}`;
  fs.rmSync(config, { recursive: true, force: true });
  return result;
}

async function main() {
  const wanted = process.argv.slice(2);
  const all = terminals.terminals();
  if (!all.length) {
    console.log(`Tabherd can't drive terminals on ${process.platform} yet.`);
    return;
  }
  const chosen = all.filter((t) => (wanted.length ? wanted.includes(t.id) : t.available));
  for (const t of all) if (!t.available && (!wanted.length || wanted.includes(t.id))) console.log(`${t.name}: not found here, skipped`);
  for (const t of chosen) {
    process.stdout.write(`${t.name}: checking...\n`);
    const r = await check(t);
    for (const [k, v] of Object.entries(r)) if (k !== 'terminal') console.log(`  ${k.padEnd(10)} ${v}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
