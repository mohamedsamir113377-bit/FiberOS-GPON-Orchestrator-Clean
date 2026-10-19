import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

test('performance-capacity: package contract and source syntax', () => {
  assert.match(metadata.name || '', /^@fiberos\//, 'workspace package must use @fiberos namespace');
  const main = path.resolve(ROOT, metadata.main || 'src/index.js');
  assert.equal(fs.existsSync(main), true, `declared main file is missing: ${main}`);

  for (const file of walk(path.join(ROOT, 'src'))) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
});
