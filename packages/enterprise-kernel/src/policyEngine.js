'use strict';

const DECISIONS = Object.freeze(['AUTONOMOUS', 'ASSISTED', 'APPROVAL_REQUIRED', 'FORBIDDEN']);

function classifyAction(ctx) {
  ctx = ctx || {};
  const risk = Number(ctx.riskScore);
  const confidence = Number(ctx.confidence);
  const evidence = Number(ctx.evidenceCount || 0);
  const impact = String(ctx.impact || 'LOW').toUpperCase();
  if (ctx.forbidden === true) return { decision: 'FORBIDDEN', reason: 'POLICY_FORBIDDEN' };
  if (!ctx.capabilityOk) return { decision: 'FORBIDDEN', reason: 'CAPABILITY_UNAVAILABLE' };
  if (!ctx.policyOk) return { decision: 'FORBIDDEN', reason: 'POLICY_FAILED' };
  if (!ctx.rollbackPossible) return { decision: 'APPROVAL_REQUIRED', reason: 'ROLLBACK_REQUIRED' };
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { decision: 'APPROVAL_REQUIRED', reason: 'CONFIDENCE_INVALID' };
  if (!Number.isFinite(risk) || risk < 0 || risk > 1) return { decision: 'APPROVAL_REQUIRED', reason: 'RISK_INVALID' };
  if (evidence < Number(ctx.minEvidence || 1)) return { decision: 'APPROVAL_REQUIRED', reason: 'EVIDENCE_INSUFFICIENT' };
  if (impact === 'CRITICAL' || risk >= Number(ctx.approvalRiskThreshold ?? 0.35) || confidence < Number(ctx.autonomousConfidenceThreshold ?? 0.95)) {
    return { decision: 'APPROVAL_REQUIRED', reason: 'RISK_OR_CONFIDENCE_THRESHOLD' };
  }
  if (ctx.autonomousAllowed !== true) return { decision: 'ASSISTED', reason: 'AUTONOMOUS_NOT_ENABLED' };
  return { decision: 'AUTONOMOUS', reason: 'POLICY_PASSED' };
}

module.exports = { DECISIONS, classifyAction };
