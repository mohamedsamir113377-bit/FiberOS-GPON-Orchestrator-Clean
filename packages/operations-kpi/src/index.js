'use strict';

/**
 * DEPARTMENT KPI RESOLUTION + DETERMINISTIC KPI COMPUTATION
 * ==========================================================
 * The resolver only advertises KPI ids that exist in @fiberos/domain.
 * The calculator consumes already-scoped database rows/aggregates and never
 * invents missing evidence. Null is used when an observable denominator is
 * zero or historical evidence is genuinely unavailable.
 */

const DEPARTMENTS = Object.freeze([
  'NETWORK_OPERATIONS',
  'CONSTRUCTION',
  'FIELD',
  'CALL_CENTER',
  'WAREHOUSE',
  'ENGINEERING'
]);

const DEPLOYED_KPI_IDS = Object.freeze([
  'TICKET_VOLUME',
  'SLA_COMPLIANCE_RATE',
  'AVG_RESOLUTION_MINUTES',
  'OPEN_BACKLOG',
  'FAILURE_RATE',
  'FIRST_TIME_FIX_RATE',
  'TECHNICIAN_TRAVEL_MINUTES',
  'REVENUE_PER_TICKET',
  'CABLE_REEL_REMAINDER_METERS',
  'SPLITTER_LEG_UTILISATION',
  'PON_OPTICAL_MARGIN_DB'
]);

const DEFERRED_KPI_DECLARATIONS = Object.freeze([]);

const DEPARTMENT_KPI_MAP = Object.freeze({
  NETWORK_OPERATIONS: Object.freeze([
    'TICKET_VOLUME', 'SLA_COMPLIANCE_RATE', 'AVG_RESOLUTION_MINUTES',
    'OPEN_BACKLOG', 'FAILURE_RATE', 'FIRST_TIME_FIX_RATE',
    'TECHNICIAN_TRAVEL_MINUTES', 'SPLITTER_LEG_UTILISATION'
  ]),
  CONSTRUCTION: Object.freeze([
    'TICKET_VOLUME', 'SLA_COMPLIANCE_RATE', 'OPEN_BACKLOG',
    'SPLITTER_LEG_UTILISATION'
  ]),
  FIELD: Object.freeze([
    'TICKET_VOLUME', 'SLA_COMPLIANCE_RATE', 'AVG_RESOLUTION_MINUTES',
    'OPEN_BACKLOG', 'FAILURE_RATE', 'FIRST_TIME_FIX_RATE',
    'TECHNICIAN_TRAVEL_MINUTES'
  ]),
  CALL_CENTER: Object.freeze([
    'TICKET_VOLUME', 'SLA_COMPLIANCE_RATE', 'AVG_RESOLUTION_MINUTES',
    'OPEN_BACKLOG', 'REVENUE_PER_TICKET'
  ]),
  WAREHOUSE: Object.freeze([
    'TICKET_VOLUME', 'OPEN_BACKLOG', 'CABLE_REEL_REMAINDER_METERS'
  ]),
  ENGINEERING: Object.freeze([
    'TICKET_VOLUME', 'AVG_RESOLUTION_MINUTES', 'FAILURE_RATE',
    'PON_OPTICAL_MARGIN_DB'
  ])
});

function assertCatalogParity(catalog) {
  if (!catalog || typeof catalog !== 'object') throw new Error('KPI_CATALOG_REQUIRED');
  const present = new Set(Object.keys(catalog));
  for (const kpiId of DEPLOYED_KPI_IDS) {
    if (!present.has(kpiId)) throw new Error(`KPI_CATALOG_PARITY_MISSING:${kpiId}`);
  }
  return true;
}

function deferredFor(department) {
  return DEFERRED_KPI_DECLARATIONS
    .filter((declaration) => declaration.departments.includes(department))
    .map((declaration) => Object.freeze({
      id: declaration.id,
      reason: declaration.reason,
      requiredColumns: declaration.requiredColumns,
      computable: false
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function resolveDepartmentKpis(department, options = {}) {
  const key = department == null ? '' : String(department).trim().toUpperCase();
  if (!DEPARTMENTS.includes(key)) throw new Error('KPI_DEPARTMENT_UNKNOWN');

  const available = options.availableKpiIds == null
    ? DEPLOYED_KPI_IDS
    : options.availableKpiIds;

  if (!Array.isArray(available)) throw new Error('KPI_AVAILABLE_IDS_INVALID');
  const availableSet = new Set(available.map(String));
  const declared = DEPARTMENT_KPI_MAP[key];

  const computable = declared.filter((kpiId) => availableSet.has(kpiId)).sort();
  const unavailable = declared.filter((kpiId) => !availableSet.has(kpiId)).sort();

  return Object.freeze({
    schema: 'fiberos.department-kpi.v2',
    department: key,
    declared: Object.freeze([...declared].sort()),
    computable: Object.freeze(computable),
    unavailable: Object.freeze(unavailable),
    deferred: Object.freeze(deferredFor(key)),
    invented: Object.freeze([])
  });
}

function pct(numerator, denominator) {
  if (!Number.isFinite(Number(denominator)) || Number(denominator) <= 0) return null;
  return Number(((Number(numerator) / Number(denominator)) * 100).toFixed(2));
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeTicketMetrics({
  periodTickets = [],
  openBacklog = 0
} = {}) {
  if (!Array.isArray(periodTickets)) throw new TypeError('KPI_PERIOD_TICKETS_INVALID');

  const completed = periodTickets.filter((t) => t && String(t.status).toLowerCase() === 'completed');
  const failed = periodTickets.filter((t) => t && String(t.status).toLowerCase() === 'faulty');
  const closedForFailure = completed.length + failed.length;

  const slaEligible = completed.filter((t) => t.closedAt && t.slaDeadline);
  const slaMet = slaEligible.filter((t) => new Date(t.closedAt).getTime() <= new Date(t.slaDeadline).getTime());

  const resolutionMinutes = completed
    .map((t) => (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / 60000)
    .filter((n) => Number.isFinite(n) && n >= 0);

  const observedCompleted = completed.filter((t) => t.reopenTrackingObserved === true);
  const firstTimeFix = observedCompleted.filter((t) => !t.reopenedAt).length;

  const meanResolution = resolutionMinutes.length
    ? Number((resolutionMinutes.reduce((a, b) => a + b, 0) / resolutionMinutes.length).toFixed(2))
    : null;

  return Object.freeze({
    TICKET_VOLUME: Object.freeze({ value: periodTickets.length, unit: 'count', basis: 'tickets.created_at' }),
    SLA_COMPLIANCE_RATE: Object.freeze({
      value: pct(slaMet.length, slaEligible.length),
      unit: 'percent',
      eligible: slaEligible.length
    }),
    AVG_RESOLUTION_MINUTES: Object.freeze({
      value: meanResolution,
      unit: 'minutes',
      samples: resolutionMinutes.length
    }),
    OPEN_BACKLOG: Object.freeze({ value: Number(openBacklog), unit: 'count', basis: 'current_open_statuses' }),
    FAILURE_RATE: Object.freeze({
      value: pct(failed.length, closedForFailure),
      unit: 'percent',
      denominator: closedForFailure
    }),
    FIRST_TIME_FIX_RATE: Object.freeze({
      value: pct(firstTimeFix, observedCompleted.length),
      unit: 'percent',
      observedCompleted: observedCompleted.length,
      numerator: firstTimeFix,
      observability: observedCompleted.length > 0 ? 'DATABASE_OBSERVED_REOPEN_STATE' : 'NO_OBSERVED_DENOMINATOR'
    })
  });
}

function computeObservedMovementMinutes(positions, {
  maxIntervalMinutes = 30
} = {}) {
  if (!Array.isArray(positions)) throw new TypeError('KPI_POSITIONS_INVALID');
  const grouped = new Map();

  for (const position of positions) {
    const technicianId = String(position?.technicianId ?? '').trim();
    if (!technicianId) continue;
    const capturedAt = new Date(position.capturedAt);
    const speedMps = finiteOrNull(position.speedMps);
    if (!Number.isFinite(capturedAt.getTime()) || speedMps == null || speedMps < 0) continue;
    const rows = grouped.get(technicianId) || [];
    rows.push({ capturedAt, speedMps });
    grouped.set(technicianId, rows);
  }

  let minutes = 0;
  for (const rows of grouped.values()) {
    rows.sort((a, b) => a.capturedAt - b.capturedAt);
    for (let i = 1; i < rows.length; i += 1) {
      const deltaMinutes = (rows[i].capturedAt - rows[i - 1].capturedAt) / 60000;
      if (deltaMinutes > 0 && deltaMinutes <= maxIntervalMinutes &&
          (rows[i].speedMps > 0 || rows[i - 1].speedMps > 0)) {
        minutes += deltaMinutes;
      }
    }
  }

  return Number(minutes.toFixed(2));
}

function computeRevenuePerBilledTicket(invoices) {
  if (!Array.isArray(invoices)) throw new TypeError('KPI_INVOICES_INVALID');
  const byCurrency = new Map();

  for (const row of invoices) {
    const ticketId = String(row?.ticketId ?? '').trim();
    const currency = String(row?.currency ?? '').trim().toUpperCase();
    const amountMinor = Number(row?.amountMinor);
    const status = String(row?.status ?? '').toLowerCase();

    if (!ticketId || !currency || !Number.isSafeInteger(amountMinor) || amountMinor < 0) continue;
    if (!['issued', 'paid', 'partially_paid', 'overdue'].includes(status)) continue;

    const entry = byCurrency.get(currency) || { amountMinor: 0, ticketIds: new Set() };
    entry.amountMinor += amountMinor;
    entry.ticketIds.add(ticketId);
    if (!Number.isSafeInteger(entry.amountMinor)) {
      throw new RangeError('KPI_REVENUE_SUM_EXCEEDS_SAFE_INTEGER');
    }
    byCurrency.set(currency, entry);
  }

  return Object.freeze(Object.fromEntries([...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, entry]) => [currency, Object.freeze({
      amountMinor: entry.amountMinor,
      billedTickets: entry.ticketIds.size,
      averageMinorPerTicket: entry.ticketIds.size
        ? Number((entry.amountMinor / entry.ticketIds.size).toFixed(2))
        : null
    })])));
}

function computeSplitterLegUtilisation({ used = 0, total = 0, reserved = 0 } = {}) {
  const totalCount = Number(total);
  const usedCount = Number(used);
  const reservedCount = Number(reserved);
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) throw new RangeError('KPI_SPLITTER_TOTAL_INVALID');
  if (!Number.isSafeInteger(usedCount) || usedCount < 0 || usedCount > totalCount) {
    throw new RangeError('KPI_SPLITTER_USED_INVALID');
  }
  if (!Number.isSafeInteger(reservedCount) || reservedCount < 0) throw new RangeError('KPI_SPLITTER_RESERVED_INVALID');

  return Object.freeze({
    total: totalCount,
    used: usedCount,
    reserved: reservedCount,
    usedPercent: pct(usedCount, totalCount),
    allocatedPercent: pct(usedCount + reservedCount, totalCount)
  });
}

function computePonOpticalMargin(rows) {
  if (!Array.isArray(rows)) throw new TypeError('KPI_PON_MARGIN_ROWS_INVALID');
  const margins = rows
    .filter((row) =>
      row &&
      row.pathBound === true &&
      row.servicePathVersionId &&
      ['field_reading', 'nms_poll'].includes(String(row.source))
    )
    .map((row) => Number(row.currentRxDbm) - Number(row.expectedRxDbm))
    .filter((n) => Number.isFinite(n));

  return Object.freeze({
    value: margins.length
      ? Number((margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(3))
      : null,
    unit: 'dB',
    samples: margins.length,
    evidenceBasis: 'PATH_BOUND_FIELD_OR_NMS_MEASUREMENT'
  });
}

function computeReelRemainders(rows) {
  if (!Array.isArray(rows)) throw new TypeError('KPI_REEL_ROWS_INVALID');
  const grouped = new Map();

  for (const row of rows) {
    const reelId = String(row?.reelId ?? '').trim();
    const deltaMillimeters = Number(row?.deltaMillimeters);
    if (!reelId || !Number.isSafeInteger(deltaMillimeters)) continue;
    const entry = grouped.get(reelId) || {
      reelId,
      sku: row?.sku == null ? null : String(row.sku),
      warehouseId: row?.warehouseId == null ? null : String(row.warehouseId),
      deltaMillimeters: 0
    };
    entry.deltaMillimeters += deltaMillimeters;
    if (!Number.isSafeInteger(entry.deltaMillimeters)) {
      throw new RangeError('KPI_REEL_BALANCE_EXCEEDS_SAFE_INTEGER');
    }
    grouped.set(reelId, entry);
  }

  const reels = [...grouped.values()]
    .sort((a, b) => a.reelId.localeCompare(b.reelId))
    .map((row) => Object.freeze({
      reelId: row.reelId,
      sku: row.sku,
      warehouseId: row.warehouseId,
      remainderMillimeters: row.deltaMillimeters,
      remainderMeters: Number((row.deltaMillimeters / 1000).toFixed(3)),
      state: row.deltaMillimeters < 0 ? 'NEGATIVE_BALANCE' : 'BALANCED'
    }));

  return Object.freeze({
    totalRemainderMeters: Number(reels.reduce((sum, row) => sum + row.remainderMeters, 0).toFixed(3)),
    reels: Object.freeze(reels)
  });
}

function computeDepartmentKpis(input = {}) {
  const tickets = computeTicketMetrics(input);
  const metrics = {
    ...tickets,
    TECHNICIAN_TRAVEL_MINUTES: Object.freeze({
      value: computeObservedMovementMinutes(input.positions || []),
      unit: 'minutes',
      basis: 'GPS_OBSERVED_MOVING_INTERVALS',
      maxIntervalMinutes: 30
    }),
    REVENUE_PER_TICKET: Object.freeze({
      valueByCurrency: computeRevenuePerBilledTicket(input.invoices || []),
      unit: 'minor_currency_units_per_ticket',
      basis: 'persisted_non_void_invoices_with_ticket_id'
    }),
    CABLE_REEL_REMAINDER_METERS: Object.freeze({
      ...computeReelRemainders(input.reelLedger || [])
    }),
    SPLITTER_LEG_UTILISATION: computeSplitterLegUtilisation(input.splitterLegs || {}),
    PON_OPTICAL_MARGIN_DB: computePonOpticalMargin(input.opticalMargins || [])
  };

  return Object.freeze(metrics);
}

module.exports = Object.freeze({
  DEPARTMENTS,
  DEPLOYED_KPI_IDS,
  DEFERRED_KPI_DECLARATIONS,
  DEPARTMENT_KPI_MAP,
  assertCatalogParity,
  resolveDepartmentKpis,
  computeTicketMetrics,
  computeObservedMovementMinutes,
  computeRevenuePerBilledTicket,
  computeReelRemainders,
  computeSplitterLegUtilisation,
  computePonOpticalMargin,
  computeDepartmentKpis
});
