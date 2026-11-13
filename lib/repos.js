'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE_DIR = process.env.REPOS_DIR || path.join(os.homedir(), 'source');
const MAX_DEPTH = 6;
const CACHE_MS = 60000;
const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'bin', 'obj', 'target', 'venv', '__pycache__']);

let cache = null;
let cachedAt = 0;

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

// A folder with a .git entry (a directory, or a file for worktrees) is a repo.
// Repos are leaves: nothing inside one is searched.
function walk(dir, rel, depth, paths) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  if (rel && entries.some((e) => e.name === '.git')) {
    paths.add(rel);
    return { name: path.basename(dir), path: rel, repo: true };
  }
  if (depth >= MAX_DEPTH) return null;
  const folders = [];
  const repos = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const child = walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1, paths);
    if (child) (child.repo ? repos : folders).push(child);
  }
  if (!folders.length && !repos.length) return null;
  return { name: path.basename(dir), path: rel, children: [...folders.sort(byName), ...repos.sort(byName)] };
}

function scanRepos(force) {
  if (!force && cache && Date.now() - cachedAt < CACHE_MS) return cache;
  const paths = new Set();
  const tree = walk(SOURCE_DIR, '', 0, paths);
  cache = { root: SOURCE_DIR, tree: tree?.children || [], count: paths.size, paths };
  cachedAt = Date.now();
  return cache;
}

// Only folders the scan found can be opened, never an arbitrary path.
function resolveRepo(rel) {
  const { paths } = scanRepos(false);
  return typeof rel === 'string' && paths.has(rel) ? path.join(SOURCE_DIR, ...rel.split('/')) : null;
}

module.exports = { scanRepos, resolveRepo };
