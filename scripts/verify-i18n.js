'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'i18n', 'source.json');
const manifestPath = path.join(ROOT, 'i18n', 'manifest.json');
const metadataPath = path.join(ROOT, 'i18n', 'locale-metadata.json');
const catalogsDir = path.join(ROOT, 'i18n', 'catalogs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fail(message) {
  console.error(`I18N VERIFY FAIL: ${message}`);
  process.exitCode = 1;
}

const source = readJson(sourcePath);
const manifest = readJson(manifestPath);
const metadata = readJson(metadataPath);
const expectedKeys = Object.keys(source.keys);
const expectedKeySet = new Set(expectedKeys);

const locales = manifest.locales;

if (!Array.isArray(locales) || locales.length !== 114 || new Set(locales).size !== 114) {
  fail(`manifest must contain exactly 114 unique locales; found ${Array.isArray(locales) ? locales.length : 'invalid'}`);
}
if (metadata.localeCount !== 114 || !Array.isArray(metadata.locales) || metadata.locales.length !== 114) {
  fail('locale-metadata.json must contain exactly 114 locales');
}
if (manifest.keyCount !== expectedKeys.length) {
  fail(`manifest keyCount=${manifest.keyCount} but source contains ${expectedKeys.length} keys`);
}

const fileNames = new Set(
  fs.readdirSync(catalogsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5)),
);

for (const locale of locales) {
  if (!fileNames.has(locale)) fail(`missing runtime catalog file: i18n/catalogs/${locale}.json`);
}

const runtimeAllowedStatuses = new Set([
  'untranslated',
  'machine-draft',
  'review-required',
  'human-reviewed',
  'verified',
  'invalid',
]);
const activationStatuses = new Set(['verified']);
const sourceCopyProblemStatuses = new Set(['machine-draft', 'review-required', 'human-reviewed', 'verified']);

function extractPlaceholders(value) {
  if (typeof value !== 'string') return [];
  const tokens = [];
  const patterns = [
    /\{[^{}]+\}/g,
    /\$\{[^}]+\}/g,
    /%\d*\$?[sdif]/g,
    /https?:\/\/[^\s)]+/g,
  ];
  for (const pattern of patterns) {
    tokens.push(...(value.match(pattern) || []));
  }
  return tokens.sort();
}

function equalMultiset(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let structuralFailures = 0;
let inactiveLocales = 0;
for (const locale of locales) {
  const catalogPath = path.join(catalogsDir, `${locale}.json`);
  let catalog;
  try {
    catalog = readJson(catalogPath);
  } catch (error) {
    fail(`${locale}: invalid JSON (${error.message})`);
    structuralFailures += 1;
    continue;
  }

  if (catalog.locale !== locale) {
    fail(`${locale}: catalog.locale=${JSON.stringify(catalog.locale)}`);
    structuralFailures += 1;
  }
  if (catalog.sourceLocale !== manifest.sourceLocale) {
    fail(`${locale}: sourceLocale mismatch`);
    structuralFailures += 1;
  }
  if (!runtimeAllowedStatuses.has(catalog.status)) {
    fail(`${locale}: unsupported status=${JSON.stringify(catalog.status)}`);
    structuralFailures += 1;
  }

  const translations = catalog.translations && typeof catalog.translations === 'object'
    ? catalog.translations
    : null;
  if (!translations) {
    fail(`${locale}: translations object is missing`);
    structuralFailures += 1;
    continue;
  }

  const keys = Object.keys(translations);
  const keySet = new Set(keys);
  const missing = expectedKeys.filter((key) => !keySet.has(key));
  const extra = keys.filter((key) => !expectedKeySet.has(key));
  if (missing.length && catalog.status !== 'untranslated') {
    fail(`${locale}: ${missing.length} missing translation keys`);
    structuralFailures += 1;
  }
  if (extra.length) {
    fail(`${locale}: ${extra.length} unknown translation keys`);
    structuralFailures += 1;
  }

  let translatedCount = 0;
  for (const key of expectedKeys) {
    const sourceValue = source.keys[key];
    const targetValue = translations[key];
    if (typeof targetValue !== 'string') {
      if (catalog.status !== 'untranslated') {
        fail(`${locale}:${key}: translation must be a string`);
        structuralFailures += 1;
      }
      continue;
    }
    const hasValue = targetValue.trim().length > 0;
    if (hasValue) translatedCount += 1;
    if (locale !== 'en' && sourceCopyProblemStatuses.has(catalog.status) && targetValue === sourceValue) {
      const metadataForKey = source.keyMetadata?.[key];
      if (metadataForKey?.translatable !== false) {
        fail(`${locale}:${key}: source-copy is not allowed for translatable content`);
        structuralFailures += 1;
      }
    }
    if (catalog.status !== 'untranslated' && !hasValue) {
      fail(`${locale}:${key}: empty translation under status=${catalog.status}`);
      structuralFailures += 1;
    }
    const sourcePlaceholders = extractPlaceholders(sourceValue);
    const targetPlaceholders = extractPlaceholders(targetValue);
    if (!equalMultiset(sourcePlaceholders, targetPlaceholders)) {
      fail(`${locale}:${key}: placeholder mismatch`);
      structuralFailures += 1;
    }
  }

  const expectedCoverage = expectedKeys.length === 0 ? 100 : Math.round((translatedCount / expectedKeys.length) * 100);
  if (typeof catalog.verifiedCoverage === 'number' && catalog.verifiedCoverage !== expectedCoverage && catalog.status !== 'untranslated') {
    fail(`${locale}: verifiedCoverage=${catalog.verifiedCoverage}, actual=${expectedCoverage}`);
    structuralFailures += 1;
  }
  if (catalog.status === 'verified' && translatedCount !== expectedKeys.length) {
    fail(`${locale}: status=verified requires 100% key coverage`);
    structuralFailures += 1;
  }
  if (catalog.status !== 'verified') inactiveLocales += 1;
}

if (inactiveLocales > 0) {
  console.log(`I18N VERIFY NOTE: ${inactiveLocales}/114 locales are not verified and will not silently activate.`);
}

if (structuralFailures === 0 && !process.argv.includes('--require-all-verified')) {
  console.log('I18N VERIFY PASS: 114 locale files are structurally aligned with the 101-key source contract.');
}

if (process.argv.includes('--require-all-verified')) {
  let gateFailures = 0;
  for (const locale of locales) {
    const catalog = readJson(path.join(catalogsDir, `${locale}.json`));
    if (!activationStatuses.has(catalog.status)) {
      fail(`${locale}: release gate requires status=verified`);
      gateFailures += 1;
    }
  }
  if (gateFailures === 0 && structuralFailures === 0) {
    console.log('I18N VERIFY RELEASE GATE PASS: all 114 locales are verified.');
  } else {
    console.error(`I18N VERIFY RELEASE GATE BLOCKED: ${gateFailures} locale(s) are not verified.`);
    process.exitCode = 1;
  }
}

if (structuralFailures > 0) process.exitCode = 1;
