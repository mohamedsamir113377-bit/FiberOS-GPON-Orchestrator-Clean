'use strict';

/**
 * Contractor Work Package + Commercial Reconciliation pure engine.
 * Status names align with ftth_work_packages.status (migration 060).
 * Commercial SoD aligns with contractor_work_measurements + recon guards.
 */

const WP_STATUSES = Object.freeze([
  'planned',
  'ready',
  'assigned',
  'in_progress',
  'blocked',
  'submitted',
  'qc_pending',
  'rework',
  'accepted',
  'rejected',
  'closed',
  'cancelled'
]);

/** Explicit contractor-oriented transitions on the canonical status set */
const WP_TRANSITIONS = Object.freeze({
  planned: Object.freeze(['ready', 'assigned', 'cancelled']),
  ready: Object.freeze(['assigned', 'cancelled']),
  assigned: Object.freeze(['in_progress', 'blocked', 'cancelled']),
  in_progress: Object.freeze(['submitted', 'blocked', 'cancelled']),
  blocked: Object.freeze(['in_progress', 'assigned', 'cancelled']),
  submitted: Object.freeze(['qc_pending', 'rework', 'cancelled']),
  qc_pending: Object.freeze(['accepted', 'rework', 'rejected']),
  rework: Object.freeze(['in_progress', 'submitted', 'cancelled']),
  accepted: Object.freeze(['closed']),
  rejected: Object.freeze(['rework', 'closed']),
  closed: Object.freeze([]),
  cancelled: Object.freeze([])
});

const EVENT_FOR_STATUS = Object.freeze({
  assigned: 'assigned',
  in_progress: 'started',
  submitted: 'evidence_submitted',
  qc_pending: 'qc_submitted',
  rework: 'rework_requested',
  accepted: 'tech_accepted',
  closed: 'closed',
  cancelled: 'cancelled',
  blocked: 'blocked'
});

const MEASUREMENT_STATUSES = Object.freeze([
  'draft',
  'submitted',
  'verified',
  'rejected',
  'approved',
  'invoiced',
  'paid'
]);

const RECON_STATUSES = Object.freeze([
  'open',
  'checker_approved',
  'invoiced',
  'payment_pending',
  'payment_reconciled',
  'disputed',
  'cancelled'
]);

function normalizeWpStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!WP_STATUSES.includes(s)) {
    const e = new Error('WORK_PACKAGE_STATUS_INVALID');
    e.code = 'WORK_PACKAGE_STATUS_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return s;
}

function canTransitionWorkPackage(fromStatus, toStatus) {
  const from = normalizeWpStatus(fromStatus);
  const to = normalizeWpStatus(toStatus);
  return (WP_TRANSITIONS[from] || []).includes(to);
}

function assertWorkPackageTransition(fromStatus, toStatus) {
  if (!canTransitionWorkPackage(fromStatus, toStatus)) {
    const e = new Error('WORK_PACKAGE_TRANSITION_INVALID');
    e.code = 'WORK_PACKAGE_TRANSITION_INVALID';
    e.statusCode = 409;
    e.from = fromStatus;
    e.to = toStatus;
    throw e;
  }
  return true;
}

function eventTypeForTransition(toStatus) {
  const to = normalizeWpStatus(toStatus);
  return EVENT_FOR_STATUS[to] || 'started';
}

/**
 * Maker/Checker: measured_by must differ from verified_by for verify/approve.
 */
function assertMeasurementSegregation({ measuredBy, verifiedBy, targetStatus }) {
  const status = String(targetStatus || '').toLowerCase();
  if (['verified', 'approved', 'invoiced', 'paid'].includes(status)) {
    if (!verifiedBy) {
      const e = new Error('CONTRACTOR_MEASUREMENT_REQUIRES_INDEPENDENT_VERIFICATION');
      e.code = 'CONTRACTOR_MEASUREMENT_REQUIRES_INDEPENDENT_VERIFICATION';
      e.statusCode = 409;
      throw e;
    }
    if (String(verifiedBy) === String(measuredBy)) {
      const e = new Error('CONTRACTOR_MEASUREMENT_SEPARATION_OF_DUTIES_REQUIRED');
      e.code = 'CONTRACTOR_MEASUREMENT_SEPARATION_OF_DUTIES_REQUIRED';
      e.statusCode = 409;
      throw e;
    }
  }
  return true;
}

/**
 * Commercial reconciliation SoD + provider evidence gate.
 */
function assertReconciliationRules({
  makerId,
  checkerId,
  status,
  providerPaymentRef,
  providerEvidenceClass
}) {
  const s = String(status || '').toLowerCase();
  if (!RECON_STATUSES.includes(s)) {
    const e = new Error('COMMERCIAL_RECON_STATUS_INVALID');
    e.code = 'COMMERCIAL_RECON_STATUS_INVALID';
    e.statusCode = 400;
    throw e;
  }
  if (checkerId && String(checkerId) === String(makerId)) {
    const e = new Error('COMMERCIAL_RECON_SEPARATION_OF_DUTIES_REQUIRED');
    e.code = 'COMMERCIAL_RECON_SEPARATION_OF_DUTIES_REQUIRED';
    e.statusCode = 409;
    throw e;
  }
  if (['checker_approved', 'invoiced', 'payment_pending', 'payment_reconciled'].includes(s) && !checkerId) {
    const e = new Error('COMMERCIAL_RECON_CHECKER_REQUIRED');
    e.code = 'COMMERCIAL_RECON_CHECKER_REQUIRED';
    e.statusCode = 409;
    throw e;
  }
  if (s === 'payment_reconciled') {
    const ref = String(providerPaymentRef || '').trim();
    if (ref.length < 4) {
      const e = new Error('COMMERCIAL_RECON_PROVIDER_EVIDENCE_REQUIRED');
      e.code = 'COMMERCIAL_RECON_PROVIDER_EVIDENCE_REQUIRED';
      e.statusCode = 409;
      throw e;
    }
    const cls = String(providerEvidenceClass || '');
    if (!['provider_callback', 'measured', 'observed'].includes(cls)) {
      const e = new Error('COMMERCIAL_RECON_PROVIDER_EVIDENCE_CLASS_INVALID');
      e.code = 'COMMERCIAL_RECON_PROVIDER_EVIDENCE_CLASS_INVALID';
      e.statusCode = 409;
      throw e;
    }
  }
  return true;
}

/**
 * amount_minor = quantity * rate_minor (integer minor units, no float money).
 */
function computeMeasurementAmountMinor(quantity, rateMinor) {
  const q = Number(quantity);
  const r = Number(rateMinor);
  if (!Number.isFinite(q) || q <= 0) {
    const e = new Error('MEASUREMENT_QUANTITY_INVALID');
    e.code = 'MEASUREMENT_QUANTITY_INVALID';
    e.statusCode = 400;
    throw e;
  }
  if (!Number.isInteger(r) || r < 0) {
    const e = new Error('MEASUREMENT_RATE_INVALID');
    e.code = 'MEASUREMENT_RATE_INVALID';
    e.statusCode = 400;
    throw e;
  }
  // quantity may be decimal (e.g. 12.5 m). Scale to 4 dp then multiply.
  const scaled = Math.round(q * 10000);
  return Math.trunc((scaled * r) / 10000);
}

/**
 * Detect SLA threshold crossings from an evaluation window result.
 * Returns zero or more enforcement candidates — never invents ETA.
 */
function detectSlaThresholds({ evaluationWindow, clockKind }) {
  if (!evaluationWindow || evaluationWindow.elapsedMinutes == null || evaluationWindow.limitMinutes == null) {
    return Object.freeze([]);
  }
  const elapsed = Number(evaluationWindow.elapsedMinutes);
  const limit = Number(evaluationWindow.limitMinutes);
  if (!Number.isFinite(elapsed) || !Number.isFinite(limit) || limit <= 0) {
    return Object.freeze([]);
  }
  const ratio = (elapsed / limit) * 100;
  const out = [];
  if (ratio >= 100) {
    out.push(
      Object.freeze({
        clockKind: String(clockKind),
        thresholdPct: 100,
        elapsedMinutes: elapsed,
        limitMinutes: limit,
        state: 'breached'
      })
    );
  } else if (ratio >= 80) {
    out.push(
      Object.freeze({
        clockKind: String(clockKind),
        thresholdPct: 80,
        elapsedMinutes: elapsed,
        limitMinutes: limit,
        state: 'breach_risk'
      })
    );
  }
  return Object.freeze(out);
}

function detectAllSlaThresholds(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') return Object.freeze([]);
  const kinds = ['response', 'restore', 'resolution'];
  const all = [];
  for (const kind of kinds) {
    const window = evaluation[kind];
    if (!window) continue;
    for (const t of detectSlaThresholds({ evaluationWindow: window, clockKind: kind })) {
      all.push(t);
    }
  }
  return Object.freeze(all);
}

module.exports = {
  WP_STATUSES,
  WP_TRANSITIONS,
  MEASUREMENT_STATUSES,
  RECON_STATUSES,
  normalizeWpStatus,
  canTransitionWorkPackage,
  assertWorkPackageTransition,
  eventTypeForTransition,
  assertMeasurementSegregation,
  assertReconciliationRules,
  computeMeasurementAmountMinor,
  detectSlaThresholds,
  detectAllSlaThresholds
};
