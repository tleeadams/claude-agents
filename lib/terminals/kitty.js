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
const os = require('os');
const path = require('path');
const unix = require('./unix');

// kitty's installer puts it in ~/Applications; Homebrew in /Applications.
const MAC_APPS = ['/Applications', path.join(os.homedir(), 'Applications')].map((dir) => path.join(dir, 'kitty.app', 'Contents', 'MacOS'));
const SETUP =
  "kitty isn't listening for remote control. Add \"allow_remote_control socket-only\" and \"listen_on unix:/tmp/kitty\" to kitty.conf, then quit kitty completely and open it again.";

const findBin = (name) => unix.which(name) || MAC_APPS.map((dir) => path.join(dir, name)).find((file) => fs.existsSync(file)) || null;
const kitten = () => findBin('kitten') || findBin('kitty');

// The unix sockets a process has open, for a listen_on set to another path.
async function openSockets(pid) {
  const out = await unix.run('lsof', ['-a', '-p', String(pid), '-U', '-Fn']);
  return out.stdout
    .split('\n')
    .filter((line) => line.startsWith('n/'))
    .map((line) => line.slice(1))
    .filter(unix.isSocket);
}

// The sockets of running kittys, the session's own first: the one in its
// environment (Linux), /tmp/kitty-<PID> as listen_on unix:/tmp/kitty makes,
// or whatever socket the kitty process has open.
async function sockets(table, ctx) {
  const found = [];
  if (ctx?.env?.KITTY_LISTEN_ON) found.push(ctx.env.KITTY_LISTEN_ON);
  const own = ctx?.chain.find((p) => p.name === 'kitty');
  const pids = [...new Set([...(own ? [own.pid] : []), ...[...table.values()].filter((p) => p.name === 'kitty').map((p) => p.pid)])];
  for (const pid of pids) {
    if (unix.isSocket(`/tmp/kitty-${pid}`)) found.push(`unix:/tmp/kitty-${pid}`);
    else for (const file of await openSockets(pid)) found.push(`unix:${file}`);
  }
  if (unix.isSocket('/tmp/kitty')) found.push('unix:/tmp/kitty');
  return [...new Set(found)];
}

const remote = (to, args, input) => unix.run(kitten(), ['@', '--to', to, ...args], { input });

// The kitty socket and window running the session, or what stopped that.
async function locate(ctx) {
  const chain = new Set(ctx.chain.map((p) => p.pid));
  const list = await sockets(ctx.table || (await unix.processTable()), ctx);
  if (!list.length) return { error: SETUP };
  let refused = null;
  for (const to of list) {
    const out = await remote(to, ['ls']);
    if (!out.ok) {
      refused = refused || out.stderr.trim();
      continue;
    }
    let windows = [];
    try {
      windows = JSON.parse(out.stdout).flatMap((osWindow) => osWindow.tabs.flatMap((tab) => tab.windows));
    } catch {}
    const found = windows.find((w) => chain.has(w.pid) || (w.foreground_processes || []).some((p) => p.pid === ctx.pid));
    if (found) return { to, window: found };
  }
  if (refused) return { error: `kitty didn't answer on its remote-control socket: ${refused}` };
  return { error: "kitty is listening, but didn't list this session's window." };
}

function backend({ raise } = {}) {
  return {
    id: 'kitty',
    name: 'kitty',
    processNames: ['kitty'],
    available: () => Boolean(kitten()),
    hosts: (ctx) => ctx.chain.some((p) => p.name === 'kitty'),
    async open(dir, command) {
      const to = (await sockets(await unix.processTable()))[0];
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
      if (at.error) return { ok: false, error: at.error };
      const out = await remote(at.to, ['focus-window', '--match', `id:${at.window.id}`]);
      if (!out.ok) return { ok: false, error: `kitty couldn't go to it: ${out.stderr.trim()}` };
      if (raise) await raise(ctx);
      return { ok: true, tab: true };
    },
    // Pasted, marked as a paste if the session asked for that, then Enter.
    async type(ctx, text) {
      const at = await locate(ctx);
      if (at.error) return at.error;
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
        if (at.window?.title) map.set(ctx.tty, at.window.title);
      }
      return map;
    },
  };
}

module.exports = { backend };
