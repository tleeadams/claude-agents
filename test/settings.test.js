'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TABHERD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tabherd-test-'));
const settings = require('../lib/settings');

test('defaults are safe', () => {
  assert.deepEqual(settings.get(), { skipPermissions: false, excludedFolders: [], todoFolderSource: 'repos', todoStartFolder: '' });
});

test('each setting is checked', () => {
  assert.equal(settings.update({ skipPermissions: true }).settings.skipPermissions, true);
  assert.equal(settings.update({ skipPermissions: 'yes' }).ok, false);
  assert.equal(settings.update({ todoFolderSource: 'picker' }).settings.todoFolderSource, 'picker');
  assert.equal(settings.update({ todoFolderSource: 'anything' }).ok, false);
  assert.deepEqual(settings.update({ excludedFolders: ['a\\b', 'A/B/', 'c'] }).settings.excludedFolders, ['a/b', 'c']);
  assert.equal(settings.update({ excludedFolders: ['../up'] }).ok, false);
  assert.equal(settings.update({ ['__proto__']: 1 }).ok, false);
});

test('the to-do start folder must exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabherd-start-'));
  assert.equal(settings.update({ todoStartFolder: dir }).settings.todoStartFolder, path.resolve(dir));
  assert.equal(settings.update({ todoStartFolder: '~' }).settings.todoStartFolder, path.resolve(os.homedir()));
  assert.equal(settings.update({ todoStartFolder: '  ' }).settings.todoStartFolder, '');
  assert.equal(settings.update({ todoStartFolder: 'relative/path' }).ok, false);
  assert.equal(settings.update({ todoStartFolder: path.join(dir, 'missing') }).ok, false);
});

test('changes are all or none, and saved', () => {
  const before = settings.get();
  assert.equal(settings.update({ skipPermissions: !before.skipPermissions, todoFolderSource: 'nope' }).ok, false);
  assert.deepEqual(settings.get(), before);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.TABHERD_DATA_DIR, 'settings.json'), 'utf8'));
  assert.deepEqual(saved, before);
});
