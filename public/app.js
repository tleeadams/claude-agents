'use strict';

const TOKEN = document.querySelector('meta[name="agents-token"]').content;

const STATUS = {
  waiting: { label: 'Needs you', group: 'needs', rank: 0 },
  busy: { label: 'Working', group: 'working', rank: 1 },
  shell: { label: 'Shell running', group: 'working', rank: 2, hint: 'At the prompt while a background shell task runs' },
  idle: { label: 'Idle', group: 'idle', rank: 3 },
  unknown: { label: 'Starting', group: 'idle', rank: 4 },
};
const PERMISSION_MODES = {
  bypassPermissions: 'bypass',
  acceptEdits: 'accept edits',
  plan: 'plan mode',
  auto: 'auto',
  dontAsk: "don't ask",
};

const $ = (id) => document.getElementById(id);
const list = $('list');
const cards = new Map();
const subsOpen = new Map();
const expanded = new Set();
let filter = 'all';
let snap = null;
let clockSkew = 0;

// ---- helpers ---------------------------------------------------------------

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

const now = () => Date.now() + clockSkew;
const ms = (t) => (typeof t === 'number' ? t : t ? Date.parse(t) : NaN);

function dur(delta) {
  const s = Math.max(0, Math.floor(delta / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function since(t, suffix = '') {
  const at = ms(t);
  if (!Number.isFinite(at)) return null;
  return el('span', { class: 'since', 'data-since': at, 'data-suffix': suffix, title: new Date(at).toLocaleString() }, dur(now() - at) + suffix);
}

function tick() {
  for (const node of document.querySelectorAll('[data-since]')) {
    node.textContent = dur(now() - Number(node.dataset.since)) + node.dataset.suffix;
  }
}

function tokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${n < 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') : Math.round(n / 1e3)}k`;
  return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
}

function modelLabel(a) {
  if (a.modelName) return a.modelName.replace(/ \((1M) context\)$/, ' · $1');
  const m = (a.model || '').match(/^claude-([a-z]+)-(\d+)-(\d+)/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : a.model;
}

function shortPath(p) {
  if (!p) return '';
  const home = snap?.home || repoData?.home;
  return home && p.toLowerCase().startsWith(home.toLowerCase()) ? `~${p.slice(home.length)}` : p;
}

const status = (a) => STATUS[a.status] || STATUS.unknown;
// What the terminal tab shows, falling back to Claude's own names.
const displayName = (a) => a.terminalTitle || a.title || a.name;
const resumeCommand = (a) => `cd "${a.cwd}"; claude --resume ${a.id}`;

function toast(message, isError) {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), isError ? 5000 : 2200);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el('textarea', { readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

async function api(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Agents-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const post = (agent, action) => api(`/api/agents/${agent.id}/${action}`);

const canFocus = (a) => snap?.platform === 'win32' && (!a.kind || a.kind === 'interactive');

async function goToWindow(a, button) {
  if (button) button.disabled = true;
  try {
    const r = await post(a, 'focus');
    if (r.terminal && !r.tab) toast(`Opened ${r.window}, but couldn't tell which tab is ${displayName(a)}`, true);
    else if (!r.raised) toast(`Found ${r.terminal ? 'the tab' : r.window}, but Windows kept it in the background. Check the taskbar.`, true);
    else toast(r.terminal ? `Switched to ${displayName(a)}` : `Opened ${r.window}`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function catchUp(a, button) {
  button.disabled = true;
  try {
    const r = await post(a, 'catch-up');
    const where = r.raised ? '' : ' Its window stayed in the background.';
    toast(
      a.status === 'busy'
        ? `Queued for ${displayName(a)}. It will answer after its current step.${where}`
        : `Asked ${displayName(a)} to catch you up.${where}`,
    );
    refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
  }
}

// ---- card ------------------------------------------------------------------

function message(a, key, label, m, cls) {
  const id = `${a.id}:${key}`;
  return el(
    'div',
    { class: `msg ${cls || ''}${expanded.has(id) ? ' expanded' : ''}` },
    el('span', { class: 'label' }, `${label} · `, since(m.at, ' ago')),
    el('p', {
      class: 'text',
      text: m.text,
      tabindex: '0',
      title: 'Click to expand',
      onclick: (e) => {
        const box = e.currentTarget.parentElement;
        box.classList.toggle('expanded');
        if (box.classList.contains('expanded')) expanded.add(id);
        else expanded.delete(id);
      },
      onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), e.currentTarget.click()),
    }),
  );
}

function nowBlock(a) {
  const rows = [];
  if (a.status === 'waiting') {
    rows.push(el('div', { class: 'now-row' }, el('span', { class: 'what', text: 'Waiting on you' }), el('span', { class: 'detail', text: a.waitingFor || '' })));
  }
  for (const t of a.tools || []) {
    rows.push(el('div', { class: 'now-row' }, el('span', { class: 'what', text: t.name }), el('span', { class: 'detail', text: t.detail, title: t.detail }), since(t.at)));
  }
  const runningSubs = a.subagents?.running.length || 0;
  if (a.status === 'busy' && !a.tools?.length) {
    const what = runningSubs ? 'Waiting on subagents' : 'Thinking';
    const detail = runningSubs ? `${runningSubs} running` : '';
    rows.push(el('div', { class: 'now-row' }, el('span', { class: 'what', text: what }), el('span', { class: 'detail', text: detail }), since(a.lastEventAt)));
  }
  if (a.status === 'shell' && !a.tools?.length) {
    rows.push(el('div', { class: 'now-row' }, el('span', { class: 'what', text: 'Background shell' }), el('span', { class: 'detail', text: 'running while the session waits at the prompt' })));
  }
  if (a.detail) rows.push(el('div', { class: 'now-row' }, el('span', { class: 'detail', text: a.detail })));
  return rows.length ? el('div', { class: `now${a.status === 'waiting' ? ' waiting' : ''}` }, rows) : null;
}

function activity(a) {
  const promptAt = ms(a.lastPrompt?.at) || 0;
  const parts = [nowBlock(a)];
  const replyFresh = a.lastReply && ms(a.lastReply.at) >= promptAt;
  const recapFresh = a.recap && ms(a.recap.at) >= Math.max(promptAt, replyFresh ? ms(a.lastReply.at) : 0);
  if (recapFresh && a.status !== 'busy') parts.push(message(a, 'recap', 'Recap', a.recap));
  else if (replyFresh) parts.push(message(a, 'reply', a.status === 'busy' ? 'Latest update' : 'Last reply', a.lastReply));
  if (a.lastPrompt) parts.push(message(a, 'prompt', 'Last prompt', a.lastPrompt, 'prompt'));
  return el('div', { class: 'activity' }, parts);
}

function stats(a) {
  const items = [];
  if (a.model) items.push(el('span', { class: 'model', text: modelLabel(a), title: a.model }));
  if (a.contextTokens) {
    const pct = Math.min(100, (a.contextTokens / a.contextLimit) * 100);
    const fill = el('i');
    fill.style.width = `${pct.toFixed(1)}%`;
    items.push(
      el(
        'span',
        { class: 'ctx', title: `Context: ${a.contextTokens.toLocaleString()} of ${a.contextLimit.toLocaleString()} tokens` },
        el('span', { class: `bar${pct > 85 ? ' high' : pct > 60 ? ' mid' : ''}` }, fill),
        `${tokens(a.contextTokens)} / ${tokens(a.contextLimit)} context`,
      ),
    );
  }
  if (a.outputTokens) items.push(el('span', { title: 'Output tokens generated this session', text: `${tokens(a.outputTokens)} out` }));
  if (a.prompts) items.push(el('span', { text: `${a.prompts} prompt${a.prompts === 1 ? '' : 's'}` }));
  if (a.compactions) items.push(el('span', { text: `${a.compactions} compaction${a.compactions === 1 ? '' : 's'}` }));
  return items.length ? el('div', { class: 'stats' }, items) : null;
}

function subagents(a) {
  const s = a.subagents;
  if (!s || (!s.running.length && !s.finishedTotal)) return null;
  const open = subsOpen.has(a.id) ? subsOpen.get(a.id) : s.running.length > 0;
  const summary = [`Subagents · ${s.running.length} running`];
  if (s.finishedTotal) summary.push(` · ${s.finishedTotal} finished`);
  const rows = [
    ...s.running.map((sub) => {
      const tool = sub.tools[sub.tools.length - 1];
      return el(
        'li',
        { class: 'sub running' },
        el('span', { class: 'dot' }),
        el('span', { class: 'type', text: sub.type }),
        el('span', { class: 'desc', text: sub.description, title: sub.description }),
        since(sub.startedAt),
        el('span', { class: 'tool', text: tool ? `${tool.name} · ${tool.detail}` : sub.lastReply?.text || 'Thinking…' }),
      );
    }),
    ...s.finished.map((sub) =>
      el(
        'li',
        { class: `sub ${sub.status}`, title: sub.status === 'done' ? 'Finished' : 'Ended without finishing' },
        el('span', { class: 'dot' }),
        el('span', { class: 'type', text: sub.type }),
        el('span', { class: 'desc', text: sub.description, title: sub.description }),
        since(sub.updatedAt, ' ago'),
      ),
    ),
  ];
  const more = s.finishedTotal - s.finished.length;
  return el(
    'details',
    {
      class: 'subs',
      open,
      ontoggle: (e) => subsOpen.set(a.id, e.currentTarget.open),
    },
    el('summary', {}, summary.join('')),
    el('ul', {}, rows),
    more > 0 ? el('p', { class: 'more', text: `and ${more} more finished` }) : null,
  );
}

function actions(a) {
  const btn = (label, onclick, cls = '', props = {}) => el('button', { type: 'button', class: `btn ${cls}`, onclick, ...props }, label);
  const waiting = a.status === 'waiting';
  return el(
    'div',
    { class: 'actions' },
    canFocus(a) ? btn('Go to window', (e) => goToWindow(a, e.currentTarget), 'btn-primary') : null,
    canFocus(a)
      ? btn('Catch up', (e) => catchUp(a, e.currentTarget), 'btn-accent', {
          disabled: waiting,
          title: waiting
            ? 'Waiting on a prompt or dialog. Answer it with Go to window first.'
            : 'Go to the window and ask where things stand',
        })
      : null,
    btn('Open folder', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await post(a, 'open-folder');
        toast(`Opened ${shortPath(a.cwd)}`);
      } catch (err) {
        toast(err.message, true);
      } finally {
        b.disabled = false;
      }
    }),
    btn('Copy resume command', async () => {
      await copy(resumeCommand(a));
      toast('Resume command copied');
    }),
    btn('Stop…', () => confirmStop(a), 'btn-stop'),
  );
}

function card(a) {
  const st = status(a);
  const tags = [];
  if (a.gitBranch) tags.push(el('span', { class: 'tag', title: 'Git branch', text: `⎇ ${a.gitBranch}` }));
  if (a.kind && a.kind !== 'interactive') tags.push(el('span', { class: 'tag', text: a.kind }));
  if (a.entrypoint && a.entrypoint !== 'cli') tags.push(el('span', { class: 'tag', text: a.entrypoint }));
  const perm = PERMISSION_MODES[a.permissionMode];
  if (perm) tags.push(el('span', { class: 'tag', title: `Permission mode: ${a.permissionMode}`, text: perm }));
  if (a.version) tags.push(el('span', { text: `v${a.version}` }));

  const heading = displayName(a);
  const subtitle = a.title && a.title.toLowerCase() !== heading.toLowerCase() ? a.title : null;
  const proc = [a.name, `PID ${a.pid}`];
  if (a.memBytes) proc.push(`${Math.round(a.memBytes / 1048576)} MB`);

  return el(
    'article',
    { class: `card s-${a.status}`, 'data-id': a.id },
    el(
      'div',
      { class: 'card-head' },
      el('span', { class: `badge s-${a.status}`, title: st.hint }, el('span', { class: 'dot' }), st.label),
      since(a.statusSince),
      el('span', { class: 'spacer' }),
      el('span', { class: 'proc', title: `Session ${a.id}\nStarted ${new Date(a.startedAt).toLocaleString()}`, text: proc.join(' · ') }),
    ),
    el(
      'h2',
      { class: 'name' },
      canFocus(a)
        ? el('button', { type: 'button', class: 'name-link', title: 'Go to this session’s window', onclick: (e) => goToWindow(a, e.currentTarget) }, heading)
        : heading,
    ),
    subtitle ? el('p', { class: 'title', text: subtitle }) : null,
    el('div', { class: 'where' }, el('span', { class: 'path', title: a.cwd, text: shortPath(a.cwd) }), tags),
    activity(a),
    stats(a),
    subagents(a),
    a.prs?.length
      ? el(
          'div',
          { class: 'prs' },
          a.prs.map((pr) => el('a', { href: pr.url, target: '_blank', rel: 'noopener noreferrer', text: `${pr.repo || 'PR'}#${pr.number}` })),
        )
      : null,
    actions(a),
  );
}

// ---- page ------------------------------------------------------------------

function render() {
  if (!snap) return;
  const agents = [...snap.agents].sort((x, y) => status(x).rank - status(y).rank || x.startedAt - y.startedAt);
  const counts = { all: agents.length, needs: 0, working: 0, idle: 0 };
  for (const a of agents) counts[status(a).group]++;
  for (const [k, v] of Object.entries(counts)) $(`n-${k}`).textContent = v;
  document.querySelector('[data-filter="needs"]').classList.toggle('has', counts.needs > 0);
  document.title = counts.needs ? `(${counts.needs}) Claude Agents` : 'Claude Agents';
  $('host').textContent = snap.host;

  const shown = agents.filter((a) => filter === 'all' || status(a).group === filter);
  const seen = new Set();
  shown.forEach((a, i) => {
    seen.add(a.id);
    const key = JSON.stringify(a) + subsOpen.get(a.id);
    let entry = cards.get(a.id);
    if (!entry || entry.key !== key) {
      const node = card(a);
      if (entry) entry.node.replaceWith(node);
      entry = { key, node };
      cards.set(a.id, entry);
    }
    if (list.children[i] !== entry.node) list.insertBefore(entry.node, list.children[i] || null);
  });
  for (const [id, entry] of cards) {
    if (!seen.has(id)) {
      entry.node.remove();
      cards.delete(id);
    }
  }
  $('empty').hidden = agents.length > 0;
  if (!agents.length) $('empty').querySelector('.empty-title').textContent = 'No Claude Code sessions are running.';
  else if (!shown.length) {
    $('empty').hidden = false;
    $('empty').querySelector('.empty-title').textContent = 'No sessions match this filter.';
  }
}

// ---- updates and dings ---------------------------------------------------------

const SOUND_KEY = 'claude-agents:sound';
const DING_GAP_MS = 2000;
let soundOn = true;
try {
  soundOn = localStorage.getItem(SOUND_KEY) !== 'off';
} catch {}
let audio = null;
let lastDingAt = 0;
let lastStatus = null;

function audioContext() {
  if (!audio) {
    try {
      audio = new AudioContext();
      audio.addEventListener('statechange', updateSoundButton);
    } catch {
      return null;
    }
  }
  return audio;
}

function tone(ctx, freq, start, length, peak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

const SOUNDS = {
  // Two rising notes: your turn.
  needs: (ctx, t) => {
    tone(ctx, 784, t, 0.35, 0.22);
    tone(ctx, 1175, t + 0.16, 0.55, 0.22);
  },
  // One soft bell: something finished.
  done: (ctx, t) => {
    tone(ctx, 1047, t, 0.9, 0.16);
    tone(ctx, 2890, t, 0.25, 0.025);
  },
};

function ding(kind) {
  const ctx = audioContext();
  if (!soundOn || !ctx || ctx.state !== 'running') return;
  SOUNDS[kind](ctx, ctx.currentTime + 0.02);
}

function updateSoundButton() {
  const blocked = soundOn && audio?.state !== 'running';
  const button = $('sound');
  button.classList.toggle('off', !soundOn);
  button.classList.toggle('blocked', blocked);
  button.setAttribute('aria-pressed', String(soundOn));
  $('sound-label').textContent = blocked ? 'Click to enable sound' : '';
  button.title = !soundOn
    ? 'Sound is off. Click to ding when an agent needs you or finishes.'
    : blocked
      ? 'The browser blocks sound until you click the page'
      : 'Dings when an agent needs you or finishes. Click to mute.';
}

// Browsers only let a page play sound after it has been clicked or typed in.
function unlockAudio() {
  const ctx = audioContext();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

// Waiting on you, or done with a turn: Working to Idle, or to waiting at the
// prompt beside a background shell.
function notableChanges(agents) {
  const needs = [];
  const done = [];
  if (lastStatus) {
    for (const a of agents) {
      const before = lastStatus.get(a.id);
      if (before === undefined || before === a.status) continue;
      if (a.status === 'waiting') needs.push(a);
      else if (before === 'busy' && (a.status === 'idle' || a.status === 'shell')) done.push(a);
    }
  }
  lastStatus = new Map(agents.map((a) => [a.id, a.status]));
  return { needs, done };
}

function announce({ needs, done }) {
  if (!needs.length && !done.length) return;
  for (const a of [...needs, ...done]) {
    const node = cards.get(a.id)?.node;
    if (!node) continue;
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }
  const names = (list) => (list.length === 1 ? displayName(list[0]) : `${list.length} agents`);
  if (needs.length) toast(`${names(needs)} ${needs.length === 1 ? 'needs' : 'need'} you${needs.length === 1 && needs[0].waitingFor ? `: ${needs[0].waitingFor}` : ''}`);
  else toast(`${names(done)} finished`);
  if (Date.now() - lastDingAt < DING_GAP_MS) return;
  lastDingAt = Date.now();
  ding(needs.length ? 'needs' : 'done');
}

function apply(next) {
  snap = next;
  clockSkew = snap.now - Date.now();
  $('conn').className = 'conn live';
  $('updated').textContent = `Live · ${new Date(snap.now).toLocaleTimeString()}`;
  list.classList.remove('stale');
  const changes = notableChanges(snap.agents);
  render();
  announce(changes);
}

function disconnected() {
  $('conn').className = 'conn down';
  $('updated').textContent = 'Disconnected. Is the server running?';
  list.classList.add('stale');
}

// A one-off update, so an action's effect shows without waiting for a push.
async function refresh() {
  try {
    const res = await fetch('/api/agents', { cache: 'no-store' });
    if (res.ok) apply(await res.json());
  } catch {}
}

function connect() {
  const source = new EventSource('/api/stream');
  source.onmessage = (e) => apply(JSON.parse(e.data));
  // EventSource reconnects by itself.
  source.onerror = disconnected;
}

function confirmStop(a) {
  const dialog = $('confirm');
  $('confirm-name').textContent = displayName(a);
  $('confirm-pid').textContent = a.pid;
  $('confirm-resume').textContent = resumeCommand(a);
  dialog.returnValue = '';
  dialog.onclose = async () => {
    if (dialog.returnValue !== 'stop') return;
    try {
      await post(a, 'stop');
      toast(`Stopped ${displayName(a)}`);
    } catch (err) {
      toast(err.message, true);
    }
    refresh();
  };
  dialog.showModal();
}

// ---- repo menu ---------------------------------------------------------------

const OPEN_FOLDERS_KEY = 'claude-agents:open-folders';
let repoData = null;
let openFolders = new Set();
try {
  openFolders = new Set(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) || '[]'));
} catch {}

function saveOpenFolders() {
  try {
    localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify([...openFolders]));
  } catch {}
}

function filterTerms() {
  return $('repos-filter').value.toLowerCase().split(/\s+/).filter(Boolean);
}

// How many running sessions have their folder in this repo.
function sessionsIn(repoPath) {
  const dir = `${repoData.root}\\${repoPath.replace(/\//g, '\\')}`.toLowerCase();
  return (snap?.agents || []).filter((a) => {
    const cwd = (a.cwd || '').toLowerCase();
    return cwd === dir || cwd.startsWith(`${dir}\\`);
  }).length;
}

// Every word must be in the repo's path and at least one in its own name, so
// "acme" finds the acme repos rather than everything under the Acme folder,
// while "api auth" still finds Api-Repos/_wt/auth.
function repoMatches(node, terms) {
  const p = node.path.toLowerCase();
  const name = node.name.toLowerCase();
  return terms.every((t) => p.includes(t)) && terms.some((t) => name.includes(t));
}

function repoItem(node, terms) {
  if (terms.length && !repoMatches(node, terms)) return null;
  const live = sessionsIn(node.path);
  return el(
    'li',
    {},
    el(
      'button',
      { type: 'button', class: 'repo', title: `Open Claude in ${node.path}`, onclick: (e) => openRepo(node, e.currentTarget) },
      el('span', { class: 'repo-name', text: node.name }),
      live
        ? el('span', { class: 'repo-live', title: `${live} Claude session${live === 1 ? '' : 's'} running here` }, el('span', { class: 'dot' }), String(live))
        : null,
    ),
  );
}

function folderItem(node, terms) {
  const list = treeList(node.children, terms);
  if (!list) return null;
  return el(
    'li',
    {},
    el(
      'details',
      {
        // While filtering, every folder with a match is open.
        open: terms.length > 0 || openFolders.has(node.path),
        ontoggle: (e) => {
          if (filterTerms().length) return;
          if (e.currentTarget.open) openFolders.add(node.path);
          else openFolders.delete(node.path);
          saveOpenFolders();
        },
      },
      el(
        'summary',
        {},
        el('span', { class: 'chev' }),
        el('span', { class: 'folder-name', text: node.name }),
        el('span', { class: 'folder-count', text: String(list.querySelectorAll('.repo').length) }),
      ),
      list,
    ),
  );
}

function treeList(nodes, terms) {
  const items = nodes.map((n) => (n.repo ? repoItem(n, terms) : folderItem(n, terms))).filter(Boolean);
  return items.length ? el('ul', {}, items) : null;
}

function renderRepos() {
  if (!repoData) return;
  const terms = filterTerms();
  const list = treeList(repoData.tree, terms);
  $('repos-tree').replaceChildren(list || el('p', { class: 'tree-empty', text: terms.length ? 'No repos match.' : 'No git repos found.' }));
}

async function loadRepos(refresh) {
  try {
    const res = await fetch(`/api/repos${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Couldn't list repos (HTTP ${res.status})`);
    repoData = await res.json();
    $('repos-root').textContent = `${shortPath(repoData.root)} · ${repoData.count} repos`;
    $('repos-command').textContent = repoData.command;
    renderRepos();
  } catch (err) {
    toast(err.message, true);
  }
}

async function openRepo(node, button) {
  button.disabled = true;
  try {
    await api('/api/repos/open', { path: node.path });
    $('repos').close();
    toast(`Opening Claude in ${node.name}`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
  }
}

$('menu-button').addEventListener('click', () => {
  $('repos').showModal();
  $('repos-filter').focus();
  loadRepos(false);
});
$('repos-close').addEventListener('click', () => $('repos').close());
$('repos-refresh').addEventListener('click', () => loadRepos(true));
$('repos-filter').addEventListener('input', renderRepos);
$('repos-filter').addEventListener('keydown', (e) => {
  // Enter opens the repo when the filter leaves exactly one.
  const matches = $('repos-tree').querySelectorAll('.repo');
  if (e.key === 'Enter' && filterTerms().length && matches.length === 1) matches[0].click();
});
// A click on the backdrop lands on the dialog itself.
$('repos').addEventListener('click', (e) => e.target === e.currentTarget && e.currentTarget.close());
// #repos opens the menu; #repos/<filter> also fills in the filter.
const repoLink = location.hash.match(/^#repos(?:\/(.*))?$/);
if (repoLink) {
  $('repos-filter').value = decodeURIComponent(repoLink[1] || '');
  $('menu-button').click();
}

for (const b of document.querySelectorAll('[data-filter]')) {
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    for (const o of document.querySelectorAll('[data-filter]')) o.setAttribute('aria-pressed', String(o === b));
    render();
  });
}
$('sound').addEventListener('click', () => {
  const ctx = audioContext();
  // While sound is blocked, the first click only unblocks it.
  if (!(soundOn && ctx && ctx.state !== 'running')) {
    soundOn = !soundOn;
    try {
      localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
    } catch {}
  }
  const preview = () => {
    updateSoundButton();
    ding('done');
  };
  if (ctx && ctx.state !== 'running') ctx.resume().then(preview, preview);
  else preview();
});
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);
audioContext();
updateSoundButton();
setInterval(tick, 1000);
connect();
