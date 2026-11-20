'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { draw, png, versionInfo } = require('../scripts/launcher');

const ROOT = path.join(__dirname, '..');

// public/app.js runs only in the browser, so nothing else would catch a
// syntax error in it.
test('every script parses', () => {
  const files = ['server.js', ...['lib', 'public', 'scripts', 'test'].flatMap((dir) =>
    fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)),
  )];
  for (const file of files) execFileSync(process.execPath, ['--check', path.join(ROOT, file)]);
});

test('the rulesets and code owners are well formed', () => {
  const dir = path.join(ROOT, '.github', 'rulesets');
  const rulesets = fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.equal(new Set(rulesets.map((r) => r.name)).size, rulesets.length, 'names are unique, as the setup matches on them');
  const named = (name) => rulesets.find((r) => r.name === name);
  const pr = named('Reviews').rules.find((r) => r.type === 'pull_request').parameters;
  assert.ok(pr.required_approving_review_count >= 1 && pr.require_code_owner_review, 'a code owner has to approve');
  // The admin can skip waiting for CI and reviews when merging a pull request,
  // and nothing else: not the branch rules, not the tags, not direct pushes.
  const adminMerging = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }];
  for (const name of ['CI', 'Reviews']) assert.deepEqual(named(name).bypass_actors, adminMerging, name);
  for (const name of ['Gitflow', "Release tags can't change"]) assert.deepEqual(named(name).bypass_actors, [], name);
  assert.equal(rulesets.length, 4, 'every ruleset is checked above');
  const owners = fs.readFileSync(path.join(ROOT, '.github', 'CODEOWNERS'), 'utf8');
  assert.match(owners, /^\* @[\w-]+/m, 'every file has an owner');
});

test('release notes come from the changelog, with either line ending', () => {
  const { releaseNotes } = require('../scripts/build-release');
  const changelog = '# Changelog\n\n## 0.2.0 - 2026-12-01\n\n- New.\n\n## 0.1.0 - 2026-11-19\n\n- First.\n';
  assert.equal(releaseNotes(changelog, '0.2.0'), '- New.\n');
  assert.equal(releaseNotes(changelog, '0.1.0'), '- First.\n');
  assert.equal(releaseNotes(changelog.replace(/\n/g, '\r\n'), '0.1.0'), '- First.\n');
  assert.throws(() => releaseNotes(changelog, '0.3.0'), /no notes under "## 0\.3\.0"/);
});

test('the launcher icon draws', () => {
  const pixels = draw(16);
  assert.equal(pixels.length, 16 * 16 * 4);
  assert.equal(pixels[3], 0, 'the rounded corner is transparent');
  assert.equal(pixels[(8 * 16 + 8) * 4 + 3], 255, 'the middle is solid');
  assert.deepEqual([...png(16, pixels).subarray(1, 4)], [...Buffer.from('PNG')]);
});

test("the launcher's file details carry the version, in numbers where they have to be", () => {
  const info = versionInfo('0.2.0-beta.1');
  assert.match(info, /AssemblyProduct\("Tabherd"\)/);
  assert.match(info, /AssemblyFileVersion\("0\.2\.0\.0"\)/);
  assert.match(info, /AssemblyInformationalVersion\("0\.2\.0-beta\.1"\)/);
  assert.throws(() => versionInfo('1.0'), /Not a version/);
});
