#!/usr/bin/env node
'use strict';

/**
 * Static JavaScript syntax gate.
 * This catches malformed or orphaned source files that the runtime test glob
 * may not import directly.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const result = cp.spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
      if (result.status !== 0) {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        failures.push({ file: rel, detail: (result.stderr || result.stdout || 'syntax check failed').trim() });
      }
    }
  }
}

walk(ROOT);

if (failures.length) {
  console.error(`JavaScript syntax gate FAILED (${failures.length} file(s)):`);
  for (const failure of failures) {
    console.error(`\n--- ${failure.file} ---\n${failure.detail}`);
  }
  process.exit(1);
}

console.log('JavaScript syntax gate passed.');
