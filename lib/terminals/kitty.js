'use strict';

// kitty, on macOS and Linux, driven through its remote control. That's off
// until kitty.conf has these two lines, and kitty is restarted:
//
//   allow_remote_control socket-only
//   listen_on unix:/tmp/kitty
//
// kitty then listens on /tmp/kitty-<its PID>. Its panes have no terminal
// device to go by, so a session's pane is the one whose shell is among the
// session's ancestors.

const fs = require('fs');
const unix = require('./unix');

const MAC_APP = '/Applications/kitty.app/Contents/MacOS';
const SETUP =
  "kitty's remote control is off. Add \"allow_remote_control socket-only\" and \"listen_on unix:/tmp/kitty\" to kitty.conf, then restart kitty.";

const findBin = (name) => unix.which(name) || (fs.existsSync(`${MAC_APP}/${name}`) ? `${MAC_APP}/${name}` : null);
const kitten = () => findBin('kitten') || findBin('kitty');

// The sockets of running kittys, the session's own first.
function sockets(table, ctx) {
  const found = [];
  if (ctx?.env?.KITTY_LISTEN_ON) found.push(ctx.env.KITTY_LISTEN_ON);
  const own = ctx?.chain.find((p) => p.name === 'kitty');
  const pids = [...(own ? [own.pid] : []), ...[...table.values()].filter((p) => p.name === 'kitty').map((p) => p.pid)];
  for (const pid of pids) if (unix.isSocket(`/tmp/kitty-${pid}`)) found.push(`unix:/tmp/kitty-${pid}`);
  if (unix.isSocket('/tmp/kitty')) found.push('unix:/tmp/kitty');
  return [...new Set(found)];
}

const remote = (to, args, input) => unix.run(kitten(), ['@', '--to', to, ...args], { input });

async function windows(to) {
  const out = await remote(to, ['ls']);
  if (!out.ok) return [];
  try {
    return JSON.parse(out.stdout).flatMap((osWindow) => osWindow.tabs.flatMap((tab) => tab.windows));
  } catch {
    return [];
  }
}

// The kitty socket and window running the session, if remote control is on.
async function locate(ctx) {
  const chain = new Set(ctx.chain.map((p) => p.pid));
  for (const to of sockets(ctx.table || (await unix.processTable()), ctx)) {
    const found = (await windows(to)).find((w) => chain.has(w.pid) || (w.foreground_processes || []).some((p) => p.pid === ctx.pid));
    if (found) return { to, window: found };
  }
  return null;
}

function backend({ raise } = {}) {
  return {
    id: 'kitty',
    name: 'kitty',
    processNames: ['kitty'],
    available: () => Boolean(kitten()),
    hosts: (ctx) => ctx.chain.some((p) => p.name === 'kitty'),
    async open(dir, command) {
      const to = sockets(await unix.processTable())[0];
      if (to) {
        const out = await remote(to, ['launch', '--type=tab', `--cwd=${dir}`, ...unix.shellArgs(dir, command)]);
        if (out.ok) return { ok: true };
      }
      // Without remote control, a new kitty window.
      const kitty = findBin('kitty');
      if (!kitty) return { ok: false, error: "kitty wasn't found." };
      return unix.detached(kitty, ['--directory', dir, ...unix.shellArgs(dir, command)]);
    },
    async focus(ctx) {
      const at = await locate(ctx);
      if (!at) return { ok: false, error: SETUP };
      const out = await remote(at.to, ['focus-window', '--match', `id:${at.window.id}`]);
      if (!out.ok) return { ok: false, error: `kitty couldn't go to it: ${out.stderr.trim()}` };
      if (raise) await raise(ctx);
      return { ok: true, tab: true };
    },
    // Pasted, marked as a paste if the session asked for that, then Enter.
    async type(ctx, text) {
      const at = await locate(ctx);
      if (!at) return SETUP;
      const match = ['--match', `id:${at.window.id}`];
      let out = await remote(at.to, ['send-text', ...match, '--bracketed-paste=auto', '--stdin'], text);
      if (!out.ok) out = await remote(at.to, ['send-text', ...match, '--stdin'], text);
      if (!out.ok) return `kitty couldn't type into it: ${out.stderr.trim()}`;
      await unix.pause(300);
      out = await remote(at.to, ['send-key', ...match, 'enter']);
      return out.ok ? null : `kitty couldn't press Enter: ${out.stderr.trim()}`;
    },
    async titles(ctxs) {
      const map = new Map();
      for (const ctx of ctxs) {
        const at = await locate(ctx);
        if (at?.window.title) map.set(ctx.tty, at.window.title);
      }
      return map;
    },
  };
}

module.exports = { backend };
