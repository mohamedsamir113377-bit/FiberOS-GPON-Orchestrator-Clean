#!/usr/bin/env node
/**
 * Structural i18n gate — honest, non-semantic.
 * Fails on: untranslated catalogs, empty values, key-set drift vs source,
 * raw duplicate keys in source.json keys section, core/ops/field SHA mismatch.
 * Does NOT promote machine-draft to verified.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const srcPath = path.join(root, 'i18n/catalogs/source.json');
const catalogsDir = path.join(root, 'i18n/catalogs');
const mirrors = [
  'apps/ops-web/public/i18n/catalogs',
  'apps/field-web/public/i18n/catalogs',
];

function fail(msg) {
  console.error('I18N_GATE_FAIL:', msg);
  process.exitCode = 1;
}

const source = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const srcKeys = Object.keys(source.keys || {});
if (srcKeys.length !== 101) fail(`source keys ${srcKeys.length} != 101`);

// Raw duplicate detection in keys section only
const raw = fs.readFileSync(srcPath, 'utf8');
const keysChunk = raw.includes('"keyMetadata"')
  ? raw.split('"keys"')[1].split('"keyMetadata"')[0]
  : raw.split('"keys"')[1];
const occ = [...keysChunk.matchAll(/"(ui\.[a-f0-9]+|attr\.[a-f0-9]+)"\s*:/g)].map(m => m[1]);
const seen = new Map();
for (const k of occ) seen.set(k, (seen.get(k) || 0) + 1);
const dups = [...seen.entries()].filter(([, n]) => n > 1);
if (dups.length) fail(`source.json keys section has duplicate keys: ${dups.slice(0, 5).map(d => d[0]).join(',')}`);

const files = fs.readdirSync(catalogsDir).filter(f => f.endsWith('.json') && f !== 'source.json');

// Locale catalogs are served once from the canonical root /i18n/ tree by the site builder.
// App-local trees retain only the verified Arabic fallback to avoid shipping two stale copies
// of every machine-draft catalog. This gate checks the fallback byte-for-byte against core.
const coreArabic = path.join(catalogsDir, 'ar.json');
const coreArabicSha = fs.existsSync(coreArabic)
  ? crypto.createHash('sha256').update(fs.readFileSync(coreArabic)).digest('hex')
  : null;
for (const mirror of mirrors) {
  const dir = path.join(root, mirror);
  if (!fs.existsSync(dir)) {
    fail(`missing app Arabic fallback directory: ${mirror}`);
    continue;
  }
  const names = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  if (JSON.stringify(names) !== JSON.stringify(['ar.json'])) {
    fail(`${mirror} must contain only ar.json; canonical locale catalogs are served from /i18n/`);
    continue;
  }
  const mirrorArabic = path.join(dir, 'ar.json');
  const mirrorSha = crypto.createHash('sha256').update(fs.readFileSync(mirrorArabic)).digest('hex');
  if (!coreArabicSha || mirrorSha !== coreArabicSha) fail(`Arabic fallback mismatch: ${mirror}/ar.json`);
}

let untranslated = 0;
for (const f of files) {
  const code = f.replace(/\.json$/, '');
  const p = path.join(catalogsDir, f);
  const cat = JSON.parse(fs.readFileSync(p, 'utf8'));
  const status = cat.status || '';
  const trans = cat.translations || {};
  const keyList = Object.keys(trans);
  if (status === 'untranslated' || keyList.length === 0) {
    fail(`untranslated or empty catalog: ${code}`);
    untranslated++;
    continue;
  }
  if (keyList.length !== 101) fail(`${code}: keyCount ${keyList.length} != 101`);
  for (const k of srcKeys) {
    if (!(k in trans)) fail(`${code}: missing key ${k}`);
    if (String(trans[k] ?? '').trim() === '') fail(`${code}: empty value for ${k}`);
  }
}

console.log(JSON.stringify({
  ok: process.exitCode !== 1,
  catalogs: files.length,
  sourceKeys: srcKeys.length,
  untranslatedFails: untranslated,
}, null, 2));
if (process.exitCode === 1) process.exit(1);
