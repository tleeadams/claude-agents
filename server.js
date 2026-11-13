#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { snapshot, findAgent, sessionFile, rememberTab } = require('./lib/agents');
const { scanRepos, resolveRepo } = require('./lib/repos');

const PORT = Number(process.env.PORT) || 4317;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const FOCUS_SCRIPT = path.join(__dirname, 'lib', 'focus-window.ps1');
// Fixed here rather than sent by the page, so the API can't type arbitrary
// commands into agents.
const CATCH_UP_PROMPT = (
  process.env.CATCH_UP_PROMPT ||
  "Catch me up: where do things stand? Briefly cover what's done, what's in progress, and anything you need from me."
).replace(/\s+/g, ' ');
const IS_WIN = process.platform === 'win32';
const CLAUDE_COMMAND = 'claude --dangerously-skip-permissions';
const SNAPSHOT_TTL_MS = 1000;
// With --exit-when-idle (as the desktop launcher starts it), the server stops
// once no dashboard has been open for this long.
const IDLE_EXIT_MS = 10 * 60 * 1000;
let lastRequestAt = Date.now();
// Required on every action, so other web pages cannot drive this server.
const TOKEN = crypto.randomBytes(24).toString('hex');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

let cached = null;
let cachedAt = 0;
let inflight = null;

function currentSnapshot() {
  if (cached && Date.now() - cachedAt < SNAPSHOT_TTL_MS) return Promise.resolve(cached);
  if (!inflight) {
    inflight = snapshot()
      .then((snap) => {
        cached = snap;
        cachedAt = Date.now();
        return snap;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// Open dashboards get each snapshot pushed to them. A browser slows timers in
// hidden or covered windows to as little as once a minute, but a pushed message
// is handled at once, so the page can ding the moment an agent needs you.
const STREAM_MS = 2000;
const streams = new Set();
let streamTimer = null;

function pushSnapshot() {
  currentSnapshot()
    .then((snap) => {
      const message = `data: ${JSON.stringify(snap)}\n\n`;
      for (const res of streams) res.write(message);
    })
    .catch(() => {});
}

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.write('retry: 2000\n\n');
  streams.add(res);
  pushSnapshot();
  if (!streamTimer) streamTimer = setInterval(pushSnapshot, STREAM_MS);
  req.on('close', () => {
    streams.delete(res);
    lastRequestAt = Date.now();
    if (!streams.size) {
      clearInterval(streamTimer);
      streamTimer = null;
    }
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; img-src 'self' data:",
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function detached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

function openFolder(dir) {
  if (IS_WIN) detached('explorer.exe', [dir]);
  else detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [dir]);
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Goes to the session's window and, with `send`, also types that prompt into it.
function focusWindow(pid, send) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      resolve({ ok: false, error: 'Going to a window is only supported on Windows.' });
      return;
    }
    const extra = send ? ` -Send ${psQuote(send)} -StatusFile ${psQuote(sessionFile(pid))}` : '';
    // An encoded command isn't subject to the script execution policy.
    const script = `& {\n${fs.readFileSync(FOCUS_SCRIPT, 'utf8')}\n} ${Number(pid)}${extra}`;
    const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    execFile('powershell.exe', args, { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      try {
        resolve(JSON.parse(String(stdout).trim().split(/\r?\n/).pop()));
      } catch {
        const detail = String(stderr || err?.message || '').trim().split(/\r?\n/)[0];
        resolve({ ok: false, error: detail || 'Could not find the window.' });
      }
    });
  });
}

// pwsh from the Microsoft Store is an app execution alias, a link that
// fs.existsSync can't follow, so check for the link itself.
function onPath(exe) {
  return (process.env.PATH || '').split(path.delimiter).some((dir) => {
    try {
      return Boolean(dir) && Boolean(fs.lstatSync(path.join(dir, exe)));
    } catch {
      return false;
    }
  });
}

const TERMINAL_SETTINGS = [
  ['Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'],
  ['Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'],
  ['Microsoft', 'Windows Terminal', 'settings.json'],
];

// Windows Terminal's profile defaults can say to run tabs as administrator. A
// tab opened with just a command line gets those defaults, so it opened in a
// separate administrator instance that also mangled the command. Naming the
// default profile gives the tab the settings the user's own new tabs get.
function defaultTerminalProfile() {
  for (const parts of TERMINAL_SETTINGS) {
    try {
      const text = fs.readFileSync(path.join(process.env.LOCALAPPDATA || '', ...parts), 'utf8');
      const match = text.match(/"defaultProfile"\s*:\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {}
  }
  return null;
}

// Opens a tab in the most recently used Windows Terminal window, starting
// Claude in `dir`. Claude runs inside a shell, so the tab stays open at a
// prompt in that folder after Claude exits.
function openClaude(dir) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      resolve({ ok: false, error: 'Opening a terminal is only supported on Windows.' });
      return;
    }
    const shell = onPath('pwsh.exe') ? 'pwsh.exe' : 'powershell.exe';
    const profile = defaultTerminalProfile();
    // Encoded, the command can't be split up or have its flags read by
    // Windows Terminal as its own.
    const command = Buffer.from(CLAUDE_COMMAND, 'utf16le').toString('base64');
    const args = ['-w', '0', 'new-tab', ...(profile ? ['-p', profile] : []), '-d', dir, shell, '-NoExit', '-EncodedCommand', command];
    const child = spawn('wt.exe', args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => resolve({ ok: false, error: `Couldn't start Windows Terminal: ${err.message}` }));
    child.on('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16384) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function stopProcess(pid) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      try {
        process.kill(pid, 'SIGTERM');
        resolve({ ok: true });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
      return;
    }
    // /T also ends the session's shells and MCP servers; a console app ignores
    // a polite close request, so /F is needed.
    const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: out.trim() || `taskkill exited ${code}` }));
  });
}

async function action(res, sessionId, name) {
  const agent = await findAgent(sessionId);
  if (!agent) return send(res, 404, { ok: false, error: 'That session is no longer running.' });
  cached = null;
  if (name === 'open-folder') {
    if (!agent.cwd || !fs.existsSync(agent.cwd)) return send(res, 400, { ok: false, error: 'Folder not found.' });
    openFolder(agent.cwd);
    return send(res, 200, { ok: true });
  }
  if (name === 'focus' || name === 'catch-up') {
    if (name === 'catch-up' && agent.status === 'waiting') {
      const label = agent.terminalTitle || agent.name;
      return send(res, 409, { ok: false, error: `${label} is waiting on a prompt or dialog. Use Go to window and answer it first.` });
    }
    const result = await focusWindow(agent.pid, name === 'catch-up' ? CATCH_UP_PROMPT : null);
    if (result.tabName) rememberTab(agent.pid, result.hwnd, result.tabName);
    return send(res, result.ok ? 200 : 500, result);
  }
  if (name === 'stop') {
    const result = await stopProcess(agent.pid);
    return send(res, result.ok ? 200 : 500, result);
  }
  return send(res, 404, { ok: false, error: 'Unknown action.' });
}

const server = http.createServer(async (req, res) => {
  try {
    // Rejecting other Host headers blocks DNS-rebinding pages from reading prompts.
    if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'Forbidden host' });
    lastRequestAt = Date.now();
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/agents') {
      return send(res, 200, await currentSnapshot());
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') return openStream(req, res);

    if (req.method === 'GET' && url.pathname === '/api/repos') {
      const { root, tree, count } = scanRepos(url.searchParams.has('refresh'));
      return send(res, 200, { root, home: os.homedir(), tree, count, command: CLAUDE_COMMAND });
    }

    if (url.pathname === '/api/repos/open') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
      if (req.headers['x-agents-token'] !== TOKEN) return send(res, 403, { error: 'Missing or bad token' });
      const dir = resolveRepo((await readJson(req)).path);
      if (!dir) return send(res, 404, { ok: false, error: 'That repo is not in the list. Rescan and try again.' });
      const result = await openClaude(dir);
      return send(res, result.ok ? 200 : 500, result);
    }

    const m = url.pathname.match(/^\/api\/agents\/([0-9a-f-]{36})\/(focus|catch-up|open-folder|stop)$/i);
    if (m) {
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
      if (req.headers['x-agents-token'] !== TOKEN) return send(res, 403, { error: 'Missing or bad token' });
      return await action(res, m[1], m[2]);
    }

    const file = req.method === 'GET' && STATIC[url.pathname];
    if (file) {
      let body = fs.readFileSync(path.join(PUBLIC_DIR, file[0]));
      if (file[0] === 'index.html') body = body.toString('utf8').replace('%%TOKEN%%', TOKEN);
      return send(res, 200, body, file[1]);
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

async function main() {
  if (process.argv.includes('--once')) {
    const snap = await snapshot();
    for (const a of snap.agents) {
      const doing = a.tools?.length ? `${a.tools[0].name}: ${a.tools[0].detail}` : a.waitingFor || '';
      console.log(`${String(a.pid).padEnd(7)} ${a.status.padEnd(8)} ${a.name.padEnd(28)} ${doing}`);
    }
    console.log(`${snap.agents.length} running session(s)`);
    return;
  }
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is in use. Is the dashboard already open? Set PORT to use another one.`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Claude Agents dashboard: ${url}  (Ctrl+C to stop)`);
    if (process.argv.includes('--open')) {
      if (IS_WIN) detached('cmd.exe', ['/c', 'start', '', url]);
      else detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
    }
    if (process.argv.includes('--exit-when-idle')) {
      setInterval(() => !streams.size && Date.now() - lastRequestAt > IDLE_EXIT_MS && process.exit(0), 30000).unref();
    }
  });
}

main();
