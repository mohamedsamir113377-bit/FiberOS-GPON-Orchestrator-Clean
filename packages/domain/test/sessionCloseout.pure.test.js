'use strict';

/**
 * Session closeout pure tests — modules added in 2026-09-17 hardening.
 * No network, no DB, no invented OTDR layouts.
 */

const { assessTicketExceptions, rankExceptionBoard } = require('../src/exceptionBoardSignals');
const { compareLinkBudget } = require('../src/linkBudgetComparison');
const { assessPathPlausibility } = require('../src/geometricPlausibility');
const { createAssetFingerprint } = require('../src/assetFingerprint');
const { estimateConstructionCost } = require('../src/constructionCostEstimator');
const { STANDARDS_NOTE, listRegisteredVendors, processOtdrBuffer } =
  require('../../adapters/src/global/otdrVendorRegistry');
const { diagnoseWithPack, createExampleStructuralPack } =
  require('../../engineering/src/calibratedLikelihoodPack');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  PASS:', msg);
  } else {
    failed += 1;
    console.error('  FAIL:', msg);
  }
}

console.log('=== Exception board ===');
{
  const a = assessTicketExceptions({ ticketId: '1', slaBreached: true });
  assert(a.severity === 'HIGH' && a.reasons.includes('SLA_BREACHED'), 'SLA high');
  const b = assessTicketExceptions({ id: '2', status: 'in_progress' });
  assert(b.reasons.includes('OPEN_ACTIVE_STATUS') && b.severity === 'LOW', 'open status low');
  const c = assessTicketExceptions({ id: '3', status: 'completed' });
  assert(c.needsAttention === false, 'completed not attention');
  const ranked = rankExceptionBoard([
    { ticketId: 'A', slaBreached: true },
    { ticketId: 'B', status: 'pending' },
    { ticketId: 'C', status: 'completed' }
  ]);
  assert(ranked.length === 2 && ranked[0].ticketId === 'A', 'rank high first');
}

console.log('=== Link budget comparison ===');
{
  const r = compareLinkBudget({
    design: { lengthKm: 1, splitters: ['1:4'], splices: 2, connectors: 2 },
    measuredRxDbm: -20
  });
  assert(r.calculated && r.calculated.note === 'CALCULATED_NOT_MEASURED', 'calc tagged');
  assert(Array.isArray(r.reasons) && r.reasons.length > 0, 'reasons present');
}

console.log('=== Geometric plausibility ===');
{
  const bad = assessPathPlausibility({ lengthMeters: 9000, vertexCount: 2 });
  assert(bad.plausible === false, 'long sparse path rejected');
  const good = assessPathPlausibility({ lengthMeters: 200, vertexCount: 12 });
  assert(good.plausible === true, 'reasonable path ok');
}

console.log('=== Asset fingerprint ===');
{
  const fp = createAssetFingerprint({ assetType: 'ODF', serial: 'S1', assetId: 'X' });
  assert(typeof fp.fingerprint === 'string' && fp.fingerprint.length === 64, 'sha256 hex');
  const fp2 = createAssetFingerprint({ assetType: 'ODF', serial: 'S1', assetId: 'X' });
  assert(fp.fingerprint === fp2.fingerprint, 'deterministic');
}

console.log('=== Construction cost ===');
{
  const c = estimateConstructionCost({
    lengthKm: 0.1,
    splices: 4,
    connectors: 2,
    splitters: ['1:8'],
    unitRates: { perKm: 1000, perSplice: 10, perConnector: 5, perSplitterType: { '1:8': 50 } }
  });
  assert(c && c.costs && c.costs.total === 200 && c.advisory === true, 'cost computed');
}

console.log('=== OTDR registry standards ===');
{
  assert(STANDARDS_NOTE.otodrBinary.indexOf('SR-4731') !== -1, 'SR-4731');
  assert(STANDARDS_NOTE.g988.indexOf('OMCI') !== -1, 'G.988 OMCI');
  assert(listRegisteredVendors().length === 0, 'empty registry');
  try {
    processOtdrBuffer(Buffer.alloc(8), 'EXFO');
    assert(false, 'should reject tiny buffer');
  } catch (e) {
    assert(true, 'rejects invalid SOR buffer');
  }
}

console.log('=== Calibrated pack advisory ===');
{
  const pack = createExampleStructuralPack();
  const d = diagnoseWithPack(pack, { lossDb: 0.9, reflectanceDb: -55 });
  assert(d.advisory === true, 'advisory flag');
  assert(d.packId && d.ranking && d.ranking.length >= 2, 'ranking present');
}

console.log('');
console.log(`Closeout tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('SESSION CLOSEOUT PURE TESTS OK');
