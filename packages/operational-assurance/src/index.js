'use strict';

const crypto = require('crypto');

function assertObject(v, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`${name} must be an object`);
}
function finite(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`);
  return n;
}
function isoMs(v, name) {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new TypeError(`${name} must be an ISO timestamp`);
  return t;
}
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
function sha256(v) {
  return crypto.createHash('sha256').update(typeof v === 'string' ? v : stable(v)).digest('hex');
}

const VALID_KINDS = new Set(['counter', 'gauge', 'histogram', 'event']);
const VALID_SEVERITY = new Set(['INFO', 'WARN', 'ERROR', 'CRITICAL']);

function createTelemetryEvent(input) {
  assertObject(input, 'input');
  if (!String(input.eventId || '').trim()) throw new Error('EVENT_ID_REQUIRED');
  if (!String(input.name || '').trim()) throw new Error('METRIC_NAME_REQUIRED');
  if (!VALID_KINDS.has(input.kind)) throw new Error('METRIC_KIND_INVALID');
  if (!String(input.service || '').trim()) throw new Error('SERVICE_REQUIRED');
  if (!String(input.environment || '').trim()) throw new Error('ENVIRONMENT_REQUIRED');
  if (!String(input.source || '').trim()) throw new Error('SOURCE_REQUIRED');
  const observedAt = input.observedAt || new Date().toISOString();
  isoMs(observedAt, 'observedAt');
  const value = input.kind === 'event' ? null : finite(input.value, 'value');
  if (input.kind === 'counter' && value < 0) throw new Error('COUNTER_VALUE_NEGATIVE');
  const labels = input.labels == null ? {} : input.labels;
  assertObject(labels, 'labels');
  for (const [k, v] of Object.entries(labels)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) throw new Error('LABEL_KEY_INVALID');
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new Error('LABEL_VALUE_INVALID');
  }
  return Object.freeze({
    schemaVersion: input.schemaVersion || '1.0',
    eventId: String(input.eventId), name: String(input.name), kind: input.kind,
    service: String(input.service), environment: String(input.environment), source: String(input.source),
    observedAt, value, unit: input.unit == null ? null : String(input.unit), labels,
    severity: input.severity == null ? 'INFO' : (() => { const s = String(input.severity).toUpperCase(); if (!VALID_SEVERITY.has(s)) throw new Error('SEVERITY_INVALID'); return s; })(),
    traceId: input.traceId == null ? null : String(input.traceId), spanId: input.spanId == null ? null : String(input.spanId)
  });
}

function validateTelemetryOrder(events, {allowEqualTimestamps = false} = {}) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  let previous = -Infinity;
  const seen = new Set();
  for (const event of events) {
    const e = createTelemetryEvent(event);
    if (seen.has(e.eventId)) throw new Error('DUPLICATE_EVENT_ID');
    seen.add(e.eventId);
    const t = isoMs(e.observedAt, 'observedAt');
    if (allowEqualTimestamps ? t < previous : t <= previous) throw new Error('TELEMETRY_ORDER_INVALID');
    previous = t;
  }
  return Object.freeze({ok: true, count: events.length});
}

function assertCardinality(events, {labelKey, maxDistinct} = {}) {
  if (!String(labelKey || '').trim()) throw new TypeError('labelKey required');
  const m = Number(maxDistinct);
  if (!Number.isInteger(m) || m < 1) throw new RangeError('maxDistinct must be a positive integer');
  const distinct = new Set();
  for (const raw of events || []) {
    const e = createTelemetryEvent(raw);
    if (Object.prototype.hasOwnProperty.call(e.labels, labelKey)) distinct.add(String(e.labels[labelKey]));
  }
  if (distinct.size > m) throw new Error('CARDINALITY_LIMIT_EXCEEDED');
  return Object.freeze({ok: true, distinctCount: distinct.size, maxDistinct: m});
}

function errorBudgetSummary(events, {windowStart, windowEnd, goodPredicate} = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new RangeError('events required');
  if (typeof goodPredicate !== 'function') throw new TypeError('goodPredicate required');
  const start = isoMs(windowStart, 'windowStart');
  const end = isoMs(windowEnd, 'windowEnd');
  if (end <= start) throw new RangeError('windowEnd must be after windowStart');
  const inWindow = events.map(createTelemetryEvent).filter(e => { const t = isoMs(e.observedAt, 'observedAt'); return t >= start && t < end; });
  const good = inWindow.filter(goodPredicate).length;
  const total = inWindow.length;
  if (total === 0) throw new Error('NO_OBSERVATIONS_IN_WINDOW');
  return Object.freeze({total, good, bad: total - good, goodFraction: good / total, errorFraction: (total - good) / total, windowStart, windowEnd});
}

function evaluateSlo(summary, criteria) {
  assertObject(summary, 'summary');
  assertObject(criteria, 'criteria');
  const target = finite(criteria.minimumGoodFraction, 'minimumGoodFraction');
  if (target < 0 || target > 1) throw new RangeError('minimumGoodFraction must be within [0,1]');
  const result = summary.goodFraction >= target;
  return Object.freeze({status: result ? 'PASS' : 'FAIL', minimumGoodFraction: target, observedGoodFraction: summary.goodFraction, basis: 'observed events only'});
}

function validateAlertRule(rule) {
  assertObject(rule, 'rule');
  if (!String(rule.ruleId || '').trim()) throw new Error('RULE_ID_REQUIRED');
  if (!String(rule.metric || '').trim()) throw new Error('RULE_METRIC_REQUIRED');
  if (!['>', '>=', '<', '<=', '=='].includes(rule.operator)) throw new Error('RULE_OPERATOR_INVALID');
  finite(rule.threshold, 'threshold');
  const hold = Number(rule.forSeconds);
  if (!Number.isFinite(hold) || hold < 0) throw new Error('RULE_FOR_SECONDS_INVALID');
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) throw new Error('RULE_ACTION_REQUIRED');
  if (rule.critical === true && rule.approvalPolicy !== 'human_required') throw new Error('CRITICAL_RULE_REQUIRES_HUMAN_POLICY');
  return Object.freeze({...rule, forSeconds: hold, actions: rule.actions.slice()});
}

function createIncidentEvidence(input) {
  assertObject(input, 'input');
  if (!String(input.incidentId || '').trim()) throw new Error('INCIDENT_ID_REQUIRED');
  if (!String(input.startedAt || '').trim()) throw new Error('INCIDENT_START_REQUIRED');
  isoMs(input.startedAt, 'startedAt');
  const events = Array.isArray(input.events) ? input.events.map(createTelemetryEvent) : [];
  const evidence = {
    schemaVersion: input.schemaVersion || '1.0',
    incidentId: String(input.incidentId), startedAt: input.startedAt,
    endedAt: input.endedAt || null, environment: input.environment || null,
    events, decisions: input.decisions || [], actions: input.actions || [], recovery: input.recovery || null
  };
  return Object.freeze({...evidence, evidenceHash: sha256(evidence)});
}

function verifyIncidentEvidence(bundle) {
  assertObject(bundle, 'bundle');
  if (!/^[a-f0-9]{64}$/.test(String(bundle.evidenceHash || ''))) return Object.freeze({ok:false, reason:'EVIDENCE_HASH_FORMAT_INVALID'});
  const {evidenceHash, ...content} = bundle;
  return Object.freeze({ok: sha256(content) === evidenceHash, reason: sha256(content) === evidenceHash ? null : 'EVIDENCE_HASH_MISMATCH'});
}

function latencyDistribution(samples) {
  if (!Array.isArray(samples) || !samples.length) throw new RangeError('samples required');
  const xs = samples.map((x, i) => finite(x, `samples[${i}]`));
  if (xs.some(x => x < 0)) throw new RangeError('latency cannot be negative');
  const sorted = xs.slice().sort((a,b)=>a-b);
  const q = p => { const x=p*(sorted.length-1), lo=Math.floor(x), hi=Math.ceil(x); return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo); };
  const sum = xs.reduce((a,b)=>a+b,0);
  return Object.freeze({n: xs.length, min: sorted[0], max: sorted[sorted.length-1], mean: sum/xs.length, p50:q(.5), p95:q(.95), p99:q(.99), basis:'observed samples; no extrapolation'});
}

const fieldOperationsIntelligence = require('./fieldOperationsIntelligence');

module.exports = Object.freeze({
  createTelemetryEvent, validateTelemetryOrder, assertCardinality, errorBudgetSummary, evaluateSlo,
  fieldOperationsIntelligence,
  validateAlertRule, createIncidentEvidence, verifyIncidentEvidence, latencyDistribution, sha256
});
