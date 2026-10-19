'use strict';

/**
 * NETWORK KNOWLEDGE SYSTEM (Master Operating Statement, Section 28)
 * ================================================================
 * Every completed operation must leave reusable knowledge, and that knowledge
 * must be traceable back to evidence. It must never become an opaque
 * AI-generated statement.
 *
 * This module therefore:
 *   - refuses to capture a knowledge record without at least one evidence id;
 *   - requires an explicit origin class, and forces model-generated knowledge to
 *     carry both a model reference and a human reviewer;
 *   - content-addresses every record so it cannot be edited after the fact;
 *   - refuses to return non-traceable records from search (they are reported as
 *     excluded instead of being silently used).
 *
 * It is a pure, dependency-free control boundary. It does not persist, and it
 * does not promote anything to operational truth on its own.
 */

const crypto = require('node:crypto');

const MAX_RECORDS = 5000;
const MAX_SEARCH_LIMIT = 200;

const KNOWLEDGE_CLASSES = Object.freeze([
  'FIELD_RESOLUTION',
  'CONSTRUCTION_LESSON',
  'OPTICAL_SIGNATURE',
  'MATERIAL_FAILURE',
  'CUSTOMER_PATTERN'
]);

const ORIGINS = Object.freeze(['field_verified', 'measured', 'derived', 'model_generated']);

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

function requireEvidenceIds(evidenceIds) {
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
    throw new Error('KNOWLEDGE_EVIDENCE_REQUIRED');
  }
  return Object.freeze([...new Set(evidenceIds.map(String))].sort());
}

function captureKnowledge(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('KNOWLEDGE_INPUT_REQUIRED');
  const tenantId = requireText(input.tenantId, 'KNOWLEDGE_TENANT_REQUIRED');
  const workRef = requireText(input.workRef, 'KNOWLEDGE_WORK_REFERENCE_REQUIRED');
  const knowledgeClass = requireText(input.knowledgeClass, 'KNOWLEDGE_CLASS_REQUIRED').toUpperCase();
  if (!KNOWLEDGE_CLASSES.includes(knowledgeClass)) throw new Error('KNOWLEDGE_CLASS_INVALID');
  const origin = requireText(input.origin, 'KNOWLEDGE_ORIGIN_REQUIRED');
  if (!ORIGINS.includes(origin)) throw new Error('KNOWLEDGE_ORIGIN_INVALID');
  const evidenceIds = requireEvidenceIds(input.evidenceIds);
  const symptom = requireText(input.symptom, 'KNOWLEDGE_SYMPTOM_REQUIRED');
  const action = requireText(input.action, 'KNOWLEDGE_ACTION_REQUIRED');
  const outcome = requireText(input.outcome, 'KNOWLEDGE_OUTCOME_REQUIRED');
  if (origin === 'model_generated') {
    requireText(input.modelRef, 'KNOWLEDGE_MODEL_REFERENCE_REQUIRED');
    requireText(input.reviewedBy, 'KNOWLEDGE_MODEL_OUTPUT_REQUIRES_HUMAN_REVIEW');
  }
  const capturedAt = requireText(input.capturedAt, 'KNOWLEDGE_CAPTURED_AT_REQUIRED');
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('KNOWLEDGE_CAPTURED_AT_INVALID');

  const body = {
    schema: 'fiberos.network-knowledge.v1',
    tenantId,
    workRef,
    knowledgeClass,
    origin,
    assetRefs: Array.isArray(input.assetRefs) ? [...new Set(input.assetRefs.map(String))].sort() : [],
    symptom,
    action,
    outcome,
    evidenceIds,
    actorId: input.actorId == null ? null : String(input.actorId),
    modelRef: input.modelRef == null ? null : String(input.modelRef),
    reviewedBy: input.reviewedBy == null ? null : String(input.reviewedBy),
    capturedAt,
    reusable: true,
    status: 'EVIDENCE_BOUND'
  };

  return Object.freeze({ ...body, knowledgeHash: sha256(body) });
}

function validateKnowledgeRecord(record = {}) {
  if (!record || typeof record !== 'object') {
    return Object.freeze({ valid: false, findings: Object.freeze(['KNOWLEDGE_RECORD_REQUIRED']) });
  }
  const findings = [];
  const required = [
    ['tenantId', 'TENANT'],
    ['workRef', 'WORK_REFERENCE'],
    ['knowledgeClass', 'CLASS'],
    ['origin', 'ORIGIN'],
    ['symptom', 'SYMPTOM'],
    ['action', 'ACTION'],
    ['outcome', 'OUTCOME'],
    ['capturedAt', 'CAPTURED_AT']
  ];
  for (const [key, code] of required) {
    if (record[key] == null || String(record[key]).trim() === '') findings.push(`KNOWLEDGE_${code}_REQUIRED`);
  }
  if (record.knowledgeClass && !KNOWLEDGE_CLASSES.includes(String(record.knowledgeClass))) findings.push('KNOWLEDGE_CLASS_INVALID');
  if (record.origin && !ORIGINS.includes(String(record.origin))) findings.push('KNOWLEDGE_ORIGIN_INVALID');
  if (!Array.isArray(record.evidenceIds) || record.evidenceIds.length === 0) findings.push('KNOWLEDGE_EVIDENCE_REQUIRED');
  if (record.origin === 'model_generated' && (!record.modelRef || !record.reviewedBy)) {
    findings.push('KNOWLEDGE_MODEL_OUTPUT_REQUIRES_HUMAN_REVIEW');
  }
  if (record.knowledgeHash) {
    const copy = { ...record };
    delete copy.knowledgeHash;
    if (sha256(copy) !== String(record.knowledgeHash)) findings.push('KNOWLEDGE_HASH_MISMATCH');
  }
  return Object.freeze({ valid: findings.length === 0, findings: Object.freeze(findings) });
}

function assertKnowledgeIsTraceable(record = {}) {
  const check = validateKnowledgeRecord(record);
  if (!check.valid) throw new Error(`KNOWLEDGE_NOT_TRACEABLE:${check.findings.join(',')}`);
  return true;
}

function searchKnowledge(records = [], options = {}) {
  const tenantId = requireText(options.tenantId, 'KNOWLEDGE_SEARCH_TENANT_REQUIRED');
  if (!Array.isArray(records)) throw new Error('KNOWLEDGE_RECORDS_INVALID');
  if (records.length > MAX_RECORDS) throw new Error('KNOWLEDGE_RECORDS_TOO_LARGE');
  const limit = options.limit == null ? 50 : Number(options.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) throw new Error('KNOWLEDGE_LIMIT_INVALID');
  const knowledgeClass = options.knowledgeClass == null ? null : String(options.knowledgeClass).toUpperCase();
  if (knowledgeClass && !KNOWLEDGE_CLASSES.includes(knowledgeClass)) throw new Error('KNOWLEDGE_CLASS_INVALID');
  const needle = options.text == null ? null : String(options.text).toLowerCase();

  const tenantRecords = records.filter((record) => record && String(record.tenantId) === String(tenantId));
  const traceable = [];
  const excluded = [];
  for (const record of tenantRecords) {
    const check = validateKnowledgeRecord(record);
    if (check.valid) traceable.push(record);
    else excluded.push(Object.freeze({ knowledgeHash: record.knowledgeHash == null ? null : String(record.knowledgeHash), findings: check.findings }));
  }

  const matched = traceable
    .filter((record) => knowledgeClass == null || record.knowledgeClass === knowledgeClass)
    .filter((record) => needle == null || [record.symptom, record.action, record.outcome].some((field) => String(field).toLowerCase().includes(needle)))
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt) || String(a.knowledgeHash).localeCompare(String(b.knowledgeHash)))
    .slice(0, limit);

  return Object.freeze({
    schema: 'fiberos.network-knowledge-search.v1',
    tenantId: String(tenantId),
    searched: tenantRecords.length,
    matched: matched.length,
    excludedUntraceable: Object.freeze(excluded),
    results: Object.freeze(matched)
  });
}

module.exports = Object.freeze({
  MAX_RECORDS,
  MAX_SEARCH_LIMIT,
  KNOWLEDGE_CLASSES,
  ORIGINS,
  captureKnowledge,
  validateKnowledgeRecord,
  assertKnowledgeIsTraceable,
  searchKnowledge,
  sha256
});
