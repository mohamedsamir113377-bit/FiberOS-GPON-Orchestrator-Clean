#!/usr/bin/env node
'use strict';
/**
 * FiberOS R14.1 — generate the machine-readable manifest of the 114 locales.
 * Derives every field from the real files (no invented numbers):
 *   locale, language, direction, file, key_count, translated_count, missing_count, status
 * status is READ from the catalog itself; it is never upgraded to "complete".
 * Usage: node tools/generate-locale-manifest.js [--out <path>]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const manifest = readJson(path.join(ROOT, 'i18n', 'manifest.json'));
const metadata = readJson(path.join(ROOT, 'i18n', 'locale-metadata.json'));
const source = readJson(path.join(ROOT, 'i18n', 'source.json'));
const catalogsDir = path.join(ROOT, 'i18n', 'catalogs');

const sourceKeys = Object.keys(source.keys);
const directionOf = new Map(metadata.locales.map((l) => [l.code, l.direction]));

const rows = [];
for (const locale of manifest.locales) {
  const file = `i18n/catalogs/${locale}.json`;
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    rows.push({ locale, language: locale, direction: directionOf.get(locale) || null, file,
      key_count: sourceKeys.length, translated_count: 0, missing_count: sourceKeys.length,
      status: 'blocked', reason: 'CATALOG_FILE_MISSING' });
    continue;
  }
  const cat = readJson(abs);
  const t = cat.translations || {};
  const nonEmpty = sourceKeys.filter((k) => typeof t[k] === 'string' && t[k].trim() !== '');
  const missing = sourceKeys.filter((k) => !(typeof t[k] === 'string' && t[k].trim() !== ''));
  let status = cat.status || 'untranslated';
  // Never report completeness for a locale whose own coverage is partial.
  if (missing.length > 0 && status === 'complete') status = 'needs_review';
  rows.push({
    locale,
    language: (metadata.locales.find((l) => l.code === locale) || {}).language || locale,
    direction: directionOf.get(locale) || null,
    file,
    key_count: sourceKeys.length,
    translated_count: nonEmpty.length,
    missing_count: missing.length,
    status,
  });
}

const tally = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
const doc = {
  schema: 'fiberos.r14.1.locale-manifest.v1',
  generatedAt: new Date().toISOString(),
  sourceLocale: manifest.sourceLocale,
  canonicalKeyCount: sourceKeys.length,
  localeCount: rows.length,
  statusVocabulary: ['untranslated','machine-draft','review-required','human-reviewed','verified','blocked','needs_review'],
  activationStatuses: manifest.translationPolicy.activationStatuses,
  statusTally: tally,
  locales: rows,
};
const outFlag = process.argv.indexOf('--out');
const out = outFlag > -1 ? process.argv[outFlag + 1] : path.join(ROOT, 'i18n', 'manifest-114.generated.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify({ written: out, localeCount: rows.length, keyCount: sourceKeys.length, statusTally: tally }, null, 2));
