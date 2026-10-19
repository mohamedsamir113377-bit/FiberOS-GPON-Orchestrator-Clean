'use strict';

const { MANDATORY_GATES } = require('./workflow');

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }
function time(v, field) {
  if (!nonEmpty(v)) throw new Error(`MISSING_${field.toUpperCase()}`);
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error(`INVALID_${field.toUpperCase()}`);
  return ms;
}
function uniqueIds(items, field, code) {
  const ids = items.map(x => x && x[field]);
  if (ids.some(id => !nonEmpty(id))) throw new Error(`${code}_MISSING_ID`);
  if (new Set(ids).size !== ids.length) throw new Error(`${code}_DUPLICATE_ID`);
}

function validateQc(record, { now = Date.now() } = {}) {
  if (!record || typeof record !== 'object') throw new Error('INVALID_QC_RECORD');
  for (const f of ['qc_id','work_package_id','performed_by','performed_at','status']) {
    if (!nonEmpty(record[f])) throw new Error(`MISSING_QC_${f.toUpperCase()}`);
  }
  const t = time(record.performed_at, 'performed_at');
  if (t > now) throw new Error('FUTURE_QC');
  if (!['passed','failed'].includes(record.status)) throw new Error('INVALID_QC_STATUS');
  if (record.status === 'failed' && !nonEmpty(record.failure_reason)) throw new Error('QC_FAILURE_REASON_REQUIRED');
  if (!Array.isArray(record.evidence_ids) || record.evidence_ids.length === 0) throw new Error('QC_EVIDENCE_REQUIRED');
  if (record.evidence_ids.some(id => !nonEmpty(id))) throw new Error('INVALID_QC_EVIDENCE_IDS');
  return true;
}

function validateReworkClosure(rework, { now = Date.now() } = {}) {
  if (!rework || typeof rework !== 'object') throw new Error('INVALID_REWORK_CLOSURE');
  for (const f of ['rework_id','work_package_id','reason_code','created_by','created_at','status']) {
    if (!nonEmpty(rework[f])) throw new Error(`MISSING_REWORK_${f.toUpperCase()}`);
  }
  time(rework.created_at, 'created_at');
  if (Date.parse(rework.created_at) > now) throw new Error('FUTURE_REWORK');
  if (!['open','in_progress','resolved','cancelled'].includes(rework.status)) throw new Error('INVALID_REWORK_STATUS');
  if (rework.status === 'resolved') {
    if (!nonEmpty(rework.resolved_by)) throw new Error('REWORK_RESOLUTION_RESOLVED_BY_REQUIRED');
    if (!nonEmpty(rework.resolved_at)) throw new Error('REWORK_RESOLUTION_RESOLVED_AT_REQUIRED');
    const resolvedAt = time(rework.resolved_at, 'resolved_at');
    const createdAt = Date.parse(rework.created_at);
    if (resolvedAt > now) throw new Error('FUTURE_REWORK_RESOLUTION');
    if (resolvedAt < createdAt) throw new Error('REWORK_RESOLVED_BEFORE_CREATED');
    if (!Array.isArray(rework.resolution_evidence_ids) || rework.resolution_evidence_ids.length === 0) throw new Error('REWORK_RESOLUTION_EVIDENCE_REQUIRED');
  }
  return true;
}

function validateQcAcceptanceChain(record, { now = Date.now() } = {}) {
  if (!record || typeof record !== 'object') throw new Error('INVALID_QC_ACCEPTANCE_CHAIN');
  const wp = record.work_package_id;
  if (!nonEmpty(wp)) throw new Error('MISSING_WORK_PACKAGE_ID');
  const evidence = record.evidence || [];
  const evidenceIds = new Set(evidence.map(e => e && e.evidence_id));
  uniqueIds(evidence, 'evidence_id', 'EVIDENCE');
  for (const e of evidence) if (e.work_package_id !== wp) throw new Error('EVIDENCE_WORK_PACKAGE_MISMATCH');

  const qcs = record.qc_records || [];
  uniqueIds(qcs, 'qc_id', 'QC');
  let passedQc = false;
  for (const qc of qcs) {
    validateQc(qc, { now });
    if (qc.work_package_id !== wp) throw new Error('QC_WORK_PACKAGE_MISMATCH');
    for (const id of qc.evidence_ids) if (!evidenceIds.has(id)) throw new Error('QC_REFERENCES_UNKNOWN_EVIDENCE');
    if (qc.status === 'passed') passedQc = true;
  }

  const reworks = record.reworks || [];
  uniqueIds(reworks, 'rework_id', 'REWORK');
  for (const r of reworks) {
    validateReworkClosure(r, { now });
    if (r.work_package_id !== wp) throw new Error('REWORK_WORK_PACKAGE_MISMATCH');
    if (r.status === 'resolved') for (const id of r.resolution_evidence_ids) if (!evidenceIds.has(id)) throw new Error('REWORK_REFERENCES_UNKNOWN_EVIDENCE');
  }

  if (record.acceptance) {
    const a = record.acceptance;
    for (const f of ['acceptance_id','work_package_id','accepted_by','accepted_at']) if (!nonEmpty(a[f])) throw new Error(`MISSING_ACCEPTANCE_${f.toUpperCase()}`);
    if (a.work_package_id !== wp) throw new Error('ACCEPTANCE_WORK_PACKAGE_MISMATCH');
    const at = time(a.accepted_at, 'accepted_at');
    if (at > now) throw new Error('FUTURE_ACCEPTANCE');
    if (!passedQc) throw new Error('ACCEPTANCE_REQUIRES_PASSED_QC');
    if (reworks.some(r => r.status === 'open' || r.status === 'in_progress')) throw new Error('ACCEPTANCE_BLOCKED_BY_OPEN_REWORK');
    if (!Array.isArray(a.evidence_ids) || a.evidence_ids.length === 0) throw new Error('ACCEPTANCE_EVIDENCE_REQUIRED');
    for (const id of a.evidence_ids) if (!evidenceIds.has(id)) throw new Error('ACCEPTANCE_REFERENCES_UNKNOWN_EVIDENCE');
    for (const id of a.evidence_ids) {
      const e = evidence.find(x => x.evidence_id === id);
      if (e && Date.parse(e.captured_at) > at) throw new Error('ACCEPTANCE_USES_FUTURE_EVIDENCE');
    }
    if (!Array.isArray(a.gates) || MANDATORY_GATES.some(k => !a.gates.some(g => g && g.gate_type === k && g.status === 'passed' && nonEmpty(g.rule_version)))) {
      throw new Error('ACCEPTANCE_MANDATORY_GATES_NOT_SATISFIED');
    }
  }
  return true;
}

module.exports = Object.freeze({ validateQc, validateReworkClosure, validateQcAcceptanceChain });
