#!/usr/bin/env node
'use strict';
/**
 * FiberOS R14.1 — translation validation gate (§25).
 * Per locale: key-count parity, coverage, empty values, placeholder parity,
 * structural parity, direction/RTL consistency, source-copy detection and
 * fixed-term protection, glossary availability, model-registry provenance.
 * Keys the canonical source marks as FIXED/NON-TRANSLATABLE are excluded from
 * the source-copy rule (the project deliberately preserves technical identifiers
 * and status literals). Latin residue is a WARNING, never a release blocker.
 * FAIL => NOT RELEASED (fail-closed, no English fallback).
 * Usage: node tools/validate-translation.js [--locale=xx] [--require-status=verified] [--json]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const p = process.argv.find((x) => x.startsWith(`--${n}=`)); return p ? p.split('=').slice(1).join('=') : d; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const source = readJson(path.join(ROOT, 'i18n', 'source.json'));
const manifest = readJson(path.join(ROOT, 'i18n', 'manifest.json'));
const metadata = readJson(path.join(ROOT, 'i18n', 'locale-metadata.json'));
const glossaryPath = path.join(ROOT, 'i18n', 'weblate', 'glossary', 'fiberos-technical-glossary.tsv');
const modelsPath = path.join(ROOT, 'i18n', 'models.json');
const sourceKeys = Object.keys(source.keys);
const sourceSet = new Set(sourceKeys);

// Keys the source declares fixed / non-translatable: excluded from the source-copy rule.
const meta = source.keyMetadata || {};
const isFixed = (k) => {
  const m = meta[k];
  if (!m) return false;
  const s = JSON.stringify(m);
  return /"(fixed|doNotTranslate|notTranslatable|literal)"\s*:\s*true/.test(s)
      || /"translatable"\s*:\s*false/.test(s);
};
const fixedKeys = new Set(sourceKeys.filter(isFixed));

const PLACEHOLDER = /\{[a-zA-Z0-9_.]+\}/g;
const ph = (s) => (String(s).match(PLACEHOLDER) || []).sort().join('|');
const directionOf = new Map(metadata.locales.map((l) => [l.code, l.direction]));
const RTL = new Set(manifest.rtl);
const LATIN_WORDS = /\b(the|and|with|from|please|status|error|ticket|tenant|session|network|asset)\b/gi;

const models = fs.existsSync(modelsPath) ? (readJson(modelsPath).models || []) : [];
const modelsById = new Map(models.map((m) => [m.locale, m]));

const glossaryPresent = fs.existsSync(glossaryPath);
const glossaryTermCount = glossaryPresent
  ? fs.readFileSync(glossaryPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).length
  : 0;

const only = arg('locale', null);
const requireStatus = arg('require-status', null);
const targets = only ? [only] : manifest.locales;

const results = [];
for (const locale of targets) {
  const file = `i18n/catalogs/${locale}.json`;
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    results.push({ locale, file, declared_status: 'blocked', coverage: `0/${sourceKeys.length}`,
      findings: ['CATALOG_FILE_MISSING'], warnings: [], released: false });
    continue;
  }
  const cat = readJson(abs);
  const t = cat.translations || {};
  const targetKeys = Object.keys(t);
  const findings = [];
  const warnings = [];

  const extra = targetKeys.filter((k) => !sourceSet.has(k));
  const missing = sourceKeys.filter((k) => !(k in t));
  const empty = sourceKeys.filter((k) => k in t && String(t[k]).trim() === '');
  const phMismatch = sourceKeys.filter((k) => k in t && ph(source.keys[k]) !== ph(t[k]));
  const leakage = sourceKeys.filter((k) => !fixedKeys.has(k) && k in t && t[k] === source.keys[k] && ph(source.keys[k]) === '');
  const latinLeak = sourceKeys.filter((k) => k in t && (String(t[k]).match(LATIN_WORDS) || []).length >= 3);
  const model = modelsById.get(locale);

  const checks = {
    file_exists: true,
    key_count_parity: targetKeys.length === sourceKeys.length,
    no_extra_keys: extra.length === 0,
    no_missing_keys: missing.length === 0,
    no_empty_values: empty.length === 0,
    placeholder_parity: phMismatch.length === 0,
    no_source_leakage: leakage.length === 0,
    direction_consistent: cat.locale === locale && (RTL.has(locale) === (directionOf.get(locale) === 'rtl')),
    glossary_available: glossaryPresent,
    declared_status: cat.status || 'untranslated',
    model_registry_entry: Boolean(model),
  };
  if (!checks.key_count_parity) findings.push(`KEY_COUNT ${targetKeys.length}/${sourceKeys.length}`);
  if (extra.length) findings.push(`EXTRA_KEYS ${extra.slice(0, 5).join(',')}`);
  if (missing.length) findings.push(`MISSING_KEYS ${missing.length}`);
  if (empty.length) findings.push(`EMPTY_VALUES ${empty.length}`);
  if (phMismatch.length) findings.push(`PLACEHOLDER_MISMATCH ${phMismatch.slice(0, 5).join(',')}`);
  if (leakage.length) findings.push(`SOURCE_COPY ${leakage.length}`);
  if (!checks.direction_consistent) findings.push('DIRECTION_INCONSISTENT');
  if (latinLeak.length) warnings.push(`LATIN_TERMS_PRESERVED ${latinLeak.length}`);
  if (checks.declared_status !== 'untranslated' && !model) warnings.push('NO_MODEL_REGISTRY_ENTRY');

  const structuralPass = checks.file_exists && checks.key_count_parity && checks.no_extra_keys
    && checks.no_missing_keys && checks.no_empty_values && checks.placeholder_parity
    && checks.no_source_leakage && checks.direction_consistent
    && ['verified', 'human-reviewed', 'machine-draft'].includes(checks.declared_status);
  let released = structuralPass;
  if (requireStatus) released = structuralPass && checks.declared_status === requireStatus;

  results.push({ locale, file, declared_status: checks.declared_status,
    coverage: `${targetKeys.length}/${sourceKeys.length}`, findings, warnings, released, checks });
}

const summary = {
  schema: 'fiberos.r14.1.translation-validation.v1',
  generatedAt: new Date().toISOString(),
  sourceKeys: sourceKeys.length,
  fixedKeysExcludedFromSourceCopyRule: fixedKeys.size,
  glossaryTerms: glossaryTermCount,
  modelRegistryEntries: models.length,
  requiredStatus: requireStatus || null,
  validated: results.length,
  released: results.filter((r) => r.released).length,
  notReleased: results.filter((r) => !r.released).length,
  results,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
else {
  for (const r of results) {
    const flag = r.released ? 'RELEASED    ' : 'NOT-RELEASED';
    console.log(`${flag} ${r.locale.padEnd(6)} status=${String(r.declared_status).padEnd(14)} coverage=${String(r.coverage).padEnd(8)} ${r.findings.slice(0, 2).join(' | ') || 'ok'}`);
  }
  console.log(JSON.stringify({ validated: summary.validated, released: summary.released, notReleased: summary.notReleased,
    sourceKeys: summary.sourceKeys, fixedKeysExcluded: summary.fixedKeysExcludedFromSourceCopyRule,
    glossaryTerms: summary.glossaryTerms, modelRegistryEntries: summary.modelRegistryEntries }, null, 2));
}
process.exitCode = 0;
