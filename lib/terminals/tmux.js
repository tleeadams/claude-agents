'use strict';

// tmux, on macOS and Linux. A session inside tmux is found by its terminal
// device: each pane has its own. tmux can select the pane, type into it and
// read its title, whatever terminal it's shown in; that terminal's window is
// then brought forward by the driver for it, through the tmux client's device.

const { run, which, shellCommand, pause } = require('./unix');

// Printable: tmux shows control characters in its output as escapes.
const SEP = ' <|> ';
const FIELDS = ['pane_tty', 'pane_id', 'session_name', 'window_id', 'pane_title', 'window_name', 'session_attached', 'window_activity'];

const available = () => Boolean(which('tmux'));

async function panes() {
  if (!available()) return [];
  const out = await run('tmux', ['list-panes', '-a', '-F', FIELDS.map((f) => `#{${f}}`).join(SEP)]);
  if (!out.ok) return [];
  return out.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => Object.fromEntries(line.split(SEP).map((v, i) => [FIELDS[i], v])));
}

// The terminals attached to tmux, or to one of its sessions, latest first.
async function clients(session) {
  const target = session ? ['-t', session] : [];
  const out = await run('tmux', ['list-clients', ...target, '-F', `#{client_tty}${SEP}#{client_pid}${SEP}#{client_activity}`]);
  if (!out.ok) return [];
  return out.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [tty, pid, activity] = line.split(SEP);
      return { tty, pid: Number(pid), activity: Number(activity) };
    })
    .sort((a, b) => b.activity - a.activity);
}

const findPane = async (tty) => (tty ? (await panes()).find((p) => p.pane_tty === tty) || null : null);

// Selects the pane's window and the pane. When no terminal shows its tmux
// session, the terminal used last switches to it. Resolves to that terminal's
// client, whose window is what to bring forward, or null when tmux has none.
async function select(pane) {
  await run('tmux', ['select-window', '-t', pane.window_id]);
  await run('tmux', ['select-pane', '-t', pane.pane_id]);
  const showing = (await clients(pane.session_name))[0];
  if (showing) return showing;
  const latest = (await clients())[0];
  if (!latest) return null;
  await run('tmux', ['switch-client', '-c', latest.tty, '-t', pane.pane_id]);
  return latest;
}

// Pastes the text, marked as a paste where the program asked for that, as
// Claude Code does; then presses Enter. Typed unmarked, Claude Code would take
// an Enter that follows soon after as part of the paste.
async function type(pane, text) {
  const buffer = `tabherd-${process.pid}`;
  const set = await run('tmux', ['set-buffer', '-b', buffer, '--', text]);
  if (!set.ok) return `tmux couldn't hold the text: ${set.stderr.trim()}`;
  const pasted = await run('tmux', ['paste-buffer', '-p', '-d', '-b', buffer, '-t', pane.pane_id]);
  if (!pasted.ok) return `tmux couldn't type into it: ${pasted.stderr.trim()}`;
  await pause(300);
  const entered = await run('tmux', ['send-keys', '-t', pane.pane_id, 'Enter']);
  if (!entered.ok) return `tmux couldn't press Enter: ${entered.stderr.trim()}`;
  return null;
}

// A new window in the tmux session used last.
async function open(dir, command) {
  if (!available()) return { ok: false, error: "tmux isn't installed." };
  const list = await panes();
  if (!list.length) return { ok: false, error: "tmux isn't running. Start tmux in a terminal first, or choose another terminal in Settings." };
  const latest = list.sort((a, b) => Number(b.window_activity) - Number(a.window_activity))[0];
  const out = await run('tmux', ['new-window', '-t', `${latest.session_name}:`, '-c', dir, shellCommand(dir, command)]);
  return out.ok ? { ok: true } : { ok: false, error: `tmux couldn't open a window: ${out.stderr.trim()}` };
}

// Pane titles by terminal device. Claude Code sets its pane's title.
async function titles() {
  const map = new Map();
  for (const p of await panes()) map.set(p.pane_tty, p.pane_title);
  return map;
}

module.exports = { available, panes, findPane, select, type, open, titles };
