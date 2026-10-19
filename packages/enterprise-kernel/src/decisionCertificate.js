'use strict';
const crypto = require('crypto');
const { canonical } = require('./truthFabric');
const { classifyAction } = require('./policyEngine');

function createDecisionCertificate(input) {
  input = input || {};
  for (const k of ['subjectType','subjectId','question','recommendedAction']) {
    if (!input[k]) throw new Error('DECISION_' + k.toUpperCase() + '_REQUIRED');
  }
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (!evidence.length) throw new Error('DECISION_REQUIRES_EVIDENCE');
  if (evidence.every(e => e.source === 'ai_simulated')) throw new Error('DECISION_REQUIRES_NON_SIMULATED_EVIDENCE');
  const classification = classifyAction({
    ...input.policyContext,
    confidence: input.confidence,
    riskScore: input.riskScore,
    evidenceCount: evidence.length
  });
  const cert = {
    certificateId: input.certificateId || crypto.randomUUID(),
    version: '1.0',
    subjectType: String(input.subjectType), subjectId: String(input.subjectId),
    question: String(input.question), recommendedAction: String(input.recommendedAction),
    evidence: evidence.map(e => ({ id: e.id || e.factId, source: e.source, observedAt: e.observedAt, hash: e.contentHash || e.hash || null })),
    alternatives: Array.isArray(input.alternatives) ? input.alternatives : [],
    confidence: Number(input.confidence), riskScore: Number(input.riskScore),
    policyBasis: input.policyBasis || null,
    classification,
    rollbackPlan: input.rollbackPlan || null,
    approval: { required: classification.decision === 'APPROVAL_REQUIRED', status: classification.decision === 'APPROVAL_REQUIRED' ? 'PENDING' : 'NOT_REQUIRED' },
    uncertainty: input.uncertainty || null,
    createdAt: new Date().toISOString()
  };
  cert.integrityHash = crypto.createHash('sha256').update(JSON.stringify(canonical(cert))).digest('hex');
  return Object.freeze(cert);
}

function verifyDecisionCertificate(cert) {
  if (!cert || !cert.integrityHash) return { ok: false, reason: 'CERTIFICATE_HASH_MISSING' };
  if (typeof cert.integrityHash !== 'string' || !/^[a-f0-9]{64}$/i.test(cert.integrityHash)) {
    return { ok: false, reason: 'CERTIFICATE_HASH_INVALID' };
  }
  const copy = { ...cert }; delete copy.integrityHash;
  const hash = crypto.createHash('sha256').update(JSON.stringify(canonical(copy))).digest('hex');
  return { ok: crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(cert.integrityHash, 'hex')), calculated: hash };
}
module.exports = { createDecisionCertificate, verifyDecisionCertificate };
