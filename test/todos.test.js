'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AGENTS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-agents-test-'));
const todos = require('../lib/todos');

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

test('a to-do is cleaned up and checked', () => {
  const made = todos.create({ title: '  Fix   the   thing ', notes: 'one\r\ntwo\n\n' });
  assert.ok(made.ok);
  assert.equal(made.todo.title, 'Fix the thing');
  assert.equal(made.todo.notes, 'one\ntwo');
  assert.equal(todos.create({ title: '   ' }).ok, false);
  assert.equal(todos.create({ title: 'x'.repeat(201) }).ok, false);
  assert.equal(todos.edit(made.todo.id, { title: '' }).ok, false);
  assert.ok(todos.edit(made.todo.id, { title: 'Fix it', notes: 'n' }).ok);
  assert.equal(todos.find(made.todo.id).title, 'Fix it');
  assert.ok(todos.remove(made.todo.id).ok);
  assert.equal(todos.find(made.todo.id), null);
});

test('a started to-do follows its session until it closes, and comes back on resume', () => {
  const { todo } = todos.create({ title: 'Ship it' });
  const id = todo.id;
  todos.setFolder(id, os.tmpdir());
  todos.started(id, ID1);
  const startedAt = todos.find(id).startedAt;

  assert.equal(todos.pending(startedAt + 1000)[0].starting, true);
  assert.equal(todos.pending(startedAt + 61000)[0].starting, false, 'stops waiting after a minute');

  // The session appears: the to-do moves onto its card.
  let agents = [{ id: ID1, pid: 42, startedAt: 500 }];
  todos.observe(agents, 1000);
  assert.equal(agents[0].todo.title, 'Ship it');
  assert.equal(todos.pending(1000).length, 0);
  assert.ok(todos.isLive(id));

  // /clear gives the same process a new session ID.
  agents = [{ id: ID2, pid: 42, startedAt: 500 }];
  todos.observe(agents, 2000);
  assert.ok(agents[0].todo);
  assert.equal(todos.find(id).sessionId, ID2);

  // The process is gone; another one reusing its PID isn't linked.
  agents = [{ id: '33333333-3333-4333-8333-333333333333', pid: 42, startedAt: 999 }];
  todos.observe(agents, 3000);
  assert.equal(agents[0].todo, undefined);
  assert.equal(todos.find(id).closedAt, 3000);
  assert.equal(todos.isLive(id), false);
  assert.equal(todos.pending(3000).length, 0, 'a closed to-do has no card');

  // Resumed, with the same session ID in a new process.
  agents = [{ id: ID2, pid: 77, startedAt: 4000 }];
  todos.observe(agents, 4000);
  assert.ok(agents[0].todo);
  assert.equal(todos.find(id).closedAt, null);

  // Closed again, and dropped after 30 days.
  todos.observe([], 5000);
  todos.observe([], 5000 + 31 * 24 * 60 * 60 * 1000);
  assert.equal(todos.find(id), null);
});

test('to-dos are saved to disk', () => {
  const { todo } = todos.create({ title: 'Saved' });
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.AGENTS_DATA_DIR, 'todos.json'), 'utf8'));
  assert.ok(saved.todos.some((t) => t.id === todo.id && t.title === 'Saved'));
});
