'use strict';

const crypto = require('crypto');
const store = require('./store');

// To-dos: a title and notes, then a folder, then a Claude session started
// there with --session-id, so the server knows which session it became. Saved
// as todos.json.
const MAX_TODOS = 200;
const MAX_TITLE = 200;
const MAX_NOTES = 20000;
// How long a started to-do waits for its session before offering Start again.
const START_WAIT_MS = 60 * 1000;
// A to-do whose session closed is kept this long, hidden, in case the session
// is resumed and the to-do comes back with it.
const KEEP_CLOSED_MS = 30 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let todos = load();

function load() {
  const saved = store.read('todos', null);
  const list = Array.isArray(saved?.todos) ? saved.todos : [];
  return list.filter((t) => t && UUID.test(t.id) && typeof t.title === 'string' && typeof t.notes === 'string');
}

// Writes first and only then keeps the change, so a failed write changes nothing.
function commit(next) {
  try {
    store.write('todos', { todos: next });
  } catch (err) {
    return { ok: false, error: `Couldn't save the to-dos: ${err.message}` };
  }
  todos = next;
  return { ok: true };
}

function cleanText(body) {
  const title = typeof body?.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
  const notes = typeof body?.notes === 'string' ? body.notes.replace(/\r\n?/g, '\n').trimEnd() : '';
  if (!title) return { error: 'A to-do needs a title.' };
  if (title.length > MAX_TITLE) return { error: `Keep the title under ${MAX_TITLE} characters.` };
  if (notes.length > MAX_NOTES) return { error: `Keep the notes under ${MAX_NOTES.toLocaleString('en')} characters.` };
  return { title, notes };
}

const find = (id) => todos.find((t) => t.id === id) || null;

// Changes one to-do and saves.
function change(id, fields) {
  return commit(todos.map((t) => (t.id === id ? { ...t, ...fields } : t)));
}

function create(body) {
  const text = cleanText(body);
  if (text.error) return { ok: false, error: text.error };
  if (todos.length >= MAX_TODOS) return { ok: false, error: `There are already ${MAX_TODOS} to-dos.` };
  const now = Date.now();
  const todo = {
    id: crypto.randomUUID(),
    ...text,
    createdAt: now,
    updatedAt: now,
    cwd: null,
    sessionId: null,
    startedAt: null,
    // The session's process once it's been seen, which keeps the link if the
    // session ID changes, as /clear does.
    pid: null,
    agentStartedAt: null,
    // How many prompts the session has had, so a session closed unused can
    // give its to-do back.
    prompts: 0,
    closedAt: null,
  };
  const result = commit([...todos, todo]);
  return result.ok ? { ok: true, todo } : result;
}

function edit(id, body) {
  const text = cleanText(body);
  if (text.error) return { ok: false, error: text.error };
  return change(id, { ...text, updatedAt: Date.now() });
}

const remove = (id) => commit(todos.filter((t) => t.id !== id));
const setFolder = (id, cwd) => change(id, { cwd });
const started = (id, sessionId) => change(id, { sessionId, startedAt: Date.now() });
// Linked to a session that's running now.
function isLive(id) {
  const t = find(id);
  return Boolean(t?.pid && !t.closedAt);
}

// Called with each snapshot. Links a started to-do to its session and puts the
// to-do on that session's card. Once the session closes, the to-do is hidden,
// unless the session closed before it was asked anything. Claude keeps no
// conversation for that, so there's nothing to resume, and the to-do goes back
// to its own card to be started again.
function observe(agents, now) {
  let changed = false;
  const next = [];
  for (const t of todos) {
    if (t.closedAt && now - t.closedAt > KEEP_CLOSED_MS) {
      changed = true;
      continue;
    }
    const a = t.sessionId
      ? agents.find((x) => x.id === t.sessionId || (t.pid && x.pid === t.pid && x.startedAt === t.agentStartedAt))
      : null;
    if (a) {
      a.todo = { id: t.id, title: t.title, notes: t.notes, createdAt: t.createdAt };
      const prompts = a.prompts || 0;
      if (t.pid !== a.pid || t.agentStartedAt !== a.startedAt || t.sessionId !== a.id || t.closedAt || t.prompts !== prompts) {
        next.push({ ...t, pid: a.pid, agentStartedAt: a.startedAt, sessionId: a.id, prompts, closedAt: null });
        changed = true;
        continue;
      }
    } else if (t.pid && !t.closedAt) {
      const unused = { ...t, sessionId: null, startedAt: null, pid: null, agentStartedAt: null, prompts: 0 };
      next.push(t.prompts ? { ...t, closedAt: now } : unused);
      changed = true;
      continue;
    }
    next.push(t);
  }
  if (changed) commit(next);
}

// The to-dos that get their own cards: those not started yet, or started but
// not yet seen as a session.
function pending(now) {
  return todos
    .filter((t) => !t.pid)
    .map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      cwd: t.cwd,
      startedAt: t.startedAt,
      starting: Boolean(t.startedAt && now - t.startedAt < START_WAIT_MS),
    }));
}

module.exports = { find, create, edit, remove, setFolder, started, isLive, observe, pending };
