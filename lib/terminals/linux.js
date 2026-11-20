'use strict';

// Linux. Each terminal app is a backend (see unix-driver.js); sessions inside
// tmux are handled by tmux whatever terminal shows it.

const path = require('path');
const unix = require('./unix');
const tmux = require('./tmux');
const kitty = require('./kitty');
const wezterm = require('./wezterm');
const { create } = require('./unix-driver');

const has = (cmd) => Boolean(unix.which(cmd));
const inChain = (ctx, ...names) => ctx.chain.some((p) => names.includes(p.name));

// Brings the terminal's window forward on X11, picking the window with that
// title when the terminal has several. Wayland desktops don't let one app do
// that for another, so there the terminal's own request has to do.
async function raiseWindow(pid, title) {
  if (!pid || !process.env.DISPLAY || !has('xdotool')) return false;
  const out = await unix.run('xdotool', ['search', '--onlyvisible', '--pid', String(pid)]);
  const ids = out.stdout.split('\n').filter(Boolean);
  if (!ids.length) return false;
  let target = ids[0];
  if (title) {
    for (const id of ids) {
      const name = await unix.run('xdotool', ['getwindowname', id]);
      if (name.stdout.trim() === title) target = id;
    }
  }
  return (await unix.run('xdotool', ['windowactivate', target])).ok;
}

const guiPid = (ctx, name) => ctx?.chain?.find((p) => p.name === name)?.pid;

// Ghostty on Linux can open tabs and windows, and from 1.4 show a given tab,
// through its D-Bus service. It can't be typed into or have its titles read
// from outside; sessions run inside tmux get those.
const ghostty = {
  id: 'ghostty',
  name: 'Ghostty',
  available: () => has('ghostty'),
  hosts: (ctx) => inChain(ctx, 'ghostty'),
  async open(dir, command) {
    const args = [`--working-directory=${dir}`, '-e', ...unix.shellArgs(dir, command)];
    for (const action of ['+new-tab', '+new-window']) {
      if ((await unix.run('ghostty', [action, ...args])).ok) return { ok: true };
    }
    return unix.detached('ghostty', args);
  },
  async focus(ctx) {
    const surface = ctx.env?.GHOSTTY_SURFACE_ID;
    if (!surface || !has('gdbus')) {
      const raised = await raiseWindow(guiPid(ctx, 'ghostty'));
      return raised ? { ok: true, tab: false } : { ok: false, error: 'Ghostty can only be asked to show a tab from version 1.4.' };
    }
    const out = await unix.run('gdbus', [
      'call', '--session', '--dest', 'com.mitchellh.ghostty', '--object-path', '/com/mitchellh/ghostty',
      '--method', 'org.gtk.Actions.Activate', 'present-surface', `[<uint64 ${BigInt(surface).toString()}>]`, '{}',
    ]);
    return out.ok ? { ok: true, tab: true } : { ok: false, error: `Ghostty couldn't go to it: ${out.stderr.trim()}` };
  },
};

const backends = [
  kitty.backend(),
  wezterm.backend({ raise: (ctx) => raiseWindow(guiPid(ctx, 'wezterm-gui'), ctx.title) }),
  ghostty,
  {
    id: 'tmux',
    name: 'tmux',
    available: () => tmux.available(),
    hosts: () => false,
    open: tmux.open,
  },
];

// The terminal Automatic picks: the desktop's own, else the first one found.
async function defaultTerminal(list) {
  const desktop = String(process.env.XDG_CURRENT_DESKTOP || '').toUpperCase();
  const prefer = desktop.includes('KDE') ? ['konsole'] : desktop.includes('GNOME') ? ['ptyxis', 'gnome-terminal'] : [];
  const order = [...prefer, 'gnome-terminal', 'ptyxis', 'konsole', 'kitty', 'wezterm', 'ghostty', 'tmux'];
  return order.find((id) => list.find((b) => b.id === id && b.open && b.available())) || null;
}

// zenity on GNOME and most desktops, kdialog on KDE. Both exit 1 when cancelled.
async function pickFolder(start, title) {
  const kde = String(process.env.XDG_CURRENT_DESKTOP || '').toUpperCase().includes('KDE');
  const tools = kde ? ['kdialog', 'zenity'] : ['zenity', 'kdialog'];
  const tool = tools.find(has);
  if (!tool) return { ok: false, error: 'No folder picker was found. Install zenity, or choose the folder from the repo menu.' };
  const args =
    tool === 'zenity'
      ? ['--file-selection', '--directory', `--title=${title}`, ...(start ? [`--filename=${path.join(start, '/')}`] : [])]
      : ['--getexistingdirectory', start || '.', '--title', title];
  const out = await unix.run(tool, args, { timeout: 30 * 60 * 1000 });
  if (out.code === 1) return { ok: true, cancelled: true };
  const picked = out.stdout.trim();
  return out.ok && picked ? { ok: true, path: picked } : { ok: false, error: out.stderr.trim() || `${tool} didn't return a folder.` };
}

const openFolder = (dir) => unix.detached('xdg-open', [dir]);

module.exports = create({ name: 'linux', backends, openFolder, pickFolder, defaultTerminal });
