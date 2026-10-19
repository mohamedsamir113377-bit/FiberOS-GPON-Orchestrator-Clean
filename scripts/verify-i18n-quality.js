'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const I18N = path.join(ROOT, 'i18n');
const source = JSON.parse(fs.readFileSync(path.join(I18N, 'source.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(I18N, 'manifest.json'), 'utf8'));
const metadata = JSON.parse(fs.readFileSync(path.join(I18N, 'locale-metadata.json'), 'utf8'));
const terminology = JSON.parse(fs.readFileSync(path.join(I18N, 'terminology.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(I18N, 'QUALITY_POLICY.json'), 'utf8'));
const formattingFallbacks = metadata.formattingFallbackPolicy?.fallbackLocaleByCode || {};
const catalogsDir = path.join(I18N, 'catalogs');

const args = new Set(process.argv.slice(2));
const strictRuntimeFormatting = args.has('--require-runtime-formatting');
const strictRuntimePluralParity = args.has('--require-runtime-plural-parity');
const strictAllVerified = args.has('--require-all-verified');

let failures = [];
let warnings = [];
const report = {
  version: policy.version,
  locales: {},
  totals: {
    localeCount: manifest.locales.length,
    keyCount: Object.keys(source.keys).length,
    verified: 0,
    warning: 0,
    untranslated: 0,
    invalid: 0,
    runtimeIntlUnsupported: 0,
    runtimeIntlPartial: 0,
    sourceCopyViolations: 0,
    placeholderViolations: 0,
    unicodeViolations: 0,
    terminologyViolations: 0
  },
  pass: false
};

function fail(message, code = 'I18N_QUALITY') { failures.push({ code, message }); }
function warn(message, code = 'I18N_QUALITY_WARNING') { warnings.push({ code, message }); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`${path.relative(ROOT, file)}: invalid JSON: ${e.message}`, 'INVALID_JSON'); return null; } }
function sorted(values) { return [...values].sort(); }
function sameArray(a, b) { const x=sorted(a), y=sorted(b); return x.length===y.length && x.every((v,i)=>v===y[i]); }
function canonicalLocale(value) { try { return new Intl.Locale(value).toString(); } catch (_) { return null; } }
function baseLanguage(value) { const canonical=canonicalLocale(value); return canonical ? canonical.split('-')[0].toLowerCase() : null; }
function extractPlaceholders(value) {
  if (typeof value !== 'string') return [];
  const tokens=[];
  const patterns=[
    /\{[^{}]+\}/g,
    /\$\{[^}]+\}/g,
    /%\d*\$?[sdif]/g,
    /https?:\/\/[^\s)]+/g
  ];
  for (const p of patterns) tokens.push(...(value.match(p)||[]));
  return tokens.sort();
}
function multisetEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function bidiBalanced(value) {
  const stack=[];
  const pairs={'\u202A':'LRE','\u202B':'RLE','\u202D':'LRO','\u202E':'RLO','\u2066':'LRI','\u2067':'RLI','\u2068':'FSI'};
  const marks=new Set(Object.keys(pairs));
  for (const ch of value) {
    if (marks.has(ch)) stack.push(pairs[ch]);
    else if (ch==='\u202C') { if (!['LRE','RLE','LRO','RLO'].includes(stack.pop())) return false; }
    else if (ch==='\u2069') { if (!['LRI','RLI','FSI'].includes(stack.pop())) return false; }
  }
  return stack.length===0;
}
function sourceCopyAllowed(key) { return source.keyMetadata?.[key]?.translatable === false; }

if (!policy.requiredArtifacts.every(p => fs.existsSync(path.join(ROOT, p)))) {
  for (const p of policy.requiredArtifacts) if (!fs.existsSync(path.join(ROOT,p))) fail(`Missing required artifact: ${p}`, 'MISSING_ARTIFACT');
}

const expectedKeys = Object.keys(source.keys);
const expectedKeySet = new Set(expectedKeys);
const sourceKeys = new Set(expectedKeys.filter(k => source.keyMetadata?.[k]?.translatable === false));
const runtimeLocales = manifest.locales;
const targetLocales = runtimeLocales.filter(l => l !== policy.sourceLocale);
if (runtimeLocales.length !== policy.requiredLocaleCount || new Set(runtimeLocales).size !== runtimeLocales.length) fail(`Manifest locale count must be exactly ${policy.requiredLocaleCount}`, 'LOCALE_COUNT');
if (targetLocales.length !== policy.requiredTargetLocaleCount) fail(`Non-source runtime locale count must be exactly ${policy.requiredTargetLocaleCount}`, 'TARGET_LOCALE_COUNT');
if (!sameArray(runtimeLocales, metadata.locales.map(x=>x.code))) fail('Manifest and locale metadata locale sets differ', 'METADATA_LOCALE_PARITY');
if (expectedKeys.length !== policy.requiredKeyCount || manifest.keyCount !== expectedKeys.length) fail('Source/manifest key count mismatch', 'KEY_COUNT');

const metadataByLocale = new Map(metadata.locales.map(x=>[x.code,x]));
const catalogFiles = new Set(fs.readdirSync(catalogsDir).filter(n=>n.endsWith('.json')).map(n=>n.slice(0,-5)));
for (const extra of [...catalogFiles].filter(l=>!runtimeLocales.includes(l) && l !== 'source')) warn(`Extra non-runtime catalog file present: ${extra}.json`, 'EXTRA_CATALOG');

for (const locale of runtimeLocales) {
  const m = metadataByLocale.get(locale);
  const file = path.join(catalogsDir, `${locale}.json`);
  const cat = readJson(file);
  const item = { status: cat?.status || 'invalid', coverage: 0, intl: {}, sourceCopies: [], placeholders: [], unicode: [], terminology: [], errors: [] };
  report.locales[locale] = item;
  if (!m) { fail(`${locale}: missing locale metadata`, 'MISSING_METADATA'); continue; }
  if (!cat) { report.totals.invalid++; continue; }
  if (cat.locale !== locale) fail(`${locale}: catalog locale mismatch`, 'CATALOG_LOCALE');
  if (cat.sourceLocale !== manifest.sourceLocale) fail(`${locale}: catalog sourceLocale mismatch`, 'CATALOG_SOURCE_LOCALE');
  const translations = cat.translations && typeof cat.translations === 'object' ? cat.translations : null;
  if (!translations) { fail(`${locale}: translations object missing`, 'TRANSLATIONS_OBJECT'); continue; }

  const keys = Object.keys(translations);
  const missing = expectedKeys.filter(k=>!Object.prototype.hasOwnProperty.call(translations,k));
  const extra = keys.filter(k=>!expectedKeySet.has(k));
  if (cat.status !== 'untranslated' && missing.length) fail(`${locale}: ${missing.length} missing keys`, 'MISSING_KEYS');
  if (extra.length) fail(`${locale}: ${extra.length} unknown keys`, 'EXTRA_KEYS');

  let nonEmpty=0;
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(translations,key)) continue;
    const value=translations[key];
    if (typeof value !== 'string') { if (cat.status !== 'untranslated') fail(`${locale}:${key}: non-string value`, 'TYPE'); continue; }
    if (value.trim()) nonEmpty++;
    if (cat.status !== 'untranslated' && !value.trim()) fail(`${locale}:${key}: empty translation`, 'EMPTY');
    if (policy.validation.requireNfcUnicode && value.normalize('NFC') !== value) { item.unicode.push(key); report.totals.unicodeViolations++; }
    if (policy.validation.rejectReplacementCharacter && value.includes('\uFFFD')) { item.unicode.push(key); report.totals.unicodeViolations++; }
    if (policy.validation.rejectUnbalancedBidiControls && !bidiBalanced(value)) { item.unicode.push(key); report.totals.unicodeViolations++; }
    if (!sourceCopyAllowed(key) && locale !== policy.sourceLocale && cat.status !== 'untranslated' && value === source.keys[key]) item.sourceCopies.push(key);
    if (!multisetEqual(extractPlaceholders(source.keys[key]), extractPlaceholders(value))) item.placeholders.push(key);
    const terms=(terminology.terms||[]).filter(t=>t.preserve && typeof t.source==='string' && source.keys[key].includes(t.source));
    for (const t of terms) if (value !== source.keys[key] && !value.includes(t.source)) item.terminology.push(`${key}:${t.source}`);
  }
  item.coverage=expectedKeys.length ? Math.round(nonEmpty/expectedKeys.length*100) : 100;
  if (cat.verifiedCoverage !== undefined && cat.verifiedCoverage !== item.coverage && cat.status !== 'untranslated') fail(`${locale}: verifiedCoverage=${cat.verifiedCoverage} but actual=${item.coverage}`, 'COVERAGE');
  if (cat.status === 'verified' && item.coverage !== 100) fail(`${locale}: verified requires 100% coverage`, 'VERIFIED_COVERAGE');
  if (item.sourceCopies.length) { report.totals.sourceCopyViolations += item.sourceCopies.length; fail(`${locale}: source-copy violations: ${item.sourceCopies.join(', ')}`, 'SOURCE_COPY'); }
  if (item.placeholders.length) { report.totals.placeholderViolations += item.placeholders.length; fail(`${locale}: placeholder violations: ${item.placeholders.join(', ')}`, 'PLACEHOLDER'); }
  if (item.unicode.length) fail(`${locale}: Unicode/bidi violations: ${[...new Set(item.unicode)].join(', ')}`, 'UNICODE');
  if (item.terminology.length) { report.totals.terminologyViolations += item.terminology.length; fail(`${locale}: preserved terminology lost: ${item.terminology.join(', ')}`, 'TERMINOLOGY'); }

  try {
    const canonical=canonicalLocale(locale);
    item.intl.canonical=canonical;
    if (policy.validation.validateBcp47Canonicalization && canonical !== locale && policy.canonicalAliases?.[locale] !== canonical) fail(`${locale}: canonical BCP-47 form is ${canonical}`, 'BCP47');
    const loc=new Intl.Locale(locale);
    const direction=loc.textInfo?.direction;
    item.intl.direction=direction || null;
    if (direction && direction !== m.direction) fail(`${locale}: metadata direction=${m.direction} but Intl reports ${direction}`, 'DIRECTION');
    const plural=new Intl.PluralRules(locale).resolvedOptions();
    item.intl.pluralCategories=plural.pluralCategories;
    item.intl.pluralResolvedLocale=plural.locale;
    if (policy.validation.validatePluralCategoriesAgainstIntlWhenAvailable && baseLanguage(plural.locale)===baseLanguage(locale) && !sameArray(plural.pluralCategories,m.pluralCategories)) { const message=`${locale}: plural categories differ from runtime Intl: metadata=${m.pluralCategories.join(',')} runtime=${plural.pluralCategories.join(',')}`; if (strictRuntimePluralParity) fail(message, 'PLURAL'); else warn(message, 'PLURAL_RUNTIME_DRIFT'); }
    const dt=Intl.DateTimeFormat.supportedLocalesOf([locale]);
    const nf=Intl.NumberFormat.supportedLocalesOf([locale]);
    item.intl.dateTimeFormatSupported=dt.includes(canonical);
    item.intl.numberFormatSupported=nf.includes(canonical);
    const fallbackLocale = formattingFallbacks[locale] || null;
    item.intl.formattingFallbackLocale = fallbackLocale;
    let fallbackSupported = false;
    if (fallbackLocale) {
      const fc = canonicalLocale(fallbackLocale);
      fallbackSupported = Intl.DateTimeFormat.supportedLocalesOf([fallbackLocale]).includes(fc) && Intl.NumberFormat.supportedLocalesOf([fallbackLocale]).includes(fc);
    }
    item.intl.formattingResolved = item.intl.dateTimeFormatSupported && item.intl.numberFormatSupported ? canonical : (fallbackSupported ? fallbackLocale : null);
    if (!item.intl.dateTimeFormatSupported || !item.intl.numberFormatSupported) {
      report.totals.runtimeIntlUnsupported++;
      if (fallbackSupported) warn(`${locale}: native Intl formatting data unavailable; deterministic formatting fallback=${fallbackLocale}`, 'INTL_FORMAT_FALLBACK');
      else warn(`${locale}: runtime Intl lacks native formatting data and no valid deterministic fallback is configured`, 'INTL_FORMAT_FALLBACK');
    }
    if (strictRuntimeFormatting && !item.intl.formattingResolved) fail(`${locale}: production runtime formatting has neither native Intl support nor a validated deterministic fallback`, 'INTL_FORMAT_FALLBACK');
  } catch (e) {
    fail(`${locale}: Intl validation failed: ${e.message}`, 'INTL');
  }

  if (cat.status==='verified') report.totals.verified++;
  else if (cat.status==='untranslated') report.totals.untranslated++;
  else if (cat.status==='invalid') report.totals.invalid++;
  else report.totals.warning++;
}

// Verify web mirrors are exact copies of the canonical i18n runtime contract.
for (const mirror of policy.publicMirrors) {
  const mirrorRoot=path.join(ROOT,mirror);
  if (!fs.existsSync(mirrorRoot)) { fail(`Missing public i18n mirror: ${mirror}`, 'MISSING_MIRROR'); continue; }
  for (const rel of ['manifest.json','source.json','locale-metadata.json','QUALITY_POLICY.json']) {
    const canonical=path.join(I18N,rel), target=path.join(mirrorRoot,rel);
    if (!fs.existsSync(target)) { fail(`${mirror}: missing ${rel}`, 'MIRROR_MISSING_FILE'); continue; }
    if (fs.readFileSync(canonical,'utf8')!==fs.readFileSync(target,'utf8')) fail(`${mirror}: ${rel} differs from canonical i18n/${rel}`, 'MIRROR_DRIFT');
  }
  // Full locale catalogs have one canonical source under /i18n/catalogs and are
  // copied by the website builder to the published root /i18n path. The app-local
  // public trees must contain only the verified Arabic fallback; copying all
  // machine-draft catalogs into each app creates stale duplicate assets.
  const targetDir=path.join(mirrorRoot,'catalogs');
  if (!fs.existsSync(targetDir)) {
    fail(`${mirror}: missing app-local Arabic fallback directory`, 'MISSING_FALLBACK_DIR');
    continue;
  }
  const localCatalogFiles=fs.readdirSync(targetDir).filter(n=>n.endsWith('.json')).sort();
  if (!sameArray(localCatalogFiles,['ar.json'])) {
    fail(`${mirror}: app-local catalogs must contain only ar.json; canonical locale catalogs belong in /i18n/catalogs`, 'APP_LOCAL_CATALOG_DUPLICATES');
    continue;
  }
  const canonicalArabic=path.join(catalogsDir,'ar.json');
  const targetArabic=path.join(targetDir,'ar.json');
  if (!fs.existsSync(canonicalArabic) || !fs.existsSync(targetArabic)) {
    fail(`${mirror}: Arabic fallback is missing`, 'MIRROR_ARABIC_MISSING');
  } else if (fs.readFileSync(canonicalArabic,'utf8')!==fs.readFileSync(targetArabic,'utf8')) {
    fail(`${mirror}: Arabic fallback differs from canonical catalog`, 'MIRROR_ARABIC_DRIFT');
  }
}

if (strictAllVerified) {
  for (const locale of runtimeLocales) {
    const cat=report.locales[locale];
    if (!cat || cat.status!=='verified') fail(`${locale}: release localization gate requires status=verified`, 'NOT_VERIFIED');
  }
}

report.pass=failures.length===0;
const reportPath=path.join(I18N,'QUALITY_GATE_REPORT.json');
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n','utf8');

if (failures.length) {
  console.error(`I18N QUALITY GATE FAIL: ${failures.length} failure(s)`);
  for (const f of failures.slice(0,80)) console.error(`- [${f.code}] ${f.message}`);
  if (failures.length>80) console.error(`- ... ${failures.length-80} more failure(s)`);
  process.exitCode=1;
} else {
  console.log(`I18N QUALITY GATE PASS: ${report.totals.localeCount} locales, ${report.totals.keyCount} keys, ${report.totals.verified} verified, ${report.totals.untranslated} untranslated.`);
  if (warnings.length) {
    console.log(`I18N QUALITY GATE WARNINGS: ${warnings.length}`);
    for (const w of warnings.slice(0,40)) console.log(`- [${w.code}] ${w.message}`);
    if (warnings.length>40) console.log(`- ... ${warnings.length-40} more warning(s)`);
  }
}
