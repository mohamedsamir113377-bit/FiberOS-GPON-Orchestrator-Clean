#!/usr/bin/env node
'use strict';

/**
 * FiberOS — deterministic forensic localization audit.
 *
 * IMPORTANT:
 * This is NOT a human linguistic review. It validates localization artifacts,
 * source-contract fidelity, Unicode safety, protected technical terms, and
 * runtime locale metadata. Passing this audit MUST NOT promote a machine-draft
 * catalog to a human-reviewed/verified language status.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const I18N = path.join(ROOT, 'i18n');
const CATALOGS = path.join(I18N, 'catalogs');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sorted(a) { return [...a].sort(); }
function sameArray(a,b) {
  const x=sorted(a), y=sorted(b);
  return x.length===y.length && x.every((v,i)=>v===y[i]);
}
function canonicalLocale(value) {
  try { return new Intl.Locale(value).toString(); } catch (_) { return null; }
}
function bidiBalanced(value) {
  const stack=[];
  const opens = new Set(['\u202A','\u202B','\u202D','\u202E','\u2066','\u2067','\u2068']);
  for (const ch of String(value)) {
    if (opens.has(ch)) stack.push(ch);
    else if (ch === '\u202C') {
      const last=stack.pop();
      if (!['\u202A','\u202B','\u202D','\u202E'].includes(last)) return false;
    } else if (ch === '\u2069') {
      const last=stack.pop();
      if (!['\u2066','\u2067','\u2068'].includes(last)) return false;
    }
  }
  return stack.length===0;
}
function placeholders(value) {
  if (typeof value !== 'string') return [];
  const out=[];
  for (const pattern of [
    /\$\{[^}]+\}/g,
    /\{[^{}]+\}/g,
    /%\d*\$?[sdif]/g
  ]) out.push(...(value.match(pattern)||[]));
  return out.sort();
}
function countLiteral(value, token) {
  const s=String(value);
  let count=0, at=0;
  while ((at=s.indexOf(token,at))!==-1) { count++; at+=token.length; }
  return count;
}

const source=readJson(path.join(I18N,'source.json'));
const manifest=readJson(path.join(I18N,'manifest-114.generated.json'));
const metadata=readJson(path.join(I18N,'locale-metadata.json'));
const terminology=readJson(path.join(I18N,'terminology.json'));

const sourceKeys=source.keys;
const keyNames=Object.keys(sourceKeys);
const fixedKeys=new Set(
  Object.entries(source.keyMetadata||{})
    .filter(([,v])=>v && v.translatable===false)
    .map(([k])=>k)
);
const preservedTerms=(terminology.terms||[])
  .filter(t=>t && t.preserve && typeof t.source==='string')
  .map(t=>t.source);

const failures=[];
const warnings=[];
const results=[];
const intlUnsupported=[];
const metadataByLocale=new Map((metadata.locales||[]).map(x=>[x.code,x]));

if (manifest.localeCount!==114 || manifest.locales.length!==114) failures.push('LOCALE_COUNT');
if (manifest.canonicalKeyCount!==101 || keyNames.length!==101) failures.push('KEY_COUNT');

const audited=manifest.locales.filter(x=>x.status!=='untranslated');
const untranslated=manifest.locales.filter(x=>x.status==='untranslated');
if (audited.length!==manifest.localeCount-untranslated.length) failures.push('AUDITED_CATALOG_COUNT');
if (audited.length+untranslated.length!==manifest.localeCount) failures.push('LOCALE_PARTITION');
const declaredTally=manifest.statusTally||{};
for (const status of ['verified','machine-draft','untranslated']) {
  const actual=manifest.locales.filter(x=>x.status===status).length;
  if (declaredTally[status]!==undefined && declaredTally[status]!==actual) failures.push('STATUS_TALLY:'+status);
}

for (const entry of audited) {
  const locale=entry.locale;
  const file=path.join(CATALOGS,locale+'.json');
  if (!fs.existsSync(file)) { failures.push(locale+':MISSING_CATALOG'); continue; }

  let cat;
  try { cat=readJson(file); }
  catch (error) { failures.push(locale+':INVALID_JSON:'+error.message); continue; }

  const tr=cat.translations && typeof cat.translations==='object' ? cat.translations : null;
  if (!tr) { failures.push(locale+':MISSING_TRANSLATIONS_OBJECT'); continue; }

  const keys=Object.keys(tr);
  const missing=keyNames.filter(k=>!(k in tr));
  const extra=keys.filter(k=>!(k in sourceKeys));
  const empty=[], nfc=[], replacement=[], bidi=[], fixedBad=[], sourceCopy=[], placeholderBad=[], terminologyBad=[];

  for (const key of keyNames) {
    if (!(key in tr)) continue;
    const value=tr[key];
    if (typeof value!=='string' || !value.trim()) empty.push(key);
    if (typeof value!=='string') continue;

    if (value.normalize('NFC')!==value) nfc.push(key);
    if (value.includes('\uFFFD')) replacement.push(key);
    if (!bidiBalanced(value)) bidi.push(key);

    const sourceValue=String(sourceKeys[key]);
    if (JSON.stringify(placeholders(sourceValue))!==JSON.stringify(placeholders(value))) placeholderBad.push(key);
    if (fixedKeys.has(key) && value!==sourceValue) fixedBad.push(key);
    if (locale!=='en' && !fixedKeys.has(key) && value===sourceValue) sourceCopy.push(key);

    for (const term of preservedTerms) {
      if (sourceValue.includes(term) && countLiteral(value,term)!==countLiteral(sourceValue,term)) {
        terminologyBad.push(key+':'+term);
      }
    }
  }

  if (missing.length) failures.push(locale+':MISSING_KEYS:'+missing.join(','));
  if (extra.length) failures.push(locale+':EXTRA_KEYS:'+extra.join(','));
  if (empty.length) failures.push(locale+':EMPTY_VALUES:'+empty.join(','));
  if (nfc.length) failures.push(locale+':NFC_DRIFT:'+nfc.join(','));
  if (replacement.length) failures.push(locale+':REPLACEMENT_CHARACTER:'+replacement.join(','));
  if (bidi.length) failures.push(locale+':BIDI_UNBALANCED:'+bidi.join(','));
  if (fixedBad.length) failures.push(locale+':FIXED_VALUE_DRIFT:'+fixedBad.join(','));
  if (sourceCopy.length) failures.push(locale+':TRANSLATABLE_SOURCE_COPY:'+sourceCopy.join(','));
  if (placeholderBad.length) failures.push(locale+':PLACEHOLDER_PARITY:'+placeholderBad.join(','));
  if (terminologyBad.length) failures.push(locale+':TERM_PRESERVATION:'+terminologyBad.join(','));

  const meta=metadataByLocale.get(locale);
  if (!meta) {
    failures.push(locale+':MISSING_METADATA');
  } else {
    try {
      const canonical=canonicalLocale(locale);
      if (canonical!==meta.canonical && !((manifest.canonicalAliases||{})[locale]===canonical)) {
        failures.push(locale+':BCP47_CANONICAL:'+canonical+' != '+meta.canonical);
      }
      const direction=new Intl.Locale(locale).textInfo?.direction || null;
      if (direction && direction!==meta.direction) failures.push(locale+':DIRECTION:'+direction+' != '+meta.direction);
      const plural=new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      if (!sameArray(plural,meta.pluralCategories||[])) {
        failures.push(locale+':PLURAL_CATEGORIES:'+plural.join(',')+' != '+(meta.pluralCategories||[]).join(','));
      }
      const numberSupported=Intl.NumberFormat.supportedLocalesOf([locale]).length>0;
      const dateSupported=Intl.DateTimeFormat.supportedLocalesOf([locale]).length>0;
      if (!numberSupported || !dateSupported) intlUnsupported.push(locale);
    } catch (error) {
      warnings.push(locale+':Intl runtime observation failed:'+error.message);
    }
  }

  if ((cat.status==='machine-draft' || cat.status==='verified') && cat.verifiedCoverage!==undefined && cat.verifiedCoverage!==100) {
    failures.push(locale+':VERIFIED_COVERAGE_FIELD:'+cat.verifiedCoverage);
  }

  results.push({
    locale,
    declaredStatus:cat.status,
    keyCount:keys.length,
    missing:missing.length,
    extra:extra.length,
    empty:empty.length,
    nfc:nfc.length,
    replacement:replacement.length,
    bidi:bidi.length,
    fixedInvariantDrift:fixedBad.length,
    sourceCopyViolations:sourceCopy.length,
    placeholderParityViolations:placeholderBad.length,
    terminologyViolations:terminologyBad.length
  });
}

const report={
  schema:'fiberos.i18n.forensic-linguistic-audit.v1',
  scope:{
    runtimeLocaleCount:manifest.localeCount,
    auditedCatalogCount:audited.length,
    auditedEntriesPerCatalog:keyNames.length,
    auditedEntryCells:audited.length*keyNames.length,
    excludedUntranslatedCatalogCount:untranslated.length,
    sourceLocaleMirror:'en'
  },
  status:{
    verified:audited.filter(x=>x.status==='verified').length,
    machineDraft:audited.filter(x=>x.status==='machine-draft').length,
    untranslated:untranslated.length
  },
  deterministicAudit:{
    result:failures.length?'FAIL':'PASS',
    jsonParsing:failures.some(x=>x.includes('INVALID_JSON'))?'FAIL':'PASS',
    exactKeySet:failures.some(x=>x.includes('MISSING_KEYS')||x.includes('EXTRA_KEYS'))?'FAIL':'PASS',
    fullCoverage:failures.some(x=>x.includes('EMPTY_VALUES'))?'FAIL':'PASS',
    nfcUnicode:failures.some(x=>x.includes('NFC_DRIFT'))?'FAIL':'PASS',
    replacementCharacter:failures.some(x=>x.includes('REPLACEMENT_CHARACTER'))?'FAIL':'PASS',
    bidiControls:failures.some(x=>x.includes('BIDI_UNBALANCED'))?'FAIL':'PASS',
    placeholderParity:failures.some(x=>x.includes('PLACEHOLDER_PARITY'))?'FAIL':'PASS',
    fixedInvariantValues:failures.some(x=>x.includes('FIXED_VALUE_DRIFT'))?'FAIL':'PASS',
    preservedTechnicalTerminology:failures.some(x=>x.includes('TERM_PRESERVATION'))?'FAIL':'PASS',
    translatableSourceCopy:failures.some(x=>x.includes('TRANSLATABLE_SOURCE_COPY'))?'FAIL':'PASS',
    localeCanonicalization:failures.some(x=>x.includes('BCP47_CANONICAL'))?'FAIL':'PASS',
    localeDirectionAgainstIntl:failures.some(x=>x.includes('DIRECTION'))?'FAIL':'PASS',
    pluralCategoriesAgainstIntl:failures.some(x=>x.includes('PLURAL_CATEGORIES'))?'FAIL':'PASS'
  },
  humanLanguageQuality:{
    certification:'NOT_PERFORMED_BY_THIS_AUDIT',
    humanReviewRequired:true,
    warning:'This deterministic machine audit does not establish human-level grammar, style, cultural appropriateness, terminology preference, or native-speaker acceptance. Machine-draft catalogs must not be represented as human-reviewed or professionally certified because this audit passed.'
  },
  runtimeIntlObservation:{
    unsupportedLocales:intlUnsupported
  },
  catalogs:results,
  warnings
};

fs.writeFileSync(path.join(I18N,'FORENSIC_LINGUISTIC_AUDIT_114.json'),JSON.stringify(report,null,2)+'\n','utf8');

if (failures.length) {
  console.error('FORENSIC I18N AUDIT FAIL: '+failures.length);
  for (const f of failures.slice(0,120)) console.error('- '+f);
  process.exitCode=1;
} else {
  console.log('FORENSIC I18N AUDIT PASS: 114 catalogs / 11514 entries; deterministic checks passed.');
  console.log('HUMAN REVIEW STATUS: not performed by this audit; human linguistic review remains required.');
}
