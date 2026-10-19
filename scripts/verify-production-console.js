#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INCLUDE = [path.join(ROOT, 'packages'), path.join(ROOT, 'services'), path.join(ROOT, 'apps')];
const EXCLUDED_DIRS = new Set(['test', 'tests', 'vendor', 'node_modules', '.git']);
const EXT = new Set(['.js', '.cjs', '.mjs']);
const pattern = /\bconsole\.(log|error|warn|info|debug|dir|trace|table|group|groupCollapsed|groupEnd|time|timeEnd|assert)\s*\(/;
const findings = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && EXT.has(path.extname(entry.name))) {
      const text = fs.readFileSync(full, 'utf8');
      text.split(/\r?\n/).forEach((line, i) => {
        if (pattern.test(line)) findings.push({ file: path.relative(ROOT, full), line: i + 1 });
      });
    }
  }
}

for (const dir of INCLUDE) walk(dir);
if (findings.length) {
  for (const f of findings) console.error(`PRODUCTION_CONSOLE_FAIL: ${f.file}:${f.line}`);
  process.exit(1);
}
console.log('PRODUCTION_CONSOLE PASS: no first-party console.* calls outside excluded test/vendor trees.');
