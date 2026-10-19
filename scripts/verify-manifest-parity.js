#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'SALES_PACKAGE_MANIFEST.json');
const SELF_MARKER = 'SELF_REFERENTIAL_NOT_HASHED';
const DELIVERY_SCOPE = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/delivery-scope-policy.json'), 'utf8'));
const DELIVERY_ARCHIVE_RE = new RegExp(DELIVERY_SCOPE.sourceExclusions.rootFileRegex);

function isExcluded(rel) {
  const parts = rel.split('/');
  if (parts.some(part => DELIVERY_SCOPE.sourceExclusions.directoryNames.includes(part))) return true;
  if (DELIVERY_SCOPE.sourceExclusions.rootDirectories.some(dir => rel === dir || rel.startsWith(dir + '/'))) return true;
  if (parts.length === 1 && DELIVERY_ARCHIVE_RE.test(rel)) return true;
  return DELIVERY_SCOPE.sourceExclusions.files.includes(rel);
}
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (entry.isDirectory()) { if (!isExcluded(rel)) walk(full, out); }
    else if (entry.isFile() && !isExcluded(rel)) out.push(full);
  }
  return out;
}
function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const declared = manifest.sha256ByFile || {};
  const files = walk(ROOT, []).map(f => path.relative(ROOT, f).split(path.sep).join('/')).sort();
  const errors = [];
  if (files.length !== manifest.fileCount) errors.push('fileCount mismatch: manifest says ' + manifest.fileCount + ', tree has ' + files.length);
  const declaredSet = new Set(Object.keys(declared)), diskSet = new Set(files);
  for (const f of diskSet) if (!declaredSet.has(f)) errors.push('on disk but not in manifest: ' + f);
  for (const f of declaredSet) if (!diskSet.has(f)) errors.push('in manifest but not on disk: ' + f);
  let bytes = 0;
  for (const rel of files) {
    if (rel === 'SALES_PACKAGE_MANIFEST.json') {
      if (declared[rel] !== SELF_MARKER) errors.push('unexpected self-entry value for ' + rel);
      continue;
    }
    const buf = fs.readFileSync(path.join(ROOT, rel));
    bytes += buf.length;
    const actual = crypto.createHash('sha256').update(buf).digest('hex'), expected = declared[rel];
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) {
      errors.push('missing or invalid sha256 entry: ' + rel);
    } else if (expected.toLowerCase() !== actual) {
      errors.push('sha256 mismatch: ' + rel + ' (manifest=' + expected + ' actual=' + actual + ')');
    }
  }
  if (manifest.bytes !== bytes) errors.push('bytes mismatch: manifest says ' + manifest.bytes + ', tree has ' + bytes + ' (excl. manifest itself and excluded artifacts)');
  if (errors.length) { console.error('Manifest parity gate FAILED:'); errors.forEach(e => console.error('  - ' + e)); process.exitCode = 1; return; }
  console.log('Manifest parity gate passed (' + files.length + ' files, ' + bytes + ' bytes).');
}
main();
