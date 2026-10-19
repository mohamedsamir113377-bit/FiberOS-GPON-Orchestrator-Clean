'use strict';

/**
 * DATA QUALITY / RECONCILIATION ENGINE (Master Operating Statement, Section 29)
 * ============================================================================
 * Scheduled reconciliation between declared sources, with one non-negotiable
 * rule taken from the specification: the objective is not a dashboard of
 * errors, and no contradiction may be silently resolved.
 *
 * This module therefore:
 *   - only reconciles explicitly declared source pairs (never a wildcard);
 *   - rejects observations coming from a source outside the job scope;
 *   - never selects a "winner" when two sources disagree - the fact is reported
 *     as CONTRADICTED and requires review;
 *   - reports observations with no evidence chain as EVIDENCE_INCOMPLETE rather
 *     than promoting them;
 *   - never auto-repairs or auto-resolves (autoResolved is always false).
 *
 * It is a pure, dependency-free control boundary. It does not persist, and it
 * does not mutate network truth.
 */

const crypto = require('node:crypto');

const MAX_FACTS = 20000;
const MIN_CADENCE_MINUTES = 5;

const RECONCILIATION_SOURCES = Object.freeze([
  'gis',
  'as_built',
  'field',
  'inventory',
  'nms_telemetry',
  'customer_record'
]);

const SEVERITIES = Object.freeze(['INFO', 'REVIEW', 'BLOCKING']);

function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = canonical(value[key]);
    return out;
  }, {});
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');
}

function requireText(value, code) {
  if (value == null || String(value).trim() === '') throw new Error(code);
  return String(value).trim();
}

function buildReconciliationJob(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('RECONCILIATION_INPUT_REQUIRED');
  const tenantId = requireText(input.tenantId, 'RECONCILIATION_TENANT_REQUIRED');
  const jobKey = requireText(input.jobKey, 'RECONCILIATION_JOB_KEY_REQUIRED');
  if (!Array.isArray(input.sourcePairs) || input.sourcePairs.length === 0) {
    throw new Error('RECONCILIATION_SOURCE_PAIRS_REQUIRED');
  }
  const normalisedPairs = input.sourcePairs.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('RECONCILIATION_SOURCE_PAIR_INVALID');
    const [left, right] = pair.map((value) => String(value).trim());
    if (!RECONCILIATION_SOURCES.includes(left) || !RECONCILIATION_SOURCES.includes(right)) {
      throw new Error('RECONCILIATION_SOURCE_UNKNOWN');
    }
    if (left === right) throw new Error('RECONCILIATION_SOURCE_PAIR_IDENTICAL');
    return Object.freeze([left, right].sort());
  });
  const sourcePairs = [...new Map(normalisedPairs.map((pair) => [pair.join('|'), pair])).values()]
    .sort((a, b) => a.join('|').localeCompare(b.join('|')));

  const cadenceMinutes = Number(input.cadenceMinutes);
  if (!Number.isSafeInteger(cadenceMinutes) || cadenceMinutes < MIN_CADENCE_MINUTES) {
    throw new Error('RECONCILIATION_CADENCE_INVALID');
  }
  const geometryToleranceMeters = input.geometryToleranceMeters == null ? 2 : Number(input.geometryToleranceMeters);
  if (!Number.isFinite(geometryToleranceMeters) || geometryToleranceMeters < 0) {
    throw new Error('RECONCILIATION_TOLERANCE_INVALID');
  }

  const body = {
    schema: 'fiberos.reconciliation-job.v1',
    tenantId,
    jobKey,
    sourcePairs,
    cadenceMinutes,
    geometryToleranceMeters,
    status: 'SCHEDULED',
    autoRepair: false,
    autoResolve: false
  };
  return Object.freeze({ ...body, jobHash: sha256(body) });
}

function isJobDue(job = {}, options = {}) {
  if (!job || !job.jobHash) throw new Error('RECONCILIATION_JOB_REQUIRED');
  const now = Date.parse(String(options.now));
  if (!Number.isFinite(now)) throw new Error('RECONCILIATION_NOW_INVALID');
  if (options.lastRunAt == null) return true;
  const lastRun = Date.parse(String(options.lastRunAt));
  if (!Number.isFinite(lastRun)) throw new Error('RECONCILIATION_LAST_RUN_INVALID');
  return now - lastRun >= Number(job.cadenceMinutes) * 60000;
}

function evaluateContradiction(input = {}) {
  const factClass = requireText(input.factClass, 'RECONCILIATION_FACT_CLASS_REQUIRED');
  const subjectId = input.subjectId == null ? null : String(input.subjectId);
  const observations = input.observations == null ? [] : input.observations;
  if (!Array.isArray(observations) || observations.length > MAX_FACTS) {
    throw new Error('RECONCILIATION_OBSERVATIONS_INVALID');
  }

  const normalised = observations.map((observation) => {
    if (!observation || typeof observation !== 'object') throw new Error('RECONCILIATION_OBSERVATION_INVALID');
    const source = requireText(observation.source, 'RECONCILIATION_OBSERVATION_SOURCE_REQUIRED');
    if (!RECONCILIATION_SOURCES.includes(source)) throw new Error('RECONCILIATION_SOURCE_UNKNOWN');
    return Object.freeze({
      source,
      value: observation.value === undefined ? null : observation.value,
      evidenceIds: Array.isArray(observation.evidenceIds) ? observation.evidenceIds.map(String) : [],
      observedAt: observation.observedAt == null ? null : String(observation.observedAt)
    });
  });

  if (normalised.length === 0) {
    return Object.freeze({
      factClass,
      subjectId,
      status: 'NO_OBSERVATION',
      distinctValueCount: 0,
      selected: null,
      groups: Object.freeze([]),
      requiresReview: false,
      evidenceIncomplete: false,
      autoResolved: false,
      reason: null
    });
  }

  const groups = new Map();
  for (const observation of normalised) {
    const valueKey = JSON.stringify(canonical(observation.value));
    if (!groups.has(valueKey)) {
      groups.set(valueKey, { valueKey, value: observation.value, sources: new Set(), evidenceIds: new Set() });
    }
    const group = groups.get(valueKey);
    group.sources.add(observation.source);
    for (const evidenceId of observation.evidenceIds) group.evidenceIds.add(evidenceId);
  }

  const materialised = [...groups.values()]
    .map((group) => Object.freeze({
      valueKey: group.valueKey,
      value: group.value,
      sources: Object.freeze([...group.sources].sort()),
      evidenceIds: Object.freeze([...group.evidenceIds].sort())
    }))
    .sort((a, b) => a.valueKey.localeCompare(b.valueKey));

  const evidenceIncomplete = normalised.some((observation) => observation.evidenceIds.length === 0);

  if (materialised.length > 1) {
    return Object.freeze({
      factClass,
      subjectId,
      status: 'CONTRADICTED',
      distinctValueCount: materialised.length,
      selected: null,
      groups: Object.freeze(materialised),
      requiresReview: true,
      evidenceIncomplete,
      autoResolved: false,
      reason: 'NO_SILENT_CONFLICT_RESOLUTION'
    });
  }

  const only = materialised[0];
  return Object.freeze({
    factClass,
    subjectId,
    status: evidenceIncomplete ? 'EVIDENCE_INCOMPLETE' : 'CONSISTENT',
    distinctValueCount: 1,
    selected: evidenceIncomplete ? null : only,
    groups: Object.freeze(materialised),
    requiresReview: evidenceIncomplete,
    evidenceIncomplete,
    autoResolved: false,
    reason: evidenceIncomplete ? 'EVIDENCE_CHAIN_REQUIRED_BEFORE_TRUTH_PROMOTION' : null
  });
}

function runReconciliationJob(input = {}) {
  const job = input.job;
  if (!job || !job.jobHash) throw new Error('RECONCILIATION_JOB_REQUIRED');
  const ranAt = requireText(input.now, 'RECONCILIATION_RUN_TIME_REQUIRED');
  if (!Number.isFinite(Date.parse(ranAt))) throw new Error('RECONCILIATION_RUN_TIME_INVALID');
  const facts = input.facts;
  if (!Array.isArray(facts) || facts.length > MAX_FACTS) throw new Error('RECONCILIATION_FACTS_INVALID');

  const allowedSources = new Set(job.sourcePairs.flat());
  const findings = [];
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object') throw new Error('RECONCILIATION_FACT_INVALID');
    const outOfScope = (Array.isArray(fact.observations) ? fact.observations : [])
      .filter((observation) => observation && !allowedSources.has(String(observation.source)))
      .map((observation) => String(observation.source));
    if (outOfScope.length) throw new Error('RECONCILIATION_OBSERVATION_OUT_OF_SCOPE');

    const evaluated = evaluateContradiction(fact);
    const severity = evaluated.status === 'CONTRADICTED'
      ? 'BLOCKING'
      : evaluated.status === 'EVIDENCE_INCOMPLETE' ? 'REVIEW' : 'INFO';
    findings.push(Object.freeze({
      factClass: evaluated.factClass,
      subjectId: evaluated.subjectId,
      status: evaluated.status,
      severity,
      requiresReview: evaluated.requiresReview,
      selected: evaluated.selected,
      groups: evaluated.groups
    }));
  }

  findings.sort((a, b) => String(a.subjectId || '').localeCompare(String(b.subjectId || '')) || a.factClass.localeCompare(b.factClass));

  const counts = findings.reduce((accumulator, finding) => {
    accumulator[finding.status] = (accumulator[finding.status] || 0) + 1;
    return accumulator;
  }, {});

  return Object.freeze({
    schema: 'fiberos.reconciliation-run.v1',
    tenantId: job.tenantId,
    jobKey: job.jobKey,
    ranAt,
    evaluated: findings.length,
    counts: Object.freeze(counts),
    findings: Object.freeze(findings),
    autoResolved: false,
    requiresHumanReview: findings.some((finding) => finding.requiresReview),
    resultHash: sha256(findings)
  });
}

module.exports = Object.freeze({
  MAX_FACTS,
  MIN_CADENCE_MINUTES,
  RECONCILIATION_SOURCES,
  SEVERITIES,
  buildReconciliationJob,
  isJobDue,
  evaluateContradiction,
  runReconciliationJob,
  sha256
});
