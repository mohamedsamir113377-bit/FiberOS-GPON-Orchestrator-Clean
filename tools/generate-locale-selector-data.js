#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

const template = read('apps/field-web/public/locales-114.json');
const quality = read('i18n/QUALITY_GATE_REPORT.json');
if (!Array.isArray(template.languages) || template.languages.length !== 114 || !quality.locales) {
  throw new Error('LOCALE_SELECTOR_SOURCE_INVALID');
}

const tally = Object.create(null);
let availableCount = 0;
let formattingFallbackCount = 0;
const languages = template.languages.map((language) => {
  const record = quality.locales[language.code];
  if (!record) throw new Error(`LOCALE_QUALITY_RECORD_MISSING:${language.code}`);
  const status = String(record.status || 'untranslated');
  const intl = record.intl || {};
  const formattingSupported = intl.dateTimeFormatSupported === true && intl.numberFormatSupported === true;
  tally[status] = (tally[status] || 0) + 1;
  const available = status === 'verified' || status === 'machine-draft';
  if (available) availableCount += 1;
  if (available && !formattingSupported) formattingFallbackCount += 1;
  return {
    ...language,
    status,
    coverage: Number(record.coverage || 0),
    available,
    formattingSupported,
    formattingFallbackLocale: formattingSupported ? null : (intl.formattingFallbackLocale || 'en')
  };
});

const output = {
  schema: 'fiberos.r14.1.locale-selector.v2',
  version: '2.0.0',
  total: languages.length,
  availableCount,
  formattingFallbackCount,
  statusTally: tally,
  default: template.default,
  direction: template.direction,
  languages
};
const serialized = JSON.stringify(output, null, 2) + '\n';
const checkOnly = process.argv.includes('--check');
for (const file of [
  'apps/field-web/public/locales-114.json',
  'apps/ops-web/public/locales-114.json'
]) {
  const target = path.join(ROOT, file);
  if (checkOnly) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== serialized) {
      throw new Error(`LOCALE_SELECTOR_DATA_OUT_OF_DATE:${file}`);
    }
  } else {
    fs.writeFileSync(target, serialized);
  }
}
console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'write', total: output.total, availableCount, formattingFallbackCount, statusTally: tally }, null, 2));
