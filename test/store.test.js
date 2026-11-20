'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TABHERD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tabherd-test-'));
const { dataDir } = require('../lib/store');

test('the data folder from before the rename moves to ~/.tabherd', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tabherd-home-'));
  fs.mkdirSync(path.join(home, '.claude-agents'));
  fs.writeFileSync(path.join(home, '.claude-agents', 'todos.json'), '{"todos":[]}\n');

  assert.equal(dataDir(home, {}), path.join(home, '.tabherd'));
  assert.ok(fs.existsSync(path.join(home, '.tabherd', 'todos.json')), 'its files came along');
  assert.ok(!fs.existsSync(path.join(home, '.claude-agents')));

  // Once moved, it stays put, and an old folder made since is left alone.
  fs.mkdirSync(path.join(home, '.claude-agents'));
  assert.equal(dataDir(home, {}), path.join(home, '.tabherd'));
  assert.ok(fs.existsSync(path.join(home, '.claude-agents')));
});

test('a new install uses ~/.tabherd, and TABHERD_DATA_DIR wins', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tabherd-home-'));
  assert.equal(dataDir(home, {}), path.join(home, '.tabherd'));
  assert.ok(!fs.existsSync(path.join(home, '.tabherd')), "it's made on the first save, not before");
  assert.equal(dataDir(home, { TABHERD_DATA_DIR: '/elsewhere' }), '/elsewhere');
});
