'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A repos folder: work/one and work/two (a worktree, whose .git is a file),
// home/three, a folder with no repos, and a repo inside node_modules.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-agents-repos-'));
for (const dir of ['work/one/.git', 'home/three/.git', 'empty/nothing', 'work/node_modules/dep/.git']) {
  fs.mkdirSync(path.join(ROOT, ...dir.split('/')), { recursive: true });
}
fs.mkdirSync(path.join(ROOT, 'work', 'two'));
fs.writeFileSync(path.join(ROOT, 'work', 'two', '.git'), 'gitdir: elsewhere\n');

process.env.REPOS_DIR = ROOT;
process.env.AGENTS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-agents-test-'));
const { scanRepos, resolveRepo } = require('../lib/repos');
const settings = require('../lib/settings');

const paths = (nodes) => nodes.flatMap((n) => [n.path, ...(n.children ? paths(n.children) : [])]);

test('finds repos and worktrees as a tree, skipping empty and dependency folders', () => {
  const scan = scanRepos(true);
  assert.equal(scan.count, 3);
  assert.deepEqual(paths(scan.tree), ['home', 'home/three', 'work', 'work/one', 'work/two']);
  assert.equal(resolveRepo('work/one'), path.join(ROOT, 'work', 'one'));
  assert.equal(resolveRepo('work'), null, 'a folder is not a repo');
  assert.equal(resolveRepo('../outside'), null);
});

test('hidden folders leave the menu but stay in the full tree', () => {
  settings.update({ excludedFolders: ['WORK/one', 'home'] });
  const scan = scanRepos(false);
  assert.equal(scan.count, 1);
  assert.deepEqual(paths(scan.tree), ['work', 'work/two']);
  assert.deepEqual(paths(scan.all), ['home', 'home/three', 'work', 'work/one', 'work/two']);
  assert.equal(resolveRepo('work/one'), null, 'a hidden repo cannot be opened');
  assert.equal(resolveRepo('work/two'), path.join(ROOT, 'work', 'two'));
});
