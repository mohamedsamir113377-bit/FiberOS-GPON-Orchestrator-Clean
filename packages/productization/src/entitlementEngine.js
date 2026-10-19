'use strict';

/**
 * Entitlement & Usage Engine — pure structural evaluation.
 *
 * Inputs are ledger aggregates and plan entitlement rows loaded under RLS.
 * Never invents usage, limits, or commercial prices.
 */

const KNOWN_METRICS = Object.freeze([
  'users.seats',
  'contractor.seats',
  'work_items.period',
  'reports.period',
  'api.calls.period',
  'gis.queries.period',
  'optical.analysis.period',
  'storage.bytes'
]);

const ORDER_TYPES = Object.freeze([
  'SERVICE_REQUEST',
  'INSTALLATION',
  'MAINTENANCE',
  'UPGRADE',
  'DOWNGRADE',
  'RELOCATION',
  'NEW_CIRCUIT',
  'CAPACITY',
  'PLANNED_MAINTENANCE',
  'EMERGENCY_INCIDENT',
  'CONTRACTOR_WORK'
]);

const ORDER_STATUSES = Object.freeze([
  'draft',
  'submitted',
  'accepted',
  'in_progress',
  'awaiting_acceptance',
  'accepted_closed',
  'rejected',
  'cancelled'
]);

/** Allowed transitions — explicit finite state machine */
const ORDER_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['submitted', 'cancelled']),
  submitted: Object.freeze(['accepted', 'rejected', 'cancelled']),
  accepted: Object.freeze(['in_progress', 'cancelled']),
  in_progress: Object.freeze(['awaiting_acceptance', 'cancelled']),
  awaiting_acceptance: Object.freeze(['accepted_closed', 'in_progress']),
  accepted_closed: Object.freeze([]),
  rejected: Object.freeze([]),
  cancelled: Object.freeze([])
});

function assertArray(value, code) {
  if (!Array.isArray(value)) {
    const e = new Error(code);
    e.code = code;
    e.statusCode = 400;
    throw e;
  }
}

function normalizeMetricCode(value) {
  const code = String(value || '').trim();
  if (!KNOWN_METRICS.includes(code)) {
    const e = new Error('ENTITLEMENT_METRIC_UNKNOWN');
    e.code = 'ENTITLEMENT_METRIC_UNKNOWN';
    e.statusCode = 400;
    throw e;
  }
  return code;
}

function normalizeOrderType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (!ORDER_TYPES.includes(t)) {
    const e = new Error('SERVICE_ORDER_TYPE_INVALID');
    e.code = 'SERVICE_ORDER_TYPE_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return t;
}

function normalizeOrderStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!ORDER_STATUSES.includes(s)) {
    const e = new Error('SERVICE_ORDER_STATUS_INVALID');
    e.code = 'SERVICE_ORDER_STATUS_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return s;
}

/**
 * period_key helpers — calendar partitions only (no invented fiscal calendars).
 */
function periodKeyFor(interval, at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) {
    const e = new Error('ENTITLEMENT_PERIOD_INVALID');
    e.code = 'ENTITLEMENT_PERIOD_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const cadence = String(interval || 'monthly').toLowerCase();
  if (cadence === 'yearly') return String(y);
  if (cadence === 'weekly') {
    // ISO week
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return `${y}-${m}`;
}

/**
 * Aggregate ledger rows for a metric in a period.
 * For aggregation 'sum' sum deltas; for 'max' take max positive running is not
 * reconstructed here — caller supplies pre-aggregated used value.
 */
function sumUsageDeltas(ledgerRows, metricCode, periodKey) {
  assertArray(ledgerRows, 'ENTITLEMENT_LEDGER_INVALID');
  const code = normalizeMetricCode(metricCode);
  let total = 0;
  for (const row of ledgerRows) {
    if (!row) continue;
    if (String(row.metricCode || row.metric_code) !== code) continue;
    if (String(row.periodKey || row.period_key) !== String(periodKey)) continue;
    const delta = Number(row.delta);
    if (!Number.isFinite(delta)) continue;
    total += delta;
  }
  return total;
}

/**
 * Evaluate one metric: provisioned limit vs used.
 * limit null => unlimited.
 */
function evaluateMetricEntitlement({ metricCode, limitValue, usedValue, softWarnRatio = null, hardEnforce = true }) {
  const code = normalizeMetricCode(metricCode);
  const used = usedValue == null ? 0 : Number(usedValue);
  if (!Number.isFinite(used) || used < 0) {
    const e = new Error('ENTITLEMENT_USED_INVALID');
    e.code = 'ENTITLEMENT_USED_INVALID';
    e.statusCode = 400;
    throw e;
  }

  const unlimited = limitValue == null;
  const limit = unlimited ? null : Number(limitValue);
  if (!unlimited && (!Number.isFinite(limit) || limit < 0)) {
    const e = new Error('ENTITLEMENT_LIMIT_INVALID');
    e.code = 'ENTITLEMENT_LIMIT_INVALID';
    e.statusCode = 400;
    throw e;
  }

  const remaining = unlimited ? null : Math.max(0, limit - used);
  const overBy = unlimited ? 0 : Math.max(0, used - limit);
  const ratio = unlimited || limit === 0 ? null : used / limit;
  let softWarn = false;
  if (!unlimited && softWarnRatio != null && ratio != null) {
    const sw = Number(softWarnRatio);
    if (Number.isFinite(sw) && sw > 0 && sw < 1 && ratio >= sw) softWarn = true;
  }
  const hardBreached = !unlimited && hardEnforce !== false && used > limit;

  return Object.freeze({
    metricCode: code,
    unlimited,
    limit: limit,
    used,
    remaining,
    overBy,
    ratio: ratio == null ? null : Number(ratio.toFixed(6)),
    softWarn,
    hardBreached,
    hardEnforce: hardEnforce !== false,
    status: hardBreached ? 'over_limit' : softWarn ? 'warn' : unlimited ? 'unlimited' : 'ok'
  });
}

/**
 * Full entitlement snapshot for active plan entitlements + usage map.
 * usageByMetric: { [metricCode]: number }
 * entitlements: [{ metricCode, limitValue, softWarnRatio, hardEnforce }]
 */
function evaluatePlanEntitlements({ entitlements = [], usageByMetric = {} } = {}) {
  assertArray(entitlements, 'ENTITLEMENT_ROWS_INVALID');
  if (!usageByMetric || typeof usageByMetric !== 'object') {
    const e = new Error('ENTITLEMENT_USAGE_MAP_INVALID');
    e.code = 'ENTITLEMENT_USAGE_MAP_INVALID';
    e.statusCode = 400;
    throw e;
  }

  const metrics = entitlements.map((row) =>
    evaluateMetricEntitlement({
      metricCode: row.metricCode || row.metric_code,
      limitValue: row.limitValue != null ? row.limitValue : row.limit_value,
      usedValue: usageByMetric[row.metricCode || row.metric_code] || 0,
      softWarnRatio: row.softWarnRatio != null ? row.softWarnRatio : row.soft_warn_ratio,
      hardEnforce: row.hardEnforce != null ? row.hardEnforce : row.hard_enforce
    })
  );

  const blocked = metrics.filter((m) => m.hardBreached).map((m) => m.metricCode);
  return Object.freeze({
    schema: 'fiberos.entitlement-snapshot.v1',
    metrics: Object.freeze(metrics),
    blockedMetrics: Object.freeze(blocked),
    allowed: blocked.length === 0,
    authority: 'SERVER_USAGE_LEDGER_AND_PLAN_ENTITLEMENTS'
  });
}

/**
 * Decide whether a proposed consumption is allowed.
 * proposedDelta > 0.
 */
function authorizeUsage({ entitlements = [], usageByMetric = {}, metricCode, proposedDelta }) {
  const code = normalizeMetricCode(metricCode);
  const delta = Number(proposedDelta);
  if (!Number.isFinite(delta) || delta <= 0) {
    const e = new Error('ENTITLEMENT_PROPOSED_DELTA_INVALID');
    e.code = 'ENTITLEMENT_PROPOSED_DELTA_INVALID';
    e.statusCode = 400;
    throw e;
  }

  const row = (entitlements || []).find(
    (r) => String(r.metricCode || r.metric_code) === code
  );
  if (!row) {
    // Metric not on plan: deny by default (fail closed)
    return Object.freeze({
      allowed: false,
      reason: 'METRIC_NOT_ENTITLED',
      metricCode: code,
      authority: 'ENTITLEMENT_FAIL_CLOSED'
    });
  }

  const currentUsed = Number(usageByMetric[code] || 0) || 0;
  const projected = evaluateMetricEntitlement({
    metricCode: code,
    limitValue: row.limitValue != null ? row.limitValue : row.limit_value,
    usedValue: currentUsed + delta,
    softWarnRatio: row.softWarnRatio != null ? row.softWarnRatio : row.soft_warn_ratio,
    hardEnforce: row.hardEnforce != null ? row.hardEnforce : row.hard_enforce
  });

  if (projected.hardBreached) {
    return Object.freeze({
      allowed: false,
      reason: 'OVER_LIMIT',
      metricCode: code,
      projected,
      authority: 'ENTITLEMENT_HARD_ENFORCE'
    });
  }

  return Object.freeze({
    allowed: true,
    reason: null,
    metricCode: code,
    projected,
    authority: 'ENTITLEMENT_HARD_ENFORCE'
  });
}

function canTransitionOrder(fromStatus, toStatus) {
  const from = normalizeOrderStatus(fromStatus);
  const to = normalizeOrderStatus(toStatus);
  const allowed = ORDER_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

function assertOrderTransition(fromStatus, toStatus) {
  if (!canTransitionOrder(fromStatus, toStatus)) {
    const e = new Error('SERVICE_ORDER_TRANSITION_INVALID');
    e.code = 'SERVICE_ORDER_TRANSITION_INVALID';
    e.statusCode = 409;
    e.from = fromStatus;
    e.to = toStatus;
    throw e;
  }
  return true;
}

/**
 * SLA clock evaluation from documented events only.
 * events: [{ clockKind, occurredAt, evidenceClass }]
 * contract: { responseMinutes, restoreMinutes, resolutionMinutes }
 */
function evaluateSlaClocks({ contract = {}, events = [], now = new Date() } = {}) {
  assertArray(events, 'SLA_EVENTS_INVALID');
  const byKind = new Map();
  for (const ev of events) {
    if (!ev) continue;
    const kind = String(ev.clockKind || ev.clock_kind || '').toLowerCase();
    const at = new Date(ev.occurredAt || ev.occurred_at);
    if (Number.isNaN(at.getTime())) continue;
    const evidence = String(ev.evidenceClass || ev.evidence_class || 'unverified');
    if (!byKind.has(kind) || at < byKind.get(kind).at) {
      byKind.set(kind, { at, evidenceClass: evidence });
    }
  }

  const detected = byKind.get('detected') || null;
  const responded = byKind.get('responded') || null;
  const restored = byKind.get('restored') || null;
  const resolved = byKind.get('resolved') || null;
  const nowDate = now instanceof Date ? now : new Date(now);

  function windowResult(start, end, limitMinutes, label) {
    if (!start) {
      return Object.freeze({
        label,
        status: 'unknown',
        reason: 'START_CLOCK_MISSING',
        elapsedMinutes: null,
        limitMinutes: limitMinutes == null ? null : Number(limitMinutes),
        breached: null
      });
    }
    const endAt = end ? end.at : nowDate;
    const elapsed = (endAt.getTime() - start.at.getTime()) / 60000;
    const limit = limitMinutes == null ? null : Number(limitMinutes);
    const breached = limit == null ? null : elapsed > limit;
    return Object.freeze({
      label,
      status: end ? (breached ? 'breached' : 'met') : limit == null ? 'open' : elapsed > limit ? 'breached' : 'open',
      elapsedMinutes: Number(elapsed.toFixed(3)),
      limitMinutes: limit,
      breached,
      startAt: start.at.toISOString(),
      endAt: end ? end.at.toISOString() : null,
      startEvidenceClass: start.evidenceClass,
      endEvidenceClass: end ? end.evidenceClass : null
    });
  }

  return Object.freeze({
    schema: 'fiberos.sla-clock-evaluation.v1',
    response: windowResult(detected, responded, contract.responseMinutes ?? contract.response_minutes, 'response'),
    restore: windowResult(detected, restored, contract.restoreMinutes ?? contract.restore_minutes, 'restore'),
    resolution: windowResult(detected, resolved, contract.resolutionMinutes ?? contract.resolution_minutes, 'resolution'),
    authority: 'DATABASE_EVENT_TIMESTAMPS_ONLY',
    note: 'No UI timers. Missing clocks remain unknown; no invented ETA.'
  });
}

module.exports = {
  KNOWN_METRICS,
  ORDER_TYPES,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  normalizeMetricCode,
  normalizeOrderType,
  normalizeOrderStatus,
  periodKeyFor,
  sumUsageDeltas,
  evaluateMetricEntitlement,
  evaluatePlanEntitlements,
  authorizeUsage,
  canTransitionOrder,
  assertOrderTransition,
  evaluateSlaClocks
};
