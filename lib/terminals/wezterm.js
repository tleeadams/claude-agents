'use strict';

// WezTerm, on macOS and Linux, through `wezterm cli`. Each WezTerm window
// process listens on its own socket, with no setup. It can select a pane, type
// into it and read its title, but not bring its window forward; the platform
// driver does that.

const fs = require('fs');
const os = require('os');
const path = require('path');
const unix = require('./unix');

const MAC_BIN = '/Applications/WezTerm.app/Contents/MacOS/wezterm';
const bin = () => unix.which('wezterm') || (fs.existsSync(MAC_BIN) ? MAC_BIN : null);

const socketDirs = () =>
  [process.env.XDG_RUNTIME_DIR && path.join(process.env.XDG_RUNTIME_DIR, 'wezterm'), path.join(os.homedir(), '.local', 'share', 'wezterm')].filter(Boolean);

// The sockets of running WezTerms, the session's own first.
function sockets(table, ctx) {
  const found = [];
  if (ctx?.env?.WEZTERM_UNIX_SOCKET) found.push(ctx.env.WEZTERM_UNIX_SOCKET);
  const own = ctx?.chain.find((p) => p.name === 'wezterm-gui');
  const pids = [...(own ? [own.pid] : []), ...[...table.values()].filter((p) => p.name === 'wezterm-gui').map((p) => p.pid)];
  for (const pid of pids) {
    for (const dir of socketDirs()) {
      const file = path.join(dir, `gui-sock-${pid}`);
      if (unix.isSocket(file)) found.push(file);
    }
  }
  return [...new Set(found)];
}

const cli = (socket, args) => unix.run(bin(), ['cli', '--no-auto-start', ...args], { env: { ...process.env, WEZTERM_UNIX_SOCKET: socket } });

async function panes(socket) {
  const out = await cli(socket, ['list', '--format', 'json']);
  if (!out.ok) return [];
  try {
    return JSON.parse(out.stdout);
  } catch {
    return [];
  }
}

async function locate(ctx) {
  for (const socket of sockets(ctx.table || (await unix.processTable()), ctx)) {
    const pane = (await panes(socket)).find((p) => p.tty_name === ctx.tty);
    if (pane) return { socket, pane };
  }
  return null;
}

function backend({ raise } = {}) {
  return {
    id: 'wezterm',
    name: 'WezTerm',
    processNames: ['wezterm-gui'],
    available: () => Boolean(bin()),
    hosts: (ctx) => ctx.chain.some((p) => p.name === 'wezterm-gui'),
    async open(dir, command) {
      const socket = sockets(await unix.processTable())[0];
      if (socket) {
        const out = await cli(socket, ['spawn', '--cwd', dir, '--', ...unix.shellArgs(dir, command)]);
        if (out.ok) {
          if (raise) await raise({ title: null });
          return { ok: true };
        }
      }
      if (!bin()) return { ok: false, error: "WezTerm wasn't found." };
      return unix.detached(bin(), ['start', '--cwd', dir, '--', ...unix.shellArgs(dir, command)]);
    },
    async focus(ctx) {
      const at = await locate(ctx);
      if (!at) return { ok: false, error: "WezTerm didn't list this session's pane." };
      const out = await cli(at.socket, ['activate-pane', '--pane-id', String(at.pane.pane_id)]);
      if (!out.ok) return { ok: false, error: `WezTerm couldn't go to it: ${out.stderr.trim()}` };
      const raised = raise ? await raise({ ...ctx, title: at.pane.window_title }) : false;
      return { ok: true, tab: true, raised };
    },
    // Sent as a paste, marked as one if the session asked for that; then a
    // carriage return on its own.
    async type(ctx, text) {
      const at = await locate(ctx);
      if (!at) return "WezTerm didn't list this session's pane";
      const id = String(at.pane.pane_id);
      let out = await cli(at.socket, ['send-text', '--pane-id', id, '--', text]);
      if (!out.ok) return `WezTerm couldn't type into it: ${out.stderr.trim()}`;
      await unix.pause(300);
      out = await cli(at.socket, ['send-text', '--no-paste', '--pane-id', id, '--', '\r']);
      return out.ok ? null : `WezTerm couldn't press Enter: ${out.stderr.trim()}`;
    },
    async titles(ctxs) {
      const map = new Map();
      for (const socket of sockets(ctxs[0]?.table || (await unix.processTable()), ctxs[0])) {
        for (const p of await panes(socket)) if (p.tty_name && p.title) map.set(p.tty_name, p.title);
      }
      return map;
    },
  };
}

module.exports = { backend };
