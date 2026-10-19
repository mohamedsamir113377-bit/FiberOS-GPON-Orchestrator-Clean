'use strict';

const crypto = require('crypto');

const TRUTH_STATES = Object.freeze([
  'KNOWN', 'UNKNOWN', 'CONFLICTED', 'STALE', 'UNVERIFIED', 'CAPABILITY_UNAVAILABLE'
]);
const SOURCES = Object.freeze([
  'field_reading', 'nms_poll', 'otdr_file', 'photo_ocr', 'manual_entry',
  'gis', 'inventory', 'customer_service', 'system', 'ai_simulated'
]);

const DOMAIN_NEUTRAL_SOURCES = Object.freeze([
  'field_reading', 'photo_ocr', 'manual_entry', 'gis', 'inventory',
  'customer_service', 'system'
]);

const DOMAIN_NEUTRAL_MODES = new Set(['multi-buyer', 'domain-neutral', 'general']);

function sourceAllowedInMode(source, mode = 'multi-buyer') {
  const normalizedMode = String(mode || 'multi-buyer').trim().toLowerCase();
  if (!DOMAIN_NEUTRAL_MODES.has(normalizedMode)) return SOURCES.includes(String(source));
  return DOMAIN_NEUTRAL_SOURCES.includes(String(source));
}

function assertSourceAllowedInMode(source, mode = 'multi-buyer') {
  if (!sourceAllowedInMode(source, mode)) {
    const e = new Error('FACT_SOURCE_NOT_ALLOWED_IN_DOMAIN_NEUTRAL_MODE');
    e.code = 'FACT_SOURCE_NOT_ALLOWED_IN_DOMAIN_NEUTRAL_MODE';
    throw e;
  }
  return true;
}

function assertNonEmpty(value, code) {
  if (value === undefined || value === null || String(value).trim() === '') {
    const e = new Error(code); e.code = code; throw e;
  }
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.keys(value).sort().reduce((o, k) => { o[k] = canonical(value[k]); return o; }, {});
}

function hashFact(fact) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(fact))).digest('hex');
}

function createFact(input) {
  input = input || {};
  assertNonEmpty(input.subjectType, 'FACT_SUBJECT_TYPE_REQUIRED');
  assertNonEmpty(input.subjectId, 'FACT_SUBJECT_ID_REQUIRED');
  assertNonEmpty(input.source, 'FACT_SOURCE_REQUIRED');
  if (!SOURCES.includes(String(input.source))) {
    const e = new Error('FACT_SOURCE_UNSUPPORTED'); e.code = 'FACT_SOURCE_UNSUPPORTED'; throw e;
  }
  if (input.mode !== undefined && input.mode !== null) {
    assertSourceAllowedInMode(input.source, input.mode);
  }
  const observedAt = new Date(input.observedAt || Date.now());
  if (Number.isNaN(observedAt.getTime())) { const e = new Error('FACT_OBSERVED_AT_INVALID'); e.code = 'FACT_OBSERVED_AT_INVALID'; throw e; }
  const confidence = input.confidence == null ? null : Number(input.confidence);
  if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    const e = new Error('FACT_CONFIDENCE_OUT_OF_RANGE'); e.code = 'FACT_CONFIDENCE_OUT_OF_RANGE'; throw e;
  }
  const state = input.state || (input.value === undefined || input.value === null ? 'UNKNOWN' : 'KNOWN');
  if (!TRUTH_STATES.includes(state)) { const e = new Error('FACT_STATE_UNSUPPORTED'); e.code = 'FACT_STATE_UNSUPPORTED'; throw e; }
  const fact = {
    factId: input.factId || crypto.randomUUID(),
    subjectType: String(input.subjectType),
    subjectId: String(input.subjectId),
    attribute: input.attribute == null ? null : String(input.attribute),
    value: input.value === undefined ? null : input.value,
    unit: input.unit == null ? null : String(input.unit),
    source: String(input.source),
    observedAt: observedAt.toISOString(),
    ingestedAt: new Date().toISOString(),
    confidence,
    state,
    provenance: input.provenance || {},
    supersedesFactId: input.supersedesFactId || null
  };
  fact.contentHash = hashFact(fact);
  return Object.freeze(fact);
}

function freshness(fact, now, maxAgeSeconds) {
  const t = new Date(fact && fact.observedAt).getTime();
  const n = new Date(now || Date.now()).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return { fresh: false, reason: 'INVALID_TIME' };
  const ageSeconds = Math.max(0, (n - t) / 1000);
  return { fresh: ageSeconds <= Number(maxAgeSeconds), ageSeconds, maxAgeSeconds: Number(maxAgeSeconds) };
}

module.exports = {
  TRUTH_STATES,
  SOURCES,
  DOMAIN_NEUTRAL_SOURCES,
  DOMAIN_NEUTRAL_MODES: Object.freeze([...DOMAIN_NEUTRAL_MODES]),
  sourceAllowedInMode,
  assertSourceAllowedInMode,
  canonical,
  hashFact,
  createFact,
  freshness
};
