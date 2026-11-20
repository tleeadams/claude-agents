'use strict';

// Linux. Each terminal app is a backend (see unix-driver.js); sessions inside
// tmux are handled by tmux whatever terminal shows it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const unix = require('./unix');
const tmux = require('./tmux');
const kitty = require('./kitty');
const wezterm = require('./wezterm');
const { create } = require('./unix-driver');

const has = (cmd) => Boolean(unix.which(cmd));
const inChain = (ctx, ...names) => ctx.chain.some((p) => names.includes(p.name));

const desktop = () => String(process.env.XDG_CURRENT_DESKTOP || '').toUpperCase();
const wayland = () => Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland';

// busctl, on the user's session bus, with its JSON output parsed.
async function busctl(args) {
  if (!has('busctl')) return { ok: false, error: 'busctl was not found.' };
  const out = await unix.run('busctl', ['--user', '--json=short', ...args]);
  if (!out.ok) return { ok: false, error: out.stderr.trim() };
  try {
    return { ok: true, data: out.stdout.trim() ? JSON.parse(out.stdout).data : null };
  } catch {
    return { ok: true, data: null };
  }
}

// On KDE, KWin runs a small script that activates the window, which works on
// Wayland too: KWin's own scripts aren't held back by focus-stealing rules.
async function raiseOnKde(pid, title) {
  const script = path.join(os.tmpdir(), `tabherd-raise-${process.pid}.js`);
  const match = title ? ` && w.caption.indexOf(${JSON.stringify(title)}) >= 0` : '';
  fs.writeFileSync(
    script,
    `for (const w of workspace.windowList()) if (w.pid === ${Number(pid)} && w.normalWindow${match}) { workspace.activeWindow = w; break; }\n`,
  );
  const name = 'tabherd-raise';
  await busctl(['call', 'org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', 's', name]);
  const loaded = await busctl(['call', 'org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'loadScript', 'ss', script, name]);
  const id = loaded.data?.[0];
  if (!loaded.ok || !(id >= 0)) return false;
  const ran = await busctl(['call', 'org.kde.KWin', `/Scripting/Script${id}`, 'org.kde.kwin.Script', 'run']);
  return ran.ok;
}

// Brings a terminal's window forward: through KWin on KDE, and with xdotool on
// X11, picking the window with that title when the terminal has several.
// GNOME on Wayland doesn't let one app do this for another; it shows that the
// window is ready instead.
async function raiseWindow(pid, title, windowId) {
  if (!pid) return false;
  if (desktop().includes('KDE') && has('busctl')) return raiseOnKde(pid, title);
  if (!process.env.DISPLAY || !has('xdotool')) return false;
  if (windowId) return (await unix.run('xdotool', ['windowactivate', String(windowId)])).ok;
  const out = await unix.run('xdotool', ['search', '--onlyvisible', '--pid', String(pid)]);
  const ids = out.stdout.split('\n').filter(Boolean);
  if (!ids.length) return false;
  let target = ids[0];
  if (title) {
    for (const id of ids) {
      const name = await unix.run('xdotool', ['getwindowname', id]);
      if (name.stdout.trim().includes(title)) target = id;
    }
  }
  return (await unix.run('xdotool', ['windowactivate', target])).ok;
}

// The terminal's own process, among the session's ancestors. Linux shortens
// process names to 15 characters, so gnome-terminal-server is "gnome-terminal-".
const guiPid = (ctx, ...names) => ctx?.chain?.find((p) => names.includes(p.name))?.pid;

// The environment a session in an existing window has, so a new tab can join
// that window, from the first shell found under that terminal's process.
function siblingEnvironment(table, terminalNames, key) {
  for (const p of table.values()) {
    const parent = table.get(p.ppid);
    if (!parent || !terminalNames.includes(parent.name)) continue;
    const env = unix.environment(p.pid);
    if (env?.[key]) return env;
  }
  return null;
}

// GNOME Terminal. Its search provider, which GNOME's shell uses to find tabs,
// is what can switch to a tab and read tab titles; each session's environment
// names its tab. Nothing outside it can type into a tab.
const GNOME_SERVER = ['gnome-terminal-', 'gnome-terminal-server'];
const SEARCH_PROVIDER = ['/org/gnome/Terminal/SearchProvider', 'org.gnome.Shell.SearchProvider2'];
const gnomeTab = (ctx) => {
  const screen = ctx.env?.GNOME_TERMINAL_SCREEN;
  return screen ? { service: ctx.env.GNOME_TERMINAL_SERVICE || 'org.gnome.Terminal', uuid: path.basename(screen).replace(/_/g, '-') } : null;
};

const gnomeTerminal = {
  id: 'gnome-terminal',
  processNames: GNOME_SERVER,
  name: 'GNOME Terminal',
  available: () => has('gnome-terminal'),
  hosts: (ctx) => Boolean(ctx.env?.GNOME_TERMINAL_SCREEN) || inChain(ctx, ...GNOME_SERVER),
  // A tab joins an existing window when gnome-terminal is told one of its
  // tabs; otherwise it opens a window.
  async open(dir, command) {
    const env = { ...process.env };
    delete env.GNOME_TERMINAL_SCREEN;
    delete env.GNOME_TERMINAL_SERVICE;
    const sibling = siblingEnvironment(await unix.processTable(), GNOME_SERVER, 'GNOME_TERMINAL_SCREEN');
    if (sibling) Object.assign(env, { GNOME_TERMINAL_SCREEN: sibling.GNOME_TERMINAL_SCREEN, GNOME_TERMINAL_SERVICE: sibling.GNOME_TERMINAL_SERVICE });
    const out = await unix.run('gnome-terminal', ['--tab', `--working-directory=${dir}`, '--', ...unix.shellArgs(dir, command)], { env });
    return out.ok ? { ok: true } : { ok: false, error: `GNOME Terminal didn't open a tab: ${out.stderr.trim()}` };
  },
  async focus(ctx) {
    const tab = gnomeTab(ctx);
    if (!tab) return { ok: false, error: "GNOME Terminal didn't say which tab this session is in." };
    const out = await busctl(['call', tab.service, ...SEARCH_PROVIDER, 'ActivateResult', 'sasu', tab.uuid, '0', '0']);
    if (!out.ok) return { ok: false, error: `GNOME Terminal couldn't go to it: ${out.error}` };
    // The window now shows the tab's title, which picks it out on X11.
    const meta = await busctl(['call', tab.service, ...SEARCH_PROVIDER, 'GetResultMetas', 'as', '1', tab.uuid]);
    const raised = await raiseWindow(guiPid(ctx, ...GNOME_SERVER), meta.data?.[0]?.[0]?.name?.data);
    return { ok: true, tab: true, raised };
  },
  async titles(ctxs) {
    const map = new Map();
    const tabs = ctxs.map((ctx) => ({ ctx, tab: gnomeTab(ctx) })).filter((t) => t.tab);
    if (!tabs.length) return map;
    const out = await busctl(['call', tabs[0].tab.service, ...SEARCH_PROVIDER, 'GetResultMetas', 'as', String(tabs.length), ...tabs.map((t) => t.tab.uuid)]);
    for (const meta of out.data?.[0] || []) {
      const t = tabs.find((x) => x.tab.uuid === meta.id?.data);
      if (t && meta.name?.data) map.set(t.ctx.tty, meta.name.data);
    }
    return map;
  },
};

// Ptyxis, Ubuntu's terminal from 25.10. It can open a tab; showing a given tab
// needs the tab's ID in the session's environment, which Ptyxis adds after 50.
const ptyxis = {
  id: 'ptyxis',
  processNames: ['ptyxis', 'ptyxis-agent'],
  name: 'Ptyxis',
  available: () => has('ptyxis'),
  hosts: (ctx) => Boolean(ctx.env?.PTYXIS_VERSION) || inChain(ctx, 'ptyxis', 'ptyxis-agent'),
  async open(dir, command) {
    const out = await unix.run('ptyxis', ['--tab', '-d', dir, '--', ...unix.shellArgs(dir, command)]);
    return out.ok ? { ok: true } : { ok: false, error: `Ptyxis didn't open a tab: ${out.stderr.trim()}` };
  },
  async focus(ctx) {
    const uuid = ctx.env?.PTYXIS_TAB;
    if (!uuid) {
      const raised = await raiseWindow(guiPid(ctx, 'ptyxis'));
      return raised ? { ok: true, tab: false } : { ok: false, error: 'This version of Ptyxis can\'t be asked to show a given tab.' };
    }
    const out = await busctl(['call', 'org.gnome.Ptyxis', '/org/gnome/Ptyxis', 'org.gtk.Actions', 'Activate', 'sava{sv}', 'focus-tab-by-uuid', '1', 's', uuid, '0']);
    return out.ok ? { ok: true, tab: true } : { ok: false, error: `Ptyxis couldn't go to it: ${out.error}` };
  },
};

// Konsole, through its D-Bus interface; each session's environment names its
// service, window and session. From Konsole 25.12, typing into a tab is off
// until the user turns on a setting.
const KONSOLE_LOCKED =
  'Konsole blocks typing into its tabs. Turn on Configure Konsole › General › "Enable the security sensitive parts of the DBus API", then restart Konsole.';
// Konsole's version as a number, 2508 for 25.08.
let konsoleVersion = null;
async function konsoleRelease() {
  if (konsoleVersion === null) {
    const m = (await unix.run('konsole', ['--version'])).stdout.match(/(\d+)\.(\d+)/);
    konsoleVersion = m ? Number(m[1]) * 100 + Number(m[2]) : 0;
  }
  return konsoleVersion;
}

const konsoleIds = (ctx) => {
  const env = ctx.env || {};
  if (!env.KONSOLE_DBUS_SERVICE || !env.KONSOLE_DBUS_SESSION) return null;
  return { service: env.KONSOLE_DBUS_SERVICE, session: env.KONSOLE_DBUS_SESSION, window: env.KONSOLE_DBUS_WINDOW, windowId: env.WINDOWID };
};

const konsole = {
  id: 'konsole',
  processNames: ['konsole'],
  name: 'Konsole',
  available: () => has('konsole'),
  hosts: (ctx) => Boolean(ctx.env?.KONSOLE_DBUS_SESSION) || inChain(ctx, 'konsole'),
  // In a running Konsole, a new tab in its window: from 25.08 by loading a
  // one-tab layout, which types the command into the tab's shell and isn't
  // blocked as typing is from 25.12; before 25.08, a new tab and then the
  // command. Otherwise, a new window.
  async open(dir, command) {
    const sibling = siblingEnvironment(await unix.processTable(), ['konsole'], 'KONSOLE_DBUS_SERVICE');
    if (sibling?.KONSOLE_DBUS_WINDOW) {
      const at = [sibling.KONSOLE_DBUS_SERVICE, sibling.KONSOLE_DBUS_WINDOW, 'org.kde.konsole.Window'];
      if ((await konsoleRelease()) >= 2508) {
        const layout = path.join(os.tmpdir(), `tabherd-konsole-${process.pid}.json`);
        fs.writeFileSync(layout, JSON.stringify({ Orientation: 'Horizontal', Widgets: [{ SessionRestoreId: 0, WorkingDirectory: dir, Command: command }] }));
        const loaded = await busctl(['call', ...at, 'loadLayout', 's', layout]);
        fs.rmSync(layout, { force: true });
        if (loaded.ok) return { ok: true };
      } else {
        const created = await busctl(['call', ...at, 'newSession', 'ss', '', dir]);
        const id = created.data?.[0];
        if (created.ok && Number.isInteger(id)) {
          const ran = await busctl(['call', sibling.KONSOLE_DBUS_SERVICE, `/Sessions/${id}`, 'org.kde.konsole.Session', 'runCommand', 's', command]);
          if (ran.ok) return { ok: true };
        }
      }
    }
    return unix.detached('konsole', ['--new-tab', '--workdir', dir, '-e', ...unix.shellArgs(dir, command)]);
  },
  async focus(ctx) {
    const ids = konsoleIds(ctx);
    if (!ids) return { ok: false, error: "Konsole didn't say which tab this session is in." };
    const session = Number(path.basename(ids.session));
    const out = await busctl(['call', ids.service, ids.window || '/Windows/1', 'org.kde.konsole.Window', 'setCurrentSession', 'i', String(session)]);
    if (!out.ok) return { ok: false, error: `Konsole couldn't go to it: ${out.error}` };
    const title = (await busctl(['call', ids.service, ids.session, 'org.kde.konsole.Session', 'title', 'i', '1'])).data?.[0];
    const raised = await raiseWindow(guiPid(ctx, 'konsole'), title, wayland() ? null : ids.windowId);
    return { ok: true, tab: true, raised };
  },
  async type(ctx, text) {
    const ids = konsoleIds(ctx);
    if (!ids) return "Konsole didn't say which tab this session is in";
    const send = (s) => busctl(['call', ids.service, ids.session, 'org.kde.konsole.Session', 'sendText', 's', s]);
    let out = await send(`\u001b[200~${text}\u001b[201~`);
    if (!out.ok) return /AccessDenied|disabled/i.test(out.error) ? KONSOLE_LOCKED : `Konsole couldn't type into it: ${out.error}`;
    await unix.pause(300);
    out = await send('\r');
    return out.ok ? null : `Konsole couldn't press Enter: ${out.error}`;
  },
  // No titles: Konsole's tabs are named by its own format, the folder and the
  // program, and the title a program sets isn't available over D-Bus.
};

// Ghostty on Linux can open tabs and windows, and from 1.4 show a given tab,
// through its D-Bus service. It can't be typed into or have its titles read
// from outside; sessions run inside tmux get those.
const ghostty = {
  id: 'ghostty',
  processNames: ['ghostty'],
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
  gnomeTerminal,
  ptyxis,
  konsole,
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
