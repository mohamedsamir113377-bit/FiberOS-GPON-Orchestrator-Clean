#!/usr/bin/env node
'use strict';

/**
 * FiberOS — atomic linguistic localization audit.
 *
 * This is a deterministic machine forensic audit, not a human linguistic review.
 * It inspects every Unicode code point in every translated value of every
 * non-untranslated runtime catalog and validates the runtime localization
 * contract. It must never promote a machine-draft catalog to verified.
 */

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const ROOT=path.resolve(__dirname,'..');
const I18N=path.join(ROOT,'i18n');
const CATALOGS=path.join(I18N,'catalogs');

const source=JSON.parse(fs.readFileSync(path.join(I18N,'source.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(I18N,'manifest-114.generated.json'),'utf8'));
const metadata=JSON.parse(fs.readFileSync(path.join(I18N,'locale-metadata.json'),'utf8'));
const terminology=JSON.parse(fs.readFileSync(path.join(I18N,'terminology.json'),'utf8'));

const sourceKeys=source.keys;
const sourceKeyNames=Object.keys(sourceKeys);
const fixedKeys=new Set(Object.entries(source.keyMetadata||{})
  .filter(([,v])=>v && v.translatable===false)
  .map(([k])=>k));
const preservedTerms=(terminology.terms||[])
  .filter(t=>t && t.preserve && typeof t.source==='string')
  .map(t=>t.source);

const failures=[];
const warnings=[];
const catalogs=[];
const metadataByLocale=new Map((metadata.locales||[]).map(x=>[x.code,x]));
const expectedLocales=manifest.locales.filter(x=>x.status!=='untranslated').map(x=>x.locale);

function sha256(text){
  return crypto.createHash('sha256').update(text,'utf8').digest('hex');
}

/** Decimal digit values (0-9) from any Nd script block — semantic numeric parity. */
function decimalDigitSequence(value){
  const ZERO_BLOCKS=[
    0x0030,0x0660,0x06F0,0x07C0,0x0966,0x09E6,0x0A66,0x0AE6,0x0B66,0x0BE6,0x0C66,
    0x0CE6,0x0D66,0x0DE6,0x0E50,0x0ED0,0x0F20,0x1040,0x1090,0x17E0,0x1810,0x1946,
    0x19D0,0x1A80,0x1A90,0x1B50,0x1BB0,0x1C40,0x1C50,0xA620,0xA8D0,0xA900,0xA9D0,
    0xA9F0,0xAA50,0xABF0,0xFF10
  ];
  const out=[];
  for(const ch of String(value)){
    if(!/\p{Nd}/u.test(ch)) continue;
    const cp=ch.codePointAt(0);
    let v=null;
    for(const z of ZERO_BLOCKS){
      if(cp>=z && cp<=z+9){ v=cp-z; break; }
    }
    out.push(v===null?cp:v);
  }
  return out;
}

function countLiteral(value,token){
  const s=String(value);
  let n=0,p=0;
  while((p=s.indexOf(token,p))!==-1){n++;p+=token.length;}
  return n;
}
function sorted(a){return [...a].sort();}
function sameArray(a,b){
  const x=sorted(a),y=sorted(b);
  return x.length===y.length&&x.every((v,i)=>v===y[i]);
}
function placeholders(value){
  if(typeof value!=='string') return [];
  const out=[];
  for(const re of [
    /\$\{[^}]+\}/g,
    /\{[^{}]+\}/g,
    /%\d*\$?[sdif]/g
  ]) out.push(...(value.match(re)||[]));
  return out.sort();
}
function bidiBalanced(value){
  const stack=[];
  const openToClose=new Map([
    [0x202A,0x202C],[0x202B,0x202C],[0x202D,0x202C],[0x202E,0x202C],
    [0x2066,0x2069],[0x2067,0x2069],[0x2068,0x2069]
  ]);
  const closers=new Set([0x202C,0x2069]);
  for(const ch of String(value)){
    const cp=ch.codePointAt(0);
    if(openToClose.has(cp)) stack.push(openToClose.get(cp));
    else if(closers.has(cp) && stack.pop()!==cp) return false;
  }
  return stack.length===0;
}
function scriptProfile(value){
  const counts={};
  const detectors={
    Latin:/\p{Script=Latin}/u,
    Arabic:/\p{Script=Arabic}/u,
    Cyrillic:/\p{Script=Cyrillic}/u,
    Greek:/\p{Script=Greek}/u,
    Hebrew:/\p{Script=Hebrew}/u,
    Ethiopic:/\p{Script=Ethiopic}/u,
    Han:/\p{Script=Han}/u,
    Hiragana:/\p{Script=Hiragana}/u,
    Katakana:/\p{Script=Katakana}/u,
    Hangul:/\p{Script=Hangul}/u,
    Devanagari:/\p{Script=Devanagari}/u,
    Bengali:/\p{Script=Bengali}/u,
    Gurmukhi:/\p{Script=Gurmukhi}/u,
    Gujarati:/\p{Script=Gujarati}/u,
    Tamil:/\p{Script=Tamil}/u,
    Telugu:/\p{Script=Telugu}/u,
    Kannada:/\p{Script=Kannada}/u,
    Malayalam:/\p{Script=Malayalam}/u,
    Sinhala:/\p{Script=Sinhala}/u,
    Thai:/\p{Script=Thai}/u,
    Lao:/\p{Script=Lao}/u,
    Khmer:/\p{Script=Khmer}/u,
    Myanmar:/\p{Script=Myanmar}/u,
    Georgian:/\p{Script=Georgian}/u,
    Armenian:/\p{Script=Armenian}/u
  };
  for(const ch of [...String(value)]){
    for(const [name,re] of Object.entries(detectors)){
      if(re.test(ch)){counts[name]=(counts[name]||0)+1;break;}
    }
  }
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+':'+v);
}

if(manifest.localeCount!==114) failures.push('MANIFEST_LOCALE_COUNT');
if(sourceKeyNames.length!==101) failures.push('SOURCE_KEY_COUNT');
if(manifest.canonicalKeyCount!==101) failures.push('MANIFEST_KEY_COUNT');
const untranslatedLocales=manifest.locales.filter(x=>x.status==='untranslated');
if(expectedLocales.length!==manifest.localeCount-untranslatedLocales.length) failures.push('AUDITED_LOCALE_COUNT');
if(expectedLocales.length+untranslatedLocales.length!==manifest.localeCount) failures.push('LOCALE_PARTITION');
const declaredTally=manifest.statusTally||{};
for(const status of ['verified','machine-draft','untranslated']) {
  const actual=manifest.locales.filter(x=>x.status===status).length;
  if(declaredTally[status]!==undefined && declaredTally[status]!==actual) failures.push('STATUS_TALLY:'+status);
}

for(const locale of expectedLocales){
  const file=path.join(CATALOGS,locale+'.json');
  if(!fs.existsSync(file)){failures.push(locale+':MISSING_FILE');continue;}
  const raw=fs.readFileSync(file,'utf8');
  const digest=sha256(raw);

  let cat;
  try{cat=JSON.parse(raw);}
  catch(error){failures.push(locale+':INVALID_JSON:'+error.message);continue;}

  const tr=cat.translations;
  if(!tr || typeof tr!=='object' || Array.isArray(tr)){
    failures.push(locale+':INVALID_TRANSLATIONS_OBJECT');
    continue;
  }

  const keys=Object.keys(tr);
  const missing=sourceKeyNames.filter(k=>!(k in tr));
  const extra=keys.filter(k=>!(k in sourceKeys));

  const stats={
    locale,
    declaredStatus:cat.status,
    keyCount:keys.length,
    missing:missing.length,
    extra:extra.length,
    empty:0,
    codePoints:0,
    nonBmp:0,
    combiningMarks:0,
    controls:0,
    replacementCharacters:0,
    noncharacters:0,
    forbiddenInvisible:0,
    zwnj:0,
    zwj:0,
    bidiMarks:0,
    unbalancedBidi:0,
    leadingTrailingWhitespace:0,
    tabs:0,
    repeatedWhitespace:0,
    repeatedPunctuation:0,
    unmatchedDelimiters:0,
    placeholderMismatches:0,
    numericGroupMismatches:0,
    arrowMismatches:0,
    urlMismatches:0,
    invariantValueDrift:0,
    protectedTerminologyDrift:0,
    translatableSourceCopies:0,
    longSourceOverlapWarnings:0,
    scriptProfile:[],
    sha256:digest
  };

  const allText=[];
  for(const key of sourceKeyNames){
    if(!(key in tr)) continue;
    const sourceValue=String(sourceKeys[key]);
    const value=tr[key];

    if(typeof value!=='string' || !value.trim()){
      stats.empty++;
      if(cat.status!=='untranslated') failures.push(locale+':EMPTY:'+key);
      continue;
    }

    allText.push(value);
    if(value.trim()!==value) stats.leadingTrailingWhitespace++;
    if(value.includes('\t')) stats.tabs++;
    if(/ {2,}/.test(value)) stats.repeatedWhitespace++;
    if(/([!?.,:;،؛؟۔])\\1{1,}/u.test(value)) stats.repeatedPunctuation++;

    const cps=[...value];
    stats.codePoints+=cps.length;
    for(const ch of cps){
      const cp=ch.codePointAt(0);
      if(cp>=0x10000) stats.nonBmp++;
      if(/\p{M}/u.test(ch)) stats.combiningMarks++;
      if(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(ch)) stats.controls++;
      if(cp===0xFFFD) stats.replacementCharacters++;
      if((cp>=0xFDD0&&cp<=0xFDEF)||((cp&0xFFFF)>=0xFFFE)) stats.noncharacters++;
      if([0x200B,0xFEFF,0x2060,0x180E,0x00AD].includes(cp)) stats.forbiddenInvisible++;
      if(cp===0x200C) stats.zwnj++;
      if(cp===0x200D) stats.zwj++;
      if([0x200E,0x200F,0x202A,0x202B,0x202C,0x202D,0x202E,0x2066,0x2067,0x2068,0x2069].includes(cp)) stats.bidiMarks++;
      if(cp>=0xD800&&cp<=0xDFFF) failures.push(locale+':SURROGATE_CODE_UNIT:'+key);
    }

    if(!bidiBalanced(value)) stats.unbalancedBidi++;

    for(const [a,b] of [['(',')'],['[',']'],['{','}']]){
      if(countLiteral(value,a)!==countLiteral(value,b)) stats.unmatchedDelimiters++;
    }

    if(JSON.stringify(placeholders(sourceValue))!==JSON.stringify(placeholders(value))){
      stats.placeholderMismatches++;
    }
    if(JSON.stringify(decimalDigitSequence(sourceValue))!==JSON.stringify(decimalDigitSequence(value))){
      stats.numericGroupMismatches++;
    }
    if(countLiteral(sourceValue,'→')!==countLiteral(value,'→')) stats.arrowMismatches++;

    if((sourceValue.match(/https?:\/\/[^\s)]+/g)||[]).length!==(value.match(/https?:\/\/[^\s)]+/g)||[]).length){
      stats.urlMismatches++;
    }

    if(fixedKeys.has(key) && value!==sourceValue) stats.invariantValueDrift++;

    for(const term of preservedTerms){
      if(sourceValue.includes(term) && countLiteral(sourceValue,term)!==countLiteral(value,term)){
        stats.protectedTerminologyDrift++;
      }
    }

    if(locale!=='en' && !fixedKeys.has(key) && value===sourceValue){
      stats.translatableSourceCopies++;
    }

    const sourceWords=[...sourceValue.matchAll(/\p{L}{3,}/gu)]
      .map(m=>m[0].toLowerCase())
      .filter(w=>!preservedTerms.includes(w.toUpperCase()));
    if(sourceWords.length>=5){
      const targetWords=new Set([...value.matchAll(/\p{L}{3,}/gu)].map(m=>m[0].toLowerCase()));
      if(sourceWords.filter(w=>targetWords.has(w)).length/sourceWords.length>=0.85){
        stats.longSourceOverlapWarnings++;
      }
    }
  }

  stats.scriptProfile=scriptProfile(allText.join(' '));

  if(missing.length) failures.push(locale+':MISSING_KEYS:'+missing.join(','));
  if(extra.length) failures.push(locale+':EXTRA_KEYS:'+extra.join(','));
  if(stats.replacementCharacters) failures.push(locale+':REPLACEMENT_CHARACTER');
  if(stats.controls) failures.push(locale+':CONTROL_CHARACTER');
  if(stats.noncharacters) failures.push(locale+':NONCHARACTER');
  if(stats.forbiddenInvisible) failures.push(locale+':FORBIDDEN_INVISIBLE');
  if(stats.unbalancedBidi) failures.push(locale+':UNBALANCED_BIDI');
  if(stats.unmatchedDelimiters) failures.push(locale+':UNMATCHED_DELIMITER');
  if(stats.placeholderMismatches) failures.push(locale+':PLACEHOLDER_MISMATCH');
  if(stats.numericGroupMismatches) failures.push(locale+':NUMERIC_GROUP_MISMATCH');
  if(stats.arrowMismatches) failures.push(locale+':ARROW_MISMATCH');
  if(stats.urlMismatches) failures.push(locale+':URL_MISMATCH');
  if(stats.invariantValueDrift) failures.push(locale+':INVARIANT_VALUE_DRIFT');
  if(stats.protectedTerminologyDrift) failures.push(locale+':PROTECTED_TERM_DRIFT');
  if(stats.translatableSourceCopies) failures.push(locale+':TRANSLATABLE_SOURCE_COPY');

  const meta=metadataByLocale.get(locale);
  if(!meta) failures.push(locale+':MISSING_METADATA');
  else{
    try{
      const canonical=new Intl.Locale(locale).toString();
      if(canonical!==meta.canonical && (manifest.canonicalAliases||{})[locale]!==canonical){
        failures.push(locale+':BCP47_CANONICAL');
      }
      const direction=new Intl.Locale(locale).textInfo?.direction||null;
      if(direction && direction!==meta.direction) failures.push(locale+':DIRECTION');
      const plural=new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      if(!sameArray(plural,meta.pluralCategories||[])) failures.push(locale+':PLURAL');
      const numberSupported=Intl.NumberFormat.supportedLocalesOf([locale]).length>0;
      const dateSupported=Intl.DateTimeFormat.supportedLocalesOf([locale]).length>0;
      if(!numberSupported||!dateSupported) warnings.push(locale+':INTL_FORMATTING_RUNTIME_ADVISORY');
    }catch(error){
      failures.push(locale+':INTL_VALIDATION:'+error.message);
    }
  }

  const advisoryCount=stats.leadingTrailingWhitespace+stats.tabs+stats.repeatedWhitespace+
    stats.repeatedPunctuation+stats.bidiMarks+stats.zwnj+stats.zwj+
    stats.longSourceOverlapWarnings+stats.scriptProfile.length;
  if(advisoryCount) warnings.push(locale+':NON_FATAL_LINGUISTIC_OBSERVATIONS='+advisoryCount);

  catalogs.push(stats);
}

const report={
  schema:'fiberos.i18n.atomic-linguistic-audit.v3',
  acceptanceClass:'DETERMINISTIC_MACHINE_FORENSIC_ONLY',
  certificationWarning:'Deep multilayer machine forensic audit only; not human linguistic certification. machine-draft must remain machine-draft.',
  scope:{
    runtimeLocaleCount:manifest.localeCount,
    auditedCatalogCount:expectedLocales.length,
    excludedUntranslatedCatalogCount:manifest.locales.filter(x=>x.status==='untranslated').length,
    keysPerCatalog:sourceKeyNames.length,
    auditedEntryCells:expectedLocales.length*sourceKeyNames.length,
    auditGranularity:'every Unicode code point in every audited translation value'
  },
  result:{
    machineForensicStatus:failures.length?'FAIL':'PASS',
    humanLinguisticCertification:'NOT_PERFORMED',
    humanReviewRequired:true,
    machineDraftPromotion:'FORBIDDEN'
  },
  hardChecks:{
    json:failures.some(f=>f.includes('INVALID_JSON'))?'FAIL':'PASS',
    exactKeys:failures.some(f=>f.includes('MISSING_KEYS')||f.includes('EXTRA_KEYS'))?'FAIL':'PASS',
    completeCoverage:failures.some(f=>f.includes(':EMPTY:'))?'FAIL':'PASS',
    emptyAuditedValues:failures.some(f=>f.includes(':EMPTY:'))?'FAIL':'PASS',
    UnicodeSafety:failures.some(f=>/REPLACEMENT_CHARACTER|CONTROL_CHARACTER|NONCHARACTER|FORBIDDEN_INVISIBLE|SURROGATE_CODE_UNIT|NON_NFC/.test(f))?'FAIL':'PASS',
    BidiBalance:failures.some(f=>f.includes('UNBALANCED_BIDI'))?'FAIL':'PASS',
    delimiterBalance:failures.some(f=>f.includes('UNMATCHED_DELIMITER'))?'FAIL':'PASS',
    placeholderParity:failures.some(f=>f.includes('PLACEHOLDER_MISMATCH'))?'FAIL':'PASS',
    numericParity:failures.some(f=>f.includes('NUMERIC_GROUP_MISMATCH'))?'FAIL':'PASS',
    URLParity:failures.some(f=>f.includes('URL_MISMATCH'))?'FAIL':'PASS',
    invariantTechnicalValues:failures.some(f=>f.includes('INVARIANT_VALUE_DRIFT'))?'FAIL':'PASS',
    protectedTerminology:failures.some(f=>f.includes('PROTECTED_TERM_DRIFT'))?'FAIL':'PASS',
    translatableSourceCopy:failures.some(f=>f.includes('TRANSLATABLE_SOURCE_COPY'))?'FAIL':'PASS',
    localeMetadata:failures.some(f=>/MISSING_METADATA|BCP47|DIRECTION|PLURAL|INTL_VALIDATION/.test(f))?'FAIL':'PASS'
  },
  humanReviewWarning:'This audit is deterministic machine analysis. It does not prove native-speaker grammar, style, cultural appropriateness, terminology preference, legal wording, or professional human translation acceptance. Machine-draft catalogs must not be promoted to verified based on this audit.',
  runtimeIntlAdvisory:{warningCount:warnings.filter(x=>x.includes('INTL_FORMATTING')).length},
  remediationBaseline:'This run evaluates canonical source invariants directly; violations remain hard failures until corrected in catalog data.',
  deepAuditStatement:`${expectedLocales.length} catalogs × ${sourceKeyNames.length} keys = ${expectedLocales.length*sourceKeyNames.length} translation cells; every decoded Unicode code point is inspected by multiple deterministic layers.`,
  catalogs,
  warnings,
  failureCount:failures.length,
  failures
};

fs.writeFileSync(
  path.join(I18N,'ATOMIC_LINGUISTIC_AUDIT_114.json'),
  JSON.stringify(report,null,2)+'\n',
  'utf8'
);

if(failures.length){
  console.error('ATOMIC LINGUISTIC AUDIT FAIL: '+failures.length);
  for(const f of failures.slice(0,120)) console.error('- '+f);
  process.exitCode=1;
}else{
  console.log(`ATOMIC LINGUISTIC AUDIT PASS: ${expectedLocales.length} catalogs / ${expectedLocales.length*sourceKeyNames.length} entry cells.`);
  console.log('Every Unicode code point was inspected by deterministic rules.');
  console.log('HUMAN REVIEW STATUS: NOT PERFORMED; human linguistic review remains required.');
}
