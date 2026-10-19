'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('../src/index.js');
const { KPI_CATALOG } = require('../../domain/src/kpiCatalog');

test('every KPI declared as deployed exists in the live domain catalog', () => {
  assert.equal(k.assertCatalogParity(KPI_CATALOG), true);
  assert.deepEqual([...k.DEPLOYED_KPI_IDS].sort(), Object.keys(KPI_CATALOG).sort());
  assert.deepEqual([...k.DEFERRED_KPI_DECLARATIONS], []);
  assert.throws(() => k.assertCatalogParity({}), /KPI_CATALOG_PARITY_MISSING:TICKET_VOLUME/);
  assert.throws(() => k.assertCatalogParity(null), /KPI_CATALOG_REQUIRED/);
});

test('department resolution maps only real catalog ids and has no frozen KPI prerequisite', () => {
  for (const department of k.DEPARTMENTS) {
    const out = k.resolveDepartmentKpis(department);
    assert.equal(out.department, department);
    assert.deepEqual([...out.invented], []);
    assert.deepEqual([...out.deferred], []);
    assert.deepEqual([...out.unavailable], []);
    assert.ok(out.computable.every((kpiId) => k.DEPLOYED_KPI_IDS.includes(kpiId)));
    assert.ok(out.declared.every((kpiId) => Object.prototype.hasOwnProperty.call(KPI_CATALOG, kpiId)));
  }
  assert.deepEqual(
    [...k.resolveDepartmentKpis('WAREHOUSE').computable],
    ['CABLE_REEL_REMAINDER_METERS', 'OPEN_BACKLOG', 'TICKET_VOLUME']
  );
  assert.throws(() => k.resolveDepartmentKpis('MARKETING'), /KPI_DEPARTMENT_UNKNOWN/);
});

test('ticket KPIs are computed from persisted ticket facts without inference', () => {
  const out = k.computeTicketMetrics({
    periodTickets: [
      {
        status: 'completed',
        createdAt: '2026-10-08T08:00:00Z',
        closedAt: '2026-10-08T09:00:00Z',
        slaDeadline: '2026-10-08T10:00:00Z',
        reopenTrackingObserved: true,
        reopenedAt: null
      },
      {
        status: 'completed',
        createdAt: '2026-10-08T08:00:00Z',
        closedAt: '2026-10-08T12:00:00Z',
        slaDeadline: '2026-10-08T11:00:00Z',
        reopenTrackingObserved: true,
        reopenedAt: '2026-10-08T10:30:00Z'
      },
      {
        status: 'faulty',
        createdAt: '2026-10-08T08:00:00Z',
        closedAt: '2026-10-08T09:30:00Z'
      }
    ],
    openBacklog: 4
  });

  assert.equal(out.TICKET_VOLUME.value, 3);
  assert.equal(out.SLA_COMPLIANCE_RATE.value, 50);
  assert.equal(out.AVG_RESOLUTION_MINUTES.value, 150);
  assert.equal(out.OPEN_BACKLOG.value, 4);
  // faulty / (completed + faulty) = 1/3 — do not invent a 50% rate from volume shortcuts
  assert.equal(out.FAILURE_RATE.value, 33.33);
  assert.equal(out.FIRST_TIME_FIX_RATE.value, 50);
});

test('travel KPI only counts observed movement intervals with bounded samples', () => {
  const minutes = k.computeObservedMovementMinutes([
    { technicianId: 't1', capturedAt: '2026-10-08T08:00:00Z', speedMps: 1 },
    { technicianId: 't1', capturedAt: '2026-10-08T08:10:00Z', speedMps: 1 },
    { technicianId: 't1', capturedAt: '2026-10-08T09:00:00Z', speedMps: 1 },
    { technicianId: 't2', capturedAt: '2026-10-08T08:00:00Z', speedMps: 0 },
    { technicianId: 't2', capturedAt: '2026-10-08T08:05:00Z', speedMps: 0 }
  ]);
  assert.equal(minutes, 10);
});

test('revenue KPI keeps currencies separate and uses billed ticket identity', () => {
  const out = k.computeRevenuePerBilledTicket([
    { ticketId: 't1', currency: 'EGP', amountMinor: 1000, status: 'issued' },
    { ticketId: 't2', currency: 'EGP', amountMinor: 3000, status: 'paid' },
    { ticketId: 't1', currency: 'EGP', amountMinor: 500, status: 'draft' },
    { ticketId: 't3', currency: 'USD', amountMinor: 200, status: 'overdue' }
  ]);
  assert.deepEqual(out, {
    EGP: { amountMinor: 4000, billedTickets: 2, averageMinorPerTicket: 2000 },
    USD: { amountMinor: 200, billedTickets: 1, averageMinorPerTicket: 200 }
  });
});

test('reel KPI is an exact millimetre ledger balance', () => {
  const out = k.computeReelRemainders([
    { reelId: 'R1', sku: 'F-48', warehouseId: 'W1', deltaMillimeters: 100000 },
    { reelId: 'R1', sku: 'F-48', warehouseId: 'W1', deltaMillimeters: -12500 },
    { reelId: 'R2', sku: 'F-96', warehouseId: 'W1', deltaMillimeters: 50000 }
  ]);
  assert.equal(out.totalRemainderMeters, 137.5);
  assert.equal(out.reels[0].remainderMeters, 87.5);
  assert.equal(out.reels[0].state, 'BALANCED');
});

test('splitter leg utilization returns used and allocated ratios separately', () => {
  const out = k.computeSplitterLegUtilisation({ total: 8, used: 5, reserved: 2 });
  assert.deepEqual(out, {
    total: 8,
    used: 5,
    reserved: 2,
    usedPercent: 62.5,
    allocatedPercent: 87.5
  });
});

test('PON optical margin requires path binding and measured field/NMS source', () => {
  const out = k.computePonOpticalMargin([
    { pathBound: true, servicePathVersionId: 'p1', source: 'field_reading', currentRxDbm: -20, expectedRxDbm: -24 },
    { pathBound: true, servicePathVersionId: 'p2', source: 'nms_poll', currentRxDbm: -21, expectedRxDbm: -24 },
    { pathBound: false, servicePathVersionId: 'p3', source: 'field_reading', currentRxDbm: 100, expectedRxDbm: 0 },
    { pathBound: true, servicePathVersionId: 'p4', source: 'ai_simulated', currentRxDbm: 100, expectedRxDbm: 0 }
  ]);
  assert.equal(out.value, 3.5);
  assert.equal(out.samples, 2);
});
