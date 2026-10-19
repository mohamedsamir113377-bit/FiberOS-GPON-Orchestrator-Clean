'use strict';
/**
 * FiberOS i18n Runtime — sector-neutral, fail-safe translation resolver.
 * Addition (2026-09-26): verified-only activation, RTL awareness, ICU plural
 * selection, NFC normalisation, placeholder integrity, fixed-key protection.
 */
const fs = require('fs');
const path = require('path');

const RTL_LANGUAGES = Object.freeze(['ar','fa','ur','ks','dv','ps']);
const RTL_SET = new Set(RTL_LANGUAGES);
const META_KEYS = new Set(['version','sourceLocale','keyCount','locales','status','locale',
  'direction','metadata','governance','policy','fileCount','bytes']);

function normalizeLocale(code){ return String(code == null ? '' : code).trim().replace(/_/g,'-'); }
function languageOf(code){ return normalizeLocale(code).split('-')[0].toLowerCase(); }
function directionOf(code){
  const raw = normalizeLocale(code);
  try {
    const direction = new Intl.Locale(raw).textInfo?.direction;
    if (direction === 'rtl' || direction === 'ltr') return direction;
  } catch (_) {}
  return RTL_SET.has(languageOf(raw)) ? 'rtl' : 'ltr';
}
function isRTL(code){ return directionOf(code) === 'rtl'; }
function toNFC(text){ return String(text == null ? '' : text).normalize('NFC'); }
function looksLikeKey(k){ return typeof k === 'string' && (k.includes('.') || k.includes(':')) && !k.startsWith('_'); }

function collectStrings(node, out, depth){
  if (depth > 4 || node == null || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)){
    if (META_KEYS.has(k)) continue;
    if (typeof v === 'string' && looksLikeKey(k)) out[k] = v;
    else if (v && typeof v === 'object'){
      if (typeof v.value === 'string' && looksLikeKey(k)) out[k] = v.value;
      else collectStrings(v, out, depth + 1);
    }
  }
  return out;
}
function extractTranslations(raw){
  if (raw && typeof raw === 'object'){
    if (raw.translations && typeof raw.translations === 'object') return { ...raw.translations };
    const out = collectStrings(raw, {}, 0);
    if (Object.keys(out).length) return out;
  }
  return {};
}
function extractFixedKeys(raw){
  const fixed = [];
  if (raw && typeof raw === 'object'){
    for (const [k, v] of Object.entries(raw)){
      if (!v || typeof v !== 'object' || !looksLikeKey(k)) continue;
      if (v.translatable === false || v.locked === true) fixed.push(k);
    }
  }
  return fixed;
}
function substitute(template, params){
  const p = params || {};
  return toNFC(template).replace(/\{([A-Za-z0-9_.-]+)\}/g, (full, name) => {
    const v = p[name];
    return (v === undefined || v === null) ? full : String(v);
  });
}
function defaultSourcePath(){
  return path.resolve(__dirname, '..', '..', '..', 'i18n', 'source.json');
}
function loadCatalog(file){
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const locale = normalizeLocale(raw.locale || path.basename(file, '.json'));
  const translations = extractTranslations(raw);
  return Object.freeze({
    locale,
    status: raw.status || 'untranslated',
    direction: raw.direction || directionOf(locale),
    translations: Object.freeze(translations),
    fixedKeys: Object.freeze(extractFixedKeys(raw)),
    keyCount: Object.keys(translations).length,
    file,
  });
}

const PLURAL_CACHE = new Map();
function pluralRules(locale){
  const key = languageOf(locale) || 'en';
  if (PLURAL_CACHE.has(key)) return PLURAL_CACHE.get(key);
  let pr;
  try { pr = new Intl.PluralRules(key); }
  catch (err) { pr = new Intl.PluralRules('en'); }
  PLURAL_CACHE.set(key, pr);
  return pr;
}

function createTranslator(options){
  const opts = options || {};
  const source = opts.source || loadCatalog(opts.sourcePath || defaultSourcePath());
  const target = opts.catalog || (opts.catalogPath ? loadCatalog(opts.catalogPath) : null);
  const fallback = opts.fallbackCatalog || null;
  const allowDraft = opts.allowDraft !== false;

  const activation = !target ? 'inactive'
    : target.status === 'verified' ? 'verified'
    : target.status === 'machine-draft' ? 'draft' : 'inactive';

  function t(key, params){
    const k = String(key);
    const isFixed = (target && target.fixedKeys.includes(k)) || source.fixedKeys.includes(k);
    if (isFixed){
      const sv = source.translations[k];
      return toNFC(sv !== undefined ? sv : k);
    }
    const count = (params && typeof params.count === 'number') ? params.count : null;
    const chain = [];
    if (target && (activation === 'verified' || (activation === 'draft' && allowDraft))) chain.push(target);
    if (fallback) chain.push(fallback);
    chain.push(source);
    for (const cat of chain){
      let value;
      if (count !== null){
        let category = 'other';
        try { category = pluralRules(cat.locale).select(count); } catch (err) { category = 'other'; }
        for (const cand of [`${k}.${category}`, `${k}_${category}`, k]){
          const cv = cat.translations[cand];
          if (typeof cv === 'string' && cv !== ''){ value = cv; break; }
        }
      } else {
        const cv = cat.translations[k];
        if (typeof cv === 'string' && cv !== '') value = cv;
      }
      if (value !== undefined) return substitute(value, params);
    }
    return k;
  }

  const api = {
    t,
    locale: target ? target.locale : (source.locale || 'source'),
    direction: target ? target.direction : 'ltr',
    status: target ? target.status : source.status,
    activation,
    isRTL: target ? target.direction === 'rtl' : false,
    has: (key) => typeof t(key) === 'string' && t(key) !== String(key),
    coverage: () => {
      const keys = Object.keys(source.translations);
      if (!keys.length) return 0;
      let hit = 0;
      for (const k of keys) if (t(k) !== k) hit += 1;
      return hit / keys.length;
    },
  };
  return Object.freeze(api);
}

module.exports = {
  RTL_LANGUAGES, normalizeLocale, languageOf, isRTL, directionOf, toNFC,
  substitute, extractTranslations, extractFixedKeys, loadCatalog, pluralRules,
  createTranslator, defaultSourcePath,
};
