'use strict';

// macOS. Each terminal app is a backend (see unix-driver.js); sessions inside
// tmux are handled by tmux whatever terminal shows it. Terminal and iTerm2 are
// driven with AppleScript, through osascript; the first time, macOS asks to
// let Tabherd control them.

const fs = require('fs');
const os = require('os');
const path = require('path');
const unix = require('./unix');
const tmux = require('./tmux');
const kitty = require('./kitty');
const wezterm = require('./wezterm');
const { create } = require('./unix-driver');

// Where an app may be installed.
function appPath(bundle) {
  for (const dir of ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications/Utilities', '/Applications/Utilities']) {
    const file = path.join(dir, bundle);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// Runs an AppleScript, one line per -e, with argv as its arguments, so
// nothing passed in is ever read as script. The first call to an app waits on
// macOS's prompt asking whether to allow it, hence the long timeout.
async function osascript(script, argv = [], { timeout = 3 * 60 * 1000 } = {}) {
  const lines = script.trim().split('\n');
  const out = await unix.run('osascript', [...lines.flatMap((l) => ['-e', l]), ...argv], { timeout });
  if (/-1743/.test(out.stderr)) {
    return { ok: false, error: "macOS hasn't allowed Tabherd to control this terminal. Turn it on in System Settings › Privacy & Security › Automation." };
  }
  if (!out.ok) return { ok: false, error: out.stderr.replace(/^.*execution error: /s, '').trim() || 'AppleScript failed.' };
  return { ok: true, value: out.stdout.trim() };
}

const ESC = '\u001b';
// Text marked as a paste, so the Enter after it is an Enter: Claude Code takes
// keys that arrive with unmarked text as part of a paste.
const asPaste = (text) => `${ESC}[200~${text.replace(/\u001b/g, '')}${ESC}[201~`;

// The line a new tab or window types: `command` in `dir`. Terminal and iTerm2
// run it in a login shell, which stays open afterwards.
const typedLine = (dir, command) => `cd ${unix.shQuote(dir)} && ${command}`;

// Terminal. It can't open a tab from a script without the Accessibility
// permission, so new sessions open in a window. A closed tab's device can be
// reused, so a tab only counts while it has processes.
//
// Window IDs are fetched into a list first and looped over by index: looping
// over "id of every window" directly asks Terminal for "item 1 of id of every
// window", which it can't answer.
const FIND_TERMINAL_TAB = `
on findTab(want)
tell application id "com.apple.Terminal"
set wids to id of every window
repeat with k from 1 to count of wids
set wid to item k of wids
try
set ttys to tty of every tab of window id wid
repeat with i from 1 to count of ttys
if item i of ttys is want then
if (count of (processes of tab i of window id wid)) > 0 then return {wid, i}
end if
end repeat
end try
end repeat
end tell
return missing value
end findTab`;

const terminalApp = {
  id: 'terminal',
  name: 'Terminal',
  processNames: ['Terminal'],
  available: () => true,
  hosts: (ctx) => ctx.chain.some((p) => p.name === 'Terminal'),
  async open(dir, command) {
    const result = await osascript(
      `
on run argv
tell application id "com.apple.Terminal"
do script (item 1 of argv)
activate
end tell
end run`,
      [typedLine(dir, command)],
    );
    return result.ok ? { ok: true } : result;
  },
  async focus(ctx) {
    const result = await osascript(
      `${FIND_TERMINAL_TAB}
on run argv
set loc to my findTab(item 1 of argv)
if loc is missing value then return "not_found"
set {wid, i} to loc
tell application id "com.apple.Terminal"
try
set miniaturized of window id wid to false
end try
set selected of tab i of window id wid to true
set index of window id wid to 1
activate
end tell
return "ok"
end run`,
      [ctx.tty],
    );
    if (!result.ok) return result;
    if (result.value === 'not_found') return { ok: false, error: "Terminal has no tab for this session. It may be in a window that's closing." };
    return { ok: true, tab: true };
  },
  // do script types into the tab, ending with a Return.
  async type(ctx, text) {
    const result = await osascript(
      `${FIND_TERMINAL_TAB}
on run argv
set loc to my findTab(item 1 of argv)
if loc is missing value then return "not_found"
set {wid, i} to loc
tell application id "com.apple.Terminal" to do script (item 2 of argv) in tab i of window id wid
return "ok"
end run`,
      [ctx.tty, asPaste(text)],
    );
    if (!result.ok) return result.error;
    return result.value === 'not_found' ? 'its tab was gone' : null;
  },
  // A program's title shows in the window's title bar, first, for the
  // selected tab; a custom title, for any tab.
  async titles(ctxs) {
    const result = await osascript(
      `
on run argv
set out to ""
set sep to character id 9
set nl to character id 10
tell application id "com.apple.Terminal"
if not running then return ""
set wids to id of every window
repeat with k from 1 to count of wids
set wid to item k of wids
try
set wname to name of window id wid
set ttys to tty of every tab of window id wid
repeat with i from 1 to count of ttys
if argv contains (item i of ttys) then
set t to tab i of window id wid
set out to out & (item i of ttys) & sep & (custom title of t) & sep & (selected of t as text) & sep & wname & nl
end if
end repeat
end try
end repeat
end tell
return out
end run`,
      ctxs.map((c) => c.tty),
      { timeout: 10000 },
    );
    const map = new Map();
    if (!result.ok) return map;
    for (const line of result.value.split('\n')) {
      const [tty, custom, selected, windowName] = line.split('\t');
      const title = custom || (selected === 'true' ? String(windowName || '').split(' — ')[0] : '');
      if (tty && title) map.set(tty, title);
    }
    return map;
  },
};

// iTerm2. Each tab holds sessions (panes); the lookup fetches each window's
// session devices in one call, as nested lists. Closed windows stay listed,
// hidden, so only shown or minimized windows count.
const FIND_ITERM_SESSION = `
on findSession(want)
tell application id "com.googlecode.iterm2"
set wids to id of every window
repeat with k from 1 to count of wids
set wid to item k of wids
try
if (visible of window id wid) or (miniaturized of window id wid) then
set ttys to tty of every session of every tab of window id wid
repeat with i from 1 to count of ttys
set tabTtys to item i of ttys
repeat with j from 1 to count of tabTtys
if item j of tabTtys is want then return {wid, i, j}
end repeat
end repeat
end if
end try
end repeat
end tell
return missing value
end findSession`;

const iterm = {
  id: 'iterm2',
  name: 'iTerm2',
  processNames: ['iTerm2'],
  available: () => Boolean(appPath('iTerm.app')),
  // Sessions run under iTerm2's server process, which outlives the app.
  hosts: (ctx) => ctx.chain.some((p) => p.name === 'iTerm2' || p.name.startsWith('iTermServer')),
  async open(dir, command) {
    const result = await osascript(
      `
on run argv
tell application id "com.googlecode.iterm2"
set w to missing value
try
set w to current window
end try
if w is missing value then
set s to current session of (create window with default profile)
else
tell w to set t to (create tab with default profile)
set s to current session of t
end if
tell s to write text (item 1 of argv)
activate
end tell
end run`,
      [typedLine(dir, command)],
    );
    return result.ok ? { ok: true } : result;
  },
  async focus(ctx) {
    const result = await osascript(
      `${FIND_ITERM_SESSION}
on run argv
set loc to my findSession(item 1 of argv)
if loc is missing value then return "not_found"
set {wid, i, j} to loc
tell application id "com.googlecode.iterm2"
try
set miniaturized of window id wid to false
end try
select tab i of window id wid
select session j of tab i of window id wid
select window id wid
activate
end tell
return "ok"
end run`,
      [ctx.tty],
    );
    if (!result.ok) return result;
    if (result.value === 'not_found') return { ok: false, error: 'iTerm2 has no session for this one.' };
    return { ok: true, tab: true };
  },
  // write text sends the text and then a Return.
  async type(ctx, text) {
    const result = await osascript(
      `${FIND_ITERM_SESSION}
on run argv
set loc to my findSession(item 1 of argv)
if loc is missing value then return "not_found"
set {wid, i, j} to loc
tell application id "com.googlecode.iterm2"
tell session j of tab i of window id wid to write text (item 2 of argv)
end tell
return "ok"
end run`,
      [ctx.tty, asPaste(text)],
    );
    if (!result.ok) return result.error;
    return result.value === 'not_found' ? 'its session was gone' : null;
  },
  // The title a program set, rather than the tab bar's formatted name.
  async titles(ctxs) {
    const result = await osascript(
      `
on run argv
set out to ""
set sep to character id 9
set nl to character id 10
tell application id "com.googlecode.iterm2"
if not running then return ""
repeat with w in (every window)
repeat with t in (tabs of w)
repeat with s in (sessions of t)
if argv contains (tty of s) then
set shown to ""
try
tell s to set shown to (variable named "session.terminalWindowName")
end try
if shown is "" or shown is missing value then set shown to name of s
set out to out & (tty of s) & sep & shown & nl
end if
end repeat
end repeat
end repeat
end tell
return out
end run`,
      ctxs.map((c) => c.tty),
      { timeout: 10000 },
    );
    const map = new Map();
    if (!result.ok) return map;
    for (const line of result.value.split('\n')) {
      const [tty, title] = line.split('\t');
      if (tty && title) map.set(tty, title);
    }
    return map;
  },
};

// Ghostty, through the AppleScript support it has had since 1.3; finding a
// session's terminal by its device needs 1.4.
const FIND_GHOSTTY_TERMINAL = `
on findTerminal(want)
tell application id "com.mitchellh.ghostty"
repeat with w in windows
repeat with tb in tabs of w
repeat with t in terminals of tb
if (tty of t) is want then return t
end repeat
end repeat
end repeat
end tell
return missing value
end findTerminal`;

const OLD_GHOSTTY = 'Going to a Ghostty tab needs Ghostty 1.4 or later.';

const ghostty = {
  id: 'ghostty',
  name: 'Ghostty',
  processNames: ['ghostty'],
  available: () => Boolean(appPath('Ghostty.app')),
  hosts: (ctx) => ctx.chain.some((p) => p.name === 'ghostty'),
  // The line is typed into the tab's own shell, which stays open afterwards.
  async open(dir, command) {
    const result = await osascript(
      `
on run argv
set nl to character id 10
tell application id "com.mitchellh.ghostty"
set cfg to new surface configuration
set initial working directory of cfg to item 1 of argv
set initial input of cfg to (item 2 of argv) & nl
if (count of windows) > 0 then
new tab in front window with configuration cfg
else
new window with configuration cfg
end if
activate
end tell
end run`,
      [dir, typedLine(dir, command)],
    );
    return result.ok ? { ok: true } : result;
  },
  async focus(ctx) {
    const result = await osascript(
      `${FIND_GHOSTTY_TERMINAL}
on run argv
set t to my findTerminal(item 1 of argv)
if t is missing value then return "not_found"
tell application id "com.mitchellh.ghostty"
focus t
activate
end tell
return "ok"
end run`,
      [ctx.tty],
    );
    if (!result.ok) return /tty/.test(result.error) ? { ok: false, error: OLD_GHOSTTY } : result;
    if (result.value === 'not_found') return { ok: false, error: 'Ghostty has no terminal for this session.' };
    return { ok: true, tab: true };
  },
  // `input text` arrives as a paste; Enter follows as its own key.
  async type(ctx, text) {
    const result = await osascript(
      `${FIND_GHOSTTY_TERMINAL}
on run argv
set t to my findTerminal(item 1 of argv)
if t is missing value then return "not_found"
tell application id "com.mitchellh.ghostty"
input text (item 2 of argv) to t
delay 0.3
send key "enter" to t
end tell
return "ok"
end run`,
      [ctx.tty, text],
    );
    if (!result.ok) return /tty/.test(result.error) ? OLD_GHOSTTY : result.error;
    return result.value === 'not_found' ? 'its terminal was gone' : null;
  },
  async titles(ctxs) {
    const result = await osascript(
      `
on run argv
set out to ""
set sep to character id 9
set nl to character id 10
tell application id "com.mitchellh.ghostty"
if not running then return ""
repeat with w in windows
repeat with tb in tabs of w
repeat with t in terminals of tb
if argv contains (tty of t) then set out to out & (tty of t) & sep & (name of t) & nl
end repeat
end repeat
end repeat
end tell
return out
end run`,
      ctxs.map((c) => c.tty),
      { timeout: 10000 },
    );
    const map = new Map();
    if (!result.ok) return map;
    for (const line of result.value.split('\n')) {
      const [tty, title] = line.split('\t');
      if (tty && title) map.set(tty, title);
    }
    return map;
  },
};

// kitty and WezTerm switch tab or pane themselves; macOS brings the app forward.
const activate = (app) => async () => (await unix.run('open', ['-a', app])).ok;

const backends = [
  terminalApp,
  iterm,
  ghostty,
  kitty.backend({ raise: activate('kitty') }),
  wezterm.backend({ raise: activate('WezTerm') }),
  {
    id: 'tmux',
    name: 'tmux',
    available: () => tmux.available(),
    hosts: () => false,
    open: tmux.open,
  },
];

// The terminal Automatic picks: one that's running, else one installed,
// iTerm2 and the others before Terminal, which every Mac has.
async function defaultTerminal(list) {
  const order = ['iterm2', 'ghostty', 'wezterm', 'kitty', 'terminal'];
  const table = await unix.processTable();
  const running = new Set([...table.values()].map((p) => p.name));
  const usable = order.map((id) => list.find((b) => b.id === id && b.open && b.available())).filter(Boolean);
  return (usable.find((b) => b.processNames?.some((n) => running.has(n))) || usable[0])?.id || null;
}

// The standard folder chooser, in front. Cancelling is error -128.
async function pickFolder(start, title) {
  const lines = ['on run argv', 'activate'];
  lines.push(start ? 'set f to choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))' : 'set f to choose folder with prompt (item 1 of argv)');
  lines.push('return POSIX path of f', 'end run');
  const args = lines.flatMap((l) => ['-e', l]).concat([title, ...(start ? [start] : [])]);
  const out = await unix.run('osascript', args, { timeout: 30 * 60 * 1000 });
  if (/-128/.test(out.stderr)) return { ok: true, cancelled: true };
  const picked = out.stdout.trim().replace(/\/$/, '');
  return out.ok && picked ? { ok: true, path: picked } : { ok: false, error: out.stderr.trim() || "The folder picker didn't open." };
}

const openFolder = (dir) => unix.detached('open', [dir]);

module.exports = create({ name: 'macos', backends, openFolder, pickFolder, defaultTerminal });
