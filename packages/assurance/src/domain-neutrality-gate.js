'use strict';

/**
 * Domain-Neutrality Gate — FiberOS R14.1 Sales Core
 *
 * Purpose (truth-bound):
 * When the package is positioned for general multi-buyer use, prevent
 * FTTH/GPON/OLT/ONT/OTDR/PON/splitter language from appearing as core claims.
 * FTTH-specific source code is retained for sector buyers under an explicit
 * profile; this gate only protects marketing, capability registry, UI labels
 * and sales surfaces from over-claiming domain-specific features as universal.
 *
 * Fail-closed for the listed terms when mode is multi-buyer or domain-neutral.
 * Does not delete or break existing optical modules.
 *
 * Usage:
 *   const { check, FORBIDDEN_TERMS, isDomainNeutralMode } = require('./domain-neutrality-gate');
 *   const result = check(text, { mode: process.env.FIBEROS_DOMAIN_MODE || 'multi-buyer' });
 *   if (!result.ok) { handle violation }
 */

const FORBIDDEN_TERMS = Object.freeze([
  'ftth',
  'gpon',
  'xgpon',
  'xgs-pon',
  'olt',
  'ont',
  'onu',
  'otdr',
  'pon',
  'splitter',
  'odn',
  'fat',
  'fdt',
  'pfp',
  'mdf',
  'optical line terminal',
  'optical network terminal',
  'optical network unit',
]);

const DOMAIN_NEUTRAL_MODES = new Set(['multi-buyer', 'domain-neutral', 'general']);

/**
 * @param {string} text
 * @param {{ mode?: string, caseSensitive?: boolean }} [opts]
 * @returns {{ ok: boolean, mode: string, hits: Array<{term: string, index: number}>, message?: string }}
 */
function check(text, opts = {}) {
  const mode = (opts.mode || process.env.FIBEROS_DOMAIN_MODE || 'multi-buyer').toLowerCase().trim();
  const caseSensitive = Boolean(opts.caseSensitive);

  if (!DOMAIN_NEUTRAL_MODES.has(mode)) {
    return { ok: true, mode, hits: [], message: 'Gate inactive (sector / FTTH profile selected)' };
  }

  if (typeof text !== 'string' || text.length === 0) {
    return { ok: true, mode, hits: [] };
  }

  const haystack = caseSensitive ? text : text.toLowerCase();
  const hits = [];

  for (const term of FORBIDDEN_TERMS) {
    const needle = caseSensitive ? term : term.toLowerCase();
    let from = 0;
    while (true) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      const before = idx === 0 ? ' ' : haystack[idx - 1];
      const after = idx + needle.length >= haystack.length ? ' ' : haystack[idx + needle.length];
      const isBoundary = /[\s\-_/.,;:()[\]{}'"<>|]/.test(before) && /[\s\-_/.,;:()[\]{}'"<>|]/.test(after);
      if (isBoundary || needle.length >= 4) {
        hits.push({ term, index: idx });
      }
      from = idx + 1;
    }
  }

  if (hits.length === 0) {
    return { ok: true, mode, hits: [] };
  }

  const unique = [...new Set(hits.map((h) => h.term))];
  return {
    ok: false,
    mode,
    hits,
    message: `Domain-neutrality violation (mode=${mode}): forbidden term(s) [${unique.join(', ')}]`,
  };
}

function isDomainNeutralMode(mode) {
  const m = (mode || process.env.FIBEROS_DOMAIN_MODE || 'multi-buyer').toLowerCase().trim();
  return DOMAIN_NEUTRAL_MODES.has(m);
}

function checkMany(texts, opts = {}) {
  const results = [];
  for (const t of texts) {
    const r = check(String(t), opts);
    if (!r.ok) results.push(r);
  }
  if (results.length === 0) {
    return { ok: true, failures: [] };
  }
  return {
    ok: false,
    failures: results,
    message: `${results.length} domain-neutrality violation(s)`,
  };
}

module.exports = {
  FORBIDDEN_TERMS,
  DOMAIN_NEUTRAL_MODES,
  check,
  checkMany,
  isDomainNeutralMode,
};
