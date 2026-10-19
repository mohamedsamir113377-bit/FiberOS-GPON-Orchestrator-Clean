#!/usr/bin/env node
'use strict';

/**
 * FiberOS R14.1 — surgical translation validator.
 *
 * Deterministic checks are always local and free. Optional AI review is an
 * additional advisory layer and is never allowed to convert structural
 * failures into passes. No OpenAI SDK dependency is required: when AI mode is
 * enabled the script uses the Node fetch API and requires OPENAI_API_KEY plus
 * OPENAI_MODEL explicitly. AI transport errors are fail-closed for the AI
 * review section, not silently treated as VALID.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const arg = (name, fallback = null) => {
  const item = process.argv.find((x) => x.startsWith(`--${name}=`));
  return item ? item.split('=').slice(1).join('=') : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const sourceCandidates = [
  path.join(ROOT, 'i18n', 'source.json'),
  path.join(ROOT, 'i18n', 'catalogs', 'source.json')
];
const sourcePath = sourceCandidates.find(fs.existsSync);
if (!sourcePath) throw new Error('Canonical i18n source not found under i18n/source.json or i18n/catalogs/source.json');

const sourceFile = readJson(sourcePath);
const sourceKeys = sourceFile.keys && typeof sourceFile.keys === 'object' ? sourceFile.keys : sourceFile.translations;
if (!sourceKeys || typeof sourceKeys !== 'object') throw new Error('Canonical source must expose a keys or translations object');

const meta = sourceFile.keyMetadata || {};
const terminologyPath = path.join(ROOT, 'i18n', 'terminology.json');
const terminology = fs.existsSync(terminologyPath) ? readJson(terminologyPath) : { terms: [] };
const preservedTechnicalTokens = new Set((terminology.terms || []).filter((t) => t && t.preserve && typeof t.source === 'string').map((t) => t.source));
const isFixed = (key) => {
  const m = meta[key];
  if (!m) return false;
  const raw = JSON.stringify(m);
  return /"(fixed|doNotTranslate|notTranslatable|literal)"\s*:\s*true/.test(raw)
    || /"translatable"\s*:\s*false/.test(raw);
};
const fixedKeys = new Set(Object.keys(sourceKeys).filter(isFixed));
const placeholder = (s) => [...String(s).matchAll(/\{[a-zA-Z0-9_.-]+\}|%[sdif]|\\[nrt]/g)].map((m) => m[0]).sort();
const countOf = (value, pattern) => (String(value).match(pattern) || []).length;

function structuralCheck(key, sourceVal, transVal, langCode) {
  const errors = [];
  if (typeof transVal !== 'string') {
    errors.push('TYPE_MISMATCH');
    return errors;
  }
  const srcPh = placeholder(sourceVal);
  const dstPh = placeholder(transVal);
  if (JSON.stringify(srcPh) !== JSON.stringify(dstPh)) errors.push(`PLACEHOLDER_MISMATCH:${srcPh.join('|')}=>${dstPh.join('|')}`);

  for (const token of ['\\n', '\\t', '\\r']) {
    if (countOf(sourceVal, new RegExp(token.replace('\\', '\\\\'), 'g')) !== countOf(transVal, new RegExp(token.replace('\\', '\\\\'), 'g'))) {
      errors.push(`ESCAPE_COUNT_MISMATCH:${JSON.stringify(token)}`);
    }
  }
  for (const token of ['%s', '%d', '%i', '%f']) {
    if (countOf(sourceVal, new RegExp(token.replace('%', '%\\'), 'g')) !== countOf(transVal, new RegExp(token.replace('%', '%\\'), 'g'))) {
      errors.push(`FORMAT_TOKEN_COUNT_MISMATCH:${token}`);
    }
  }

  for (const token of preservedTechnicalTokens) {
    if (!String(sourceVal).includes(token)) continue;
    const srcCount = countOf(sourceVal, new RegExp(escapeRegExp(token), 'g'));
    const dstCount = countOf(transVal, new RegExp(escapeRegExp(token), 'g'));
    if (srcCount !== dstCount && !fixedKeys.has(key)) errors.push(`TECH_TOKEN_MISMATCH:${token}:${srcCount}=>${dstCount}`);
  }

  if (sourceVal.includes('→') && transVal.includes('→') && sourceVal.split('→').length !== transVal.split('→').length) {
    errors.push('ARROW_SEGMENT_COUNT_MISMATCH');
  }
  const sourceEmojiCount = (sourceVal.match(/\p{Extended_Pictographic}/gu) || []).length;
  const targetEmojiCount = (transVal.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (targetEmojiCount < sourceEmojiCount) errors.push('EMOJI_REMOVED');
  return errors;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function loadCatalog(locale) {
  const file = path.join(ROOT, 'i18n', 'catalogs', `${locale}.json`);
  if (!fs.existsSync(file)) return null;
  return { file, data: readJson(file) };
}

async function aiReviewBatch(locale, rows) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!key || !model) return { status: 'NOT_CONFIGURED', findings: ['OPENAI_API_KEY_AND_OPENAI_MODEL_REQUIRED'] };
  const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a conservative localization reviewer for an FTTH operations system. Return strict JSON: {"items":[{"key":"...","status":"VALID|REVIEW","reason":"..."}]}. Preserve technical meaning; do not invent corrections. Treat machine drafts as review-needed unless language/context is clearly correct. Never mark structural mismatches as valid.'
        },
        { role: 'user', content: JSON.stringify({ locale, rows }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('AI_EMPTY_RESPONSE');
  const parsed = JSON.parse(text);
  return { status: 'COMPLETE', ...parsed };
}

async function main() {
  const catalogsDir = path.join(ROOT, 'i18n', 'catalogs');
  const requestedLocale = arg('locale');
  const localeFiles = requestedLocale ? [`${requestedLocale}.json`] : fs.readdirSync(catalogsDir).filter((f) => f.endsWith('.json') && f !== 'source.json').sort();
  const aiEnabled = has('ai');
  const batchSize = Number(arg('ai-batch-size', '12'));
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new RangeError('--ai-batch-size must be between 1 and 50');
  const summary = { schema: 'fiberos.r14.1.surgical-translation-validator.v2', sourcePath: path.relative(ROOT, sourcePath), sourceKeys: Object.keys(sourceKeys).length, aiEnabled, locales: [], totals: { locales: 0, missingCatalogs: 0, empty: 0, structural: 0, sourceCopies: 0, aiReview: 0 } };

  for (const file of localeFiles) {
    const locale = path.basename(file, '.json');
    const loaded = loadCatalog(locale);
    summary.totals.locales++;
    if (!loaded) {
      summary.totals.missingCatalogs++;
      summary.locales.push({ locale, status: 'MISSING_CATALOG', findings: ['CATALOG_FILE_MISSING'] });
      continue;
    }
    const cat = loaded.data;
    const translations = cat.translations && typeof cat.translations === 'object' ? cat.translations : {};
    const findings = [];
    const structural = [];
    const advisory = [];
    const sourceCopies = [];
    const missing = [];
    for (const key of Object.keys(sourceKeys)) {
      if (!(key in translations)) { missing.push(key); continue; }
      const value = translations[key];
      if (cat.status !== 'untranslated' && typeof value === 'string' && !value.trim()) { summary.totals.empty++; findings.push({ key, code: 'EMPTY_VALUE' }); }
      for (const code of structuralCheck(key, sourceKeys[key], value, locale)) { structural.push({ key, code }); summary.totals.structural++; }
      const sourceEmojiCount = (String(sourceKeys[key]).match(/\p{Extended_Pictographic}/gu) || []).length;
      const targetEmojiCount = (String(value).match(/\p{Extended_Pictographic}/gu) || []).length;
      if (targetEmojiCount > sourceEmojiCount) advisory.push({ key, code: 'EMOJI_ADDED', count: targetEmojiCount - sourceEmojiCount });
      if (cat.status !== 'untranslated' && !fixedKeys.has(key) && value === sourceKeys[key]) { sourceCopies.push(key); summary.totals.sourceCopies++; }
    }
    if (missing.length && cat.status !== 'untranslated') findings.push({ code: 'MISSING_KEYS', count: missing.length, keys: missing.slice(0, 20) });
    if (structural.length) findings.push(...structural);
    if (sourceCopies.length) findings.push({ code: 'SOURCE_COPY', count: sourceCopies.length, keys: sourceCopies });
    // Emoji additions are advisory only; removals remain structural failures.
    // Do not promote advisory observations into hard findings.

    let ai = null;
    if (aiEnabled && cat.status !== 'untranslated') {
      const candidates = Object.keys(sourceKeys).filter((key) => typeof translations[key] === 'string' && !structural.some((x) => x.key === key) && !fixedKeys.has(key));
      const rows = candidates.map((key) => ({ key, source: sourceKeys[key], translation: translations[key] }));
      ai = { status: 'NOT_RUN' };
      for (let i = 0; i < rows.length; i += batchSize) {
        try {
          const batch = await aiReviewBatch(locale, rows.slice(i, i + batchSize));
          ai = ai.status === 'COMPLETE' ? { status: 'COMPLETE', items: [...(ai.items || []), ...(batch.items || [])] } : batch;
          summary.totals.aiReview += (batch.items || []).length;
        } catch (error) {
          ai = { status: 'ERROR', error: error.message };
          break;
        }
      }
    }
    summary.locales.push({ locale, declaredStatus: cat.status || 'untranslated', coverage: `${Object.keys(translations).length}/${Object.keys(sourceKeys).length}`, findings, advisories: advisory, sourceCopyObservations: sourceCopies, ai });
  }

  const output = JSON.stringify(summary, null, 2);
  if (has('json')) console.log(output);
  else {
    for (const item of summary.locales) console.log(`${item.locale.padEnd(6)} status=${String(item.declaredStatus || item.status).padEnd(14)} findings=${item.findings?.length || 0} ai=${item.ai?.status || 'OFF'}`);
    console.log(JSON.stringify(summary.totals, null, 2));
  }
  fs.writeFileSync(path.join(ROOT, 'i18n', 'SURGICAL_VALIDATION_REPORT.json'), `${output}\n`, 'utf8');
  const hardFailures = summary.locales.reduce((n, x) => n + (x.findings || []).filter((f) => !['SOURCE_COPY'].includes(f.code)).length, 0);
  process.exitCode = hardFailures > 0 ? 1 : 0;
}

main().catch((error) => { console.error(`SURGICAL VALIDATOR ERROR: ${error.message}`); process.exitCode = 1; });
