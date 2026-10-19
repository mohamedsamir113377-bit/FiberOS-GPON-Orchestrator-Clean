'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('sync: package contract and source syntax', () => {
  assert.match(metadata.name || '', /^@fiberos\//, 'workspace package must use @fiberos namespace');
  const main = path.resolve(ROOT, metadata.main || 'src/index.js');
  assert.equal(fs.existsSync(main), true, `declared main file is missing: ${main}`);

  for (const file of walk(path.join(ROOT, 'src'))) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
});
