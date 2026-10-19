'use strict';

const crypto = require('crypto');
const { canonical } = require('./truthFabric');

const STATES = Object.freeze([
  'PROVEN', 'UNCERTAIN', 'CONFLICTED', 'STALE', 'UNAUTHORIZED',
  'REQUIRES_HUMAN_APPROVAL', 'EXECUTABLE', 'BLOCKED'
]);

const ACTIONS = Object.freeze(['RECOMMEND', 'AUTHORIZE', 'EXECUTE']);

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function finite(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(code);
  return n;
}

function assessEvidence({ evidence = [], now = new Date(), maxAgeSeconds = Infinity, requireNonSimulatedEvidence = true } = {}) {
  const list = Array.isArray(evidence) ? evidence : [];
  if (!list.length) return { status: 'BLOCKED', reason: 'EVIDENCE_REQUIRED', fresh: false, count: 0 };
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return { status: 'BLOCKED', reason: 'NOW_INVALID', fresh: false, count: list.length };
  for (const e of list) {
    if (!e || !(e.id || e.factId)) return { status: 'BLOCKED', reason: 'EVIDENCE_ID_REQUIRED', fresh: false, count: list.length };
    if (e.source === 'ai_simulated') continue;
    const t = new Date(e.observedAt).getTime();
    if (!Number.isFinite(t)) return { status: 'STALE', reason: 'EVIDENCE_TIME_INVALID', fresh: false, count: list.length };
    const age = Math.max(0, (nowMs - t) / 1000);
    if (age > maxAgeSeconds) return { status: 'STALE', reason: 'EVIDENCE_STALE', fresh: false, count: list.length };
  }
  if (requireNonSimulatedEvidence && list.every(e => e.source === 'ai_simulated')) return { status: 'BLOCKED', reason: 'SIMULATED_ONLY', fresh: false, count: list.length };
  return { status: 'PROVEN', reason: 'EVIDENCE_PRESENT_AND_FRESH', fresh: true, count: list.length };
}

function assessDecisionSafety(input = {}) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts : [];
  const unresolved = conflicts.filter(c => String(c.status || 'OPEN') === 'OPEN');
  const evidenceState = assessEvidence({
    evidence,
    now: input.now,
    maxAgeSeconds: input.maxEvidenceAgeSeconds ?? Infinity,
    requireNonSimulatedEvidence: input.requireNonSimulatedEvidence !== false
  });
  let confidence = Number(input.confidence);
  let risk = Number(input.riskScore);

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return freezeResult('UNCERTAIN', 'CONFIDENCE_INVALID', evidenceState, unresolved);
  }
  if (!Number.isFinite(risk) || risk < 0 || risk > 1) {
    return freezeResult('UNCERTAIN', 'RISK_INVALID', evidenceState, unresolved);
  }
  if (unresolved.length) return freezeResult('CONFLICTED', 'OPEN_CONFLICT', evidenceState, unresolved);
  if (evidenceState.status === 'STALE') return freezeResult('STALE', evidenceState.reason, evidenceState, unresolved);
  if (evidenceState.status !== 'PROVEN') return freezeResult('UNCERTAIN', evidenceState.reason, evidenceState, unresolved);
  if (!Number.isFinite(Number(input.maxEvidenceAgeSeconds)) || Number(input.maxEvidenceAgeSeconds) < 0) return freezeResult('REQUIRES_HUMAN_APPROVAL', 'EVIDENCE_FRESHNESS_POLICY_REQUIRED', evidenceState, unresolved);
  if (!Number.isFinite(Number(input.approvalRiskThreshold)) || Number(input.approvalRiskThreshold) < 0 || Number(input.approvalRiskThreshold) > 1) return freezeResult('REQUIRES_HUMAN_APPROVAL', 'RISK_POLICY_THRESHOLD_REQUIRED', evidenceState, unresolved);
  if (!Number.isFinite(Number(input.autonomousConfidenceThreshold)) || Number(input.autonomousConfidenceThreshold) < 0 || Number(input.autonomousConfidenceThreshold) > 1) return freezeResult('REQUIRES_HUMAN_APPROVAL', 'CONFIDENCE_POLICY_THRESHOLD_REQUIRED', evidenceState, unresolved);
  if (input.capabilityOk !== true) return freezeResult('UNAUTHORIZED', 'CAPABILITY_NOT_PROVEN', evidenceState, unresolved);
  if (input.policyOk !== true) return freezeResult('UNAUTHORIZED', 'POLICY_NOT_PROVEN', evidenceState, unresolved);
  if (input.autonomousAllowed !== true) return freezeResult('REQUIRES_HUMAN_APPROVAL', 'AUTONOMOUS_NOT_AUTHORIZED', evidenceState, unresolved);
  if (input.rollbackPossible !== true || !input.rollbackPlan || input.rollbackPlan.rollbackVerified !== true) return freezeResult('REQUIRES_HUMAN_APPROVAL', 'ROLLBACK_NOT_VERIFIED', evidenceState, unresolved);
  if (input.impact === 'CRITICAL') return freezeResult('REQUIRES_HUMAN_APPROVAL', 'CRITICAL_IMPACT', evidenceState, unresolved);
  if (risk >= Number(input.approvalRiskThreshold ?? 0.35)) return freezeResult('REQUIRES_HUMAN_APPROVAL', 'RISK_THRESHOLD', evidenceState, unresolved);
  if (confidence < Number(input.autonomousConfidenceThreshold ?? 0.95)) return freezeResult('REQUIRES_HUMAN_APPROVAL', 'CONFIDENCE_THRESHOLD', evidenceState, unresolved);
  return freezeResult('EXECUTABLE', 'ALL_SAFETY_GATES_PASSED', evidenceState, unresolved);
}

function freezeResult(state, reason, evidence, conflicts) {
  return Object.freeze({ state, reason, evidence, conflicts: conflicts.map(c => c.conflictId || c.id || null) });
}

function createDecisionRecord(input = {}) {
  for (const k of ['decisionId', 'subjectType', 'subjectId', 'question', 'recommendedAction']) {
    if (!input[k]) throw new Error(`DECISION_${k.toUpperCase()}_REQUIRED`);
  }
  const safety = assessDecisionSafety(input);
  const now = new Date(input.now || Date.now()).toISOString();
  const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
  if (expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime()) throw new Error('DECISION_EXPIRY_INVALID');
  const record = {
    decisionId: String(input.decisionId),
    subjectType: String(input.subjectType), subjectId: String(input.subjectId),
    question: String(input.question), recommendedAction: String(input.recommendedAction),
    evidence: (input.evidence || []).map(e => ({ id: e.id || e.factId, hash: e.hash || e.contentHash || null, observedAt: e.observedAt, source: e.source })),
    conflicts: input.conflicts || [],
    alternatives: Array.isArray(input.alternatives) ? input.alternatives : [],
    confidence: Number(input.confidence), riskScore: Number(input.riskScore),
    uncertainty: input.uncertainty || null,
    rollbackPlan: input.rollbackPlan || null,
    policyContext: {
      capabilityOk: input.capabilityOk === true,
      policyOk: input.policyOk === true,
      autonomousAllowed: input.autonomousAllowed === true,
      rollbackPossible: input.rollbackPossible === true,
      impact: input.impact || null,
      maxEvidenceAgeSeconds: input.maxEvidenceAgeSeconds,
      requireNonSimulatedEvidence: input.requireNonSimulatedEvidence !== false,
      approvalRiskThreshold: input.approvalRiskThreshold,
      autonomousConfidenceThreshold: input.autonomousConfidenceThreshold
    },
    safety,
    createdAt: now,
    expiresAt,
    modelFingerprint: input.modelFingerprint || null,
    parameterFingerprint: input.parameterFingerprint || null,
    codeRevision: input.codeRevision || null
  };
  return Object.freeze({ ...record, decisionHash: sha256(record) });
}

function verifyDecisionRecord(record, input = {}) {
  if (!record || !record.decisionHash) return { ok: false, reason: 'DECISION_HASH_MISSING' };
  const copy = { ...record }; delete copy.decisionHash;
  const calculated = sha256(copy);
  if (calculated !== record.decisionHash) return { ok: false, reason: 'DECISION_HASH_MISMATCH', calculated };
  const nowMs = new Date(input.now || Date.now()).getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, reason: 'NOW_INVALID', calculated };
  if (record.expiresAt && nowMs > new Date(record.expiresAt).getTime()) return { ok: false, reason: 'DECISION_EXPIRED', calculated };
  if (record.safety.state === 'CONFLICTED' || record.safety.state === 'STALE') return { ok: false, reason: 'DECISION_NOT_EXECUTABLE_STATE', calculated };
  return { ok: true, calculated };
}

function approveDecision(record, approval = {}) {
  const v = verifyDecisionRecord(record, { now: approval.now });
  if (!v.ok) throw new Error(`APPROVAL_${v.reason}`);
  if (record.safety.state !== 'REQUIRES_HUMAN_APPROVAL') throw new Error('APPROVAL_NOT_REQUIRED_OR_ALLOWED');
  if (!approval.approverId) throw new Error('APPROVER_REQUIRED');
  if (!approval.scope || approval.scope !== `${record.subjectType}:${record.subjectId}`) throw new Error('APPROVAL_SCOPE_MISMATCH');
  const approvalRecord = {
    approvalId: approval.approvalId || crypto.randomUUID(), decisionId: record.decisionId,
    decisionHash: record.decisionHash, approverId: String(approval.approverId), scope: approval.scope,
    approvedAt: new Date(approval.now || Date.now()).toISOString(), reason: approval.reason || null
  };
  return Object.freeze({ ...approvalRecord, approvalHash: sha256(approvalRecord) });
}

function verifyApproval(approval, record) {
  if (!approval || !approval.approvalHash) return { ok: false, reason: 'APPROVAL_HASH_MISSING' };
  if (approval.decisionId !== record.decisionId || approval.decisionHash !== record.decisionHash) return { ok: false, reason: 'APPROVAL_DECISION_MISMATCH' };
  if (approval.scope !== `${record.subjectType}:${record.subjectId}`) return { ok: false, reason: 'APPROVAL_SCOPE_MISMATCH' };
  const copy = { ...approval }; delete copy.approvalHash;
  if (sha256(copy) !== approval.approvalHash) return { ok: false, reason: 'APPROVAL_HASH_MISMATCH' };
  if (!approval.approverId) return { ok: false, reason: 'APPROVER_REQUIRED' };
  return { ok: true };
}

function authorizeExecution(record, approval, input = {}) {
  const v = verifyDecisionRecord(record, { now: input.now });
  if (!v.ok) return { ok: false, reason: v.reason };
  if (!record.rollbackPlan || record.rollbackPlan.rollbackVerified !== true) return { ok: false, reason: 'ROLLBACK_NOT_VERIFIED' };
  if (record.safety.state === 'CONFLICTED' || record.safety.state === 'STALE' || record.safety.state === 'BLOCKED' || record.safety.state === 'UNAUTHORIZED') {
    return { ok: false, reason: 'UNSAFE_DECISION_STATE' };
  }
  if (record.safety.state === 'EXECUTABLE') return { ok: true, authorization: makeAuthorization(record, null, input) };
  if (record.safety.state !== 'REQUIRES_HUMAN_APPROVAL') return { ok: false, reason: 'DECISION_NOT_AUTHORIZABLE' };
  const av = verifyApproval(approval, record);
  if (!av.ok) return av;
  return { ok: true, authorization: makeAuthorization(record, approval, input) };
}

function makeAuthorization(record, approval, input) {
  const auth = {
    authorizationId: crypto.randomUUID(),
    decisionId: record.decisionId, decisionHash: record.decisionHash,
    approvalHash: approval ? approval.approvalHash : null,
    scope: `${record.subjectType}:${record.subjectId}`,
    action: 'EXECUTE',
    issuedAt: new Date(input.now || Date.now()).toISOString(),
    expiresAt: record.expiresAt
  };
  return Object.freeze({ ...auth, authorizationHash: sha256(auth) });
}

function verifyExecutionAuthorization(auth, record, input = {}) {
  if (!auth || !auth.authorizationHash) return { ok: false, reason: 'AUTHORIZATION_HASH_MISSING' };
  if (!record || auth.decisionId !== record.decisionId || auth.decisionHash !== record.decisionHash) return { ok: false, reason: 'AUTHORIZATION_DECISION_MISMATCH' };
  const copy = { ...auth }; delete copy.authorizationHash;
  if (sha256(copy) !== auth.authorizationHash) return { ok: false, reason: 'AUTHORIZATION_HASH_MISMATCH' };
  const v = verifyDecisionRecord(record, input);
  if (!v.ok) return { ok: false, reason: v.reason };
  if (auth.scope !== `${record.subjectType}:${record.subjectId}` || auth.action !== 'EXECUTE') return { ok: false, reason: 'AUTHORIZATION_SCOPE_OR_ACTION_INVALID' };
  return { ok: true };
}

function replayDecision(record, context = {}) {
  const policy = record.policyContext || {};
  const replayInput = {
    evidence: context.evidence || record.evidence,
    conflicts: context.conflicts || record.conflicts,
    confidence: context.confidence ?? record.confidence,
    riskScore: context.riskScore ?? record.riskScore,
    uncertainty: context.uncertainty ?? record.uncertainty,
    capabilityOk: context.capabilityOk ?? policy.capabilityOk,
    policyOk: context.policyOk ?? policy.policyOk,
    autonomousAllowed: context.autonomousAllowed ?? policy.autonomousAllowed,
    rollbackPossible: context.rollbackPossible ?? policy.rollbackPossible,
    rollbackPlan: context.rollbackPlan ?? record.rollbackPlan,
    impact: context.impact ?? policy.impact,
    approvalRiskThreshold: context.approvalRiskThreshold ?? policy.approvalRiskThreshold,
    autonomousConfidenceThreshold: context.autonomousConfidenceThreshold ?? policy.autonomousConfidenceThreshold,
    maxEvidenceAgeSeconds: context.maxEvidenceAgeSeconds ?? policy.maxEvidenceAgeSeconds,
    now: context.now || record.createdAt
  };
  const result = assessDecisionSafety(replayInput);
  return Object.freeze({ decisionId: record.decisionId, originalState: record.safety.state, replayState: result.state, replayReason: result.reason, identical: result.state === record.safety.state && result.reason === record.safety.reason });
}

module.exports = Object.freeze({ STATES, ACTIONS, assessEvidence, assessDecisionSafety, createDecisionRecord, verifyDecisionRecord, approveDecision, authorizeExecution, verifyExecutionAuthorization, replayDecision, verifyApproval });
