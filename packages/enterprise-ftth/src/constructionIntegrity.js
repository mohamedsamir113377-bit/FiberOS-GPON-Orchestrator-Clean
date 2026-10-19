'use strict';

const crypto = require('crypto');

const REQUIRED_CHAIN_FIELDS = Object.freeze([
  'work_package_id', 'event_id', 'actor_id', 'occurred_at', 'stage',
]);

const VALID_STAGES = Object.freeze([
  'survey', 'design', 'permit', 'material', 'civil', 'duct', 'cable',
  'splicing', 'testing', 'qc', 'acceptance', 'drop', 'activation'
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertDate(value, field) {
  if (!isNonEmptyString(value)) throw new Error(`MISSING_${field.toUpperCase()}`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`INVALID_${field.toUpperCase()}`);
  return ms;
}

function validateConstructionEvent(event, { now = Date.now() } = {}) {
  if (!event || typeof event !== 'object') throw new Error('INVALID_CONSTRUCTION_EVENT');
  for (const field of REQUIRED_CHAIN_FIELDS) {
    if (!isNonEmptyString(event[field])) throw new Error(`MISSING_${field.toUpperCase()}`);
  }
  if (!VALID_STAGES.includes(event.stage)) throw new Error('UNKNOWN_FTTH_STAGE');
  const occurred = assertDate(event.occurred_at, 'occurred_at');
  if (occurred > now) throw new Error('FUTURE_CONSTRUCTION_EVENT');
  if (event.received_at !== undefined) assertDate(event.received_at, 'received_at');
  if (event.received_at !== undefined && Date.parse(event.received_at) < occurred) {
    throw new Error('RECEIVED_BEFORE_OCCURRED');
  }
  if (event.evidence_ids !== undefined && (!Array.isArray(event.evidence_ids) || event.evidence_ids.some(id => !isNonEmptyString(id)))) {
    throw new Error('INVALID_EVIDENCE_IDS');
  }
  return true;
}

function validateEvidence(evidence, { now = Date.now() } = {}) {
  if (!evidence || typeof evidence !== 'object') throw new Error('INVALID_EVIDENCE');
  for (const field of ['evidence_id', 'work_package_id', 'evidence_type', 'actor_id']) {
    if (!isNonEmptyString(evidence[field])) throw new Error(`MISSING_EVIDENCE_${field.toUpperCase()}`);
  }
  const captured = assertDate(evidence.captured_at, 'captured_at');
  if (captured > now) throw new Error('FUTURE_EVIDENCE');
  if (evidence.content_sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(evidence.content_sha256)) {
    throw new Error('INVALID_EVIDENCE_SHA256');
  }
  if (evidence.file_reference !== undefined && !isNonEmptyString(evidence.file_reference)) {
    throw new Error('INVALID_EVIDENCE_FILE_REFERENCE');
  }
  return true;
}

function validateAssetLink(link, { now = Date.now() } = {}) {
  if (!link || typeof link !== 'object') throw new Error('INVALID_ASSET_LINK');
  for (const field of ['work_package_id', 'asset_id', 'relation', 'recorded_by', 'recorded_at']) {
    if (!isNonEmptyString(link[field])) throw new Error(`MISSING_ASSET_LINK_${field.toUpperCase()}`);
  }
  const recorded = assertDate(link.recorded_at, 'recorded_at');
  if (recorded > now) throw new Error('FUTURE_ASSET_LINK');
  return true;
}

function validateMaterialTrace(material, { now = Date.now() } = {}) {
  if (!material || typeof material !== 'object') throw new Error('INVALID_MATERIAL_TRACE');
  for (const field of ['work_package_id', 'material_item_id', 'quantity', 'unit', 'issued_by', 'issued_at']) {
    if (material[field] === undefined || material[field] === null || (typeof material[field] === 'string' && !isNonEmptyString(material[field]))) {
      throw new Error(`MISSING_MATERIAL_${field.toUpperCase()}`);
    }
  }
  if (!(Number.isFinite(Number(material.quantity)) && Number(material.quantity) > 0)) throw new Error('INVALID_MATERIAL_QUANTITY');
  const issued = assertDate(material.issued_at, 'issued_at');
  if (issued > now) throw new Error('FUTURE_MATERIAL_TRACE');
  return true;
}

function validateLocationProof(location, { now = Date.now() } = {}) {
  if (!location || typeof location !== 'object') throw new Error('INVALID_LOCATION_PROOF');
  for (const field of ['work_package_id', 'latitude', 'longitude', 'recorded_at']) {
    if (location[field] === undefined || location[field] === null) throw new Error(`MISSING_LOCATION_${field.toUpperCase()}`);
  }
  if (!Number.isFinite(Number(location.latitude)) || Number(location.latitude) < -90 || Number(location.latitude) > 90) throw new Error('INVALID_LATITUDE');
  if (!Number.isFinite(Number(location.longitude)) || Number(location.longitude) < -180 || Number(location.longitude) > 180) throw new Error('INVALID_LONGITUDE');
  const recorded = assertDate(location.recorded_at, 'recorded_at');
  if (recorded > now) throw new Error('FUTURE_LOCATION_PROOF');
  return true;
}

function validateRework(rework, { now = Date.now() } = {}) {
  if (!rework || typeof rework !== 'object') throw new Error('INVALID_REWORK');
  for (const field of ['work_package_id', 'rework_id', 'reason_code', 'created_by', 'created_at']) {
    if (!isNonEmptyString(rework[field])) throw new Error(`MISSING_REWORK_${field.toUpperCase()}`);
  }
  if (!['defect', 'failed_qc', 'failed_test', 'safety', 'documentation', 'other'].includes(rework.reason_code)) {
    throw new Error('INVALID_REWORK_REASON');
  }
  const created = assertDate(rework.created_at, 'created_at');
  if (created > now) throw new Error('FUTURE_REWORK');
  return true;
}

function validateFinalAcceptance(record, { now = Date.now() } = {}) {
  if (!record || typeof record !== 'object') throw new Error('INVALID_ACCEPTANCE_RECORD');
  for (const field of ['work_package_id', 'accepted_by', 'accepted_at']) {
    if (!isNonEmptyString(record[field])) throw new Error(`MISSING_ACCEPTANCE_${field.toUpperCase()}`);
  }
  if (!Array.isArray(record.required_gates) || record.required_gates.length === 0) throw new Error('MISSING_ACCEPTANCE_GATES');
  if (record.required_gates.some(g => !g || g.status !== 'passed' || !isNonEmptyString(g.gate_type) || !isNonEmptyString(g.rule_version))) {
    throw new Error('ACCEPTANCE_GATE_NOT_VERIFIED');
  }
  if (!Array.isArray(record.evidence_ids) || record.evidence_ids.length === 0 || record.evidence_ids.some(id => !isNonEmptyString(id))) {
    throw new Error('ACCEPTANCE_EVIDENCE_REQUIRED');
  }
  const accepted = assertDate(record.accepted_at, 'accepted_at');
  if (accepted > now) throw new Error('FUTURE_ACCEPTANCE');
  return true;
}

function validateChain(record, { now = Date.now() } = {}) {
  if (!record || typeof record !== 'object') throw new Error('INVALID_CONSTRUCTION_CHAIN');
  validateConstructionEvent(record.event, { now });
  if (record.evidence) record.evidence.forEach(e => validateEvidence(e, { now }));
  if (record.asset_links) record.asset_links.forEach(x => validateAssetLink(x, { now }));
  if (record.materials) record.materials.forEach(x => validateMaterialTrace(x, { now }));
  if (record.locations) record.locations.forEach(x => validateLocationProof(x, { now }));
  if (record.rework) record.rework.forEach(x => validateRework(x, { now }));
  if (record.acceptance) validateFinalAcceptance(record.acceptance, { now });

  const wp = record.event.work_package_id;
  const ensureUnique = (items, field, code) => {
    const ids = items.map(x => x && x[field]);
    if (ids.some(id => !isNonEmptyString(id))) throw new Error(code + '_MISSING_ID');
    if (new Set(ids).size !== ids.length) throw new Error(code + '_DUPLICATE_ID');
  };
  ensureUnique(record.evidence || [], 'evidence_id', 'EVIDENCE');
  ensureUnique(record.asset_links || [], 'asset_id', 'ASSET_LINK');
  ensureUnique(record.rework || [], 'rework_id', 'REWORK');
  for (const e of record.evidence || []) if (e.work_package_id !== wp) throw new Error('EVIDENCE_WORK_PACKAGE_MISMATCH');
  for (const a of record.asset_links || []) if (a.work_package_id !== wp) throw new Error('ASSET_LINK_WORK_PACKAGE_MISMATCH');
  for (const m of record.materials || []) if (m.work_package_id !== wp) throw new Error('MATERIAL_WORK_PACKAGE_MISMATCH');
  for (const l of record.locations || []) if (l.work_package_id !== wp) throw new Error('LOCATION_WORK_PACKAGE_MISMATCH');
  for (const r of record.rework || []) if (r.work_package_id !== wp) throw new Error('REWORK_WORK_PACKAGE_MISMATCH');
  if (record.acceptance && record.acceptance.work_package_id !== wp) throw new Error('ACCEPTANCE_WORK_PACKAGE_MISMATCH');

  const eventTime = Date.parse(record.event.occurred_at);
  const evidenceIds = new Set((record.evidence || []).map(e => e.evidence_id));
  const eventEvidence = record.event.evidence_ids || [];
  if (eventEvidence.some(id => !evidenceIds.has(id))) throw new Error('EVENT_REFERENCES_UNKNOWN_EVIDENCE');
  for (const e of record.evidence || []) {
    if (Date.parse(e.captured_at) < eventTime) throw new Error('EVIDENCE_BEFORE_EVENT');
  }
  if (record.acceptance) {
    if (record.acceptance.evidence_ids.some(id => !evidenceIds.has(id))) throw new Error('ACCEPTANCE_REFERENCES_UNKNOWN_EVIDENCE');
    const acceptanceTime = Date.parse(record.acceptance.accepted_at);
    if (acceptanceTime < eventTime) throw new Error('ACCEPTANCE_BEFORE_EVENT');
    for (const id of record.acceptance.evidence_ids) {
      const ev = record.evidence.find(e => e.evidence_id === id);
      if (ev && Date.parse(ev.captured_at) > acceptanceTime) throw new Error('ACCEPTANCE_USES_FUTURE_EVIDENCE');
    }
  }
  return true;
}

function hashEvidenceContent(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('EVIDENCE_BYTES_REQUIRED');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  REQUIRED_CHAIN_FIELDS,
  VALID_STAGES,
  validateConstructionEvent,
  validateEvidence,
  validateAssetLink,
  validateMaterialTrace,
  validateLocationProof,
  validateRework,
  validateFinalAcceptance,
  validateChain,
  hashEvidenceContent,
};
