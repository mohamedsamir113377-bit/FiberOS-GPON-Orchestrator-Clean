#!/usr/bin/env node
'use strict';
/**
 * FiberOS R14.1 — build the translation queue for the locales that still need work.
 * Reads the real catalogs and emits one job per locale, fail-closed:
 * a locale with no model-registry entry is emitted with model:null and
 * status "blocked" so the worker REFUSES it instead of silently falling back to English.
 * Usage: node tools/build-translation-queue.js [--include-machine-draft] [--out <path>]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const manifest = readJson(path.join(ROOT, 'i18n', 'manifest.json'));
const source = readJson(path.join(ROOT, 'i18n', 'source.json'));
const models = readJson(path.join(ROOT, 'i18n', 'models.json')).models || [];
const byLocale = new Map(models.map((m) => [m.locale, m]));
const sourceKeys = Object.keys(source.keys);

const includeMachineDraft = process.argv.includes('--include-machine-draft');

const jobs = [];
for (const locale of manifest.locales) {
  const file = path.join(ROOT, 'i18n', 'catalogs', `${locale}.json`);
  if (!fs.existsSync(file)) continue;
  const cat = readJson(file);
  const status = cat.status || 'untranslated';
  const wanted = status === 'untranslated' || (includeMachineDraft && status === 'machine-draft');
  if (!wanted) continue;
  const model = byLocale.get(locale) || null;
  jobs.push({
    locale,
    catalog: `i18n/catalogs/${locale}.json`,
    currentStatus: status,
    requiredStatusAfterWork: includeMachineDraft ? 'verified' : 'machine-draft',
    sourceLocale: manifest.sourceLocale,
    keyCount: sourceKeys.length,
    sourceKeys,
    rtl: manifest.rtl.includes(locale),
    model: model ? { name: model.model, version: model.model_version, license: model.license } : null,
    executable: Boolean(model),
    blockingReason: model ? null : 'NO_MODEL_REGISTRY_ENTRY',
    fallbackLanguage: null,   // explicit: English fallback is forbidden
    onFailure: 'FAILED',
  });
}

const doc = {
  schema: 'fiberos.r14.1.translation-queue.v1',
  generatedAt: new Date().toISOString(),
  sourceKeyCount: sourceKeys.length,
  totalJobs: jobs.length,
  executableJobs: jobs.filter((j) => j.executable).length,
  blockedJobs: jobs.filter((j) => !j.executable).length,
  policy: { failClosed: true, allowEnglishFallback: false, requirePlaceholderParity: true, requireModelProvenance: true },
  jobs,
};
const outFlag = process.argv.indexOf('--out');
const out = outFlag > -1 ? process.argv[outFlag + 1] : path.join(ROOT, 'i18n', 'translation-queue.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify({ written: out, totalJobs: doc.totalJobs, executableJobs: doc.executableJobs, blockedJobs: doc.blockedJobs }, null, 2));
