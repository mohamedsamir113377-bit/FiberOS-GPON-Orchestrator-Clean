'use strict';

const { processOtdrBuffer, listRegisteredVendors, STANDARDS_NOTE, registerVendorResolver } = require('../../adapters/src/global/otdrVendorRegistry');
const { diagnoseWithPack, createExampleStructuralPack } = require('../../engineering/src/calibratedLikelihoodPack');
const { compareLinkBudget } = require('../src/linkBudgetComparison');
const { assessPathPlausibility } = require('../src/geometricPlausibility');
const { rankExceptionBoard } = require('../src/exceptionBoardSignals');
const { createAssetFingerprint } = require('../src/assetFingerprint');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log('  PASS:', m); } else { failed++; console.error('  FAIL:', m); } }

console.log('=== A OTDR Registry / Standards ===');
assert(STANDARDS_NOTE.otodrBinary.indexOf('SR-4731') !== -1, 'SR-4731 is the OTDR binary standard');
assert(STANDARDS_NOTE.g988.indexOf('OMCI') !== -1, 'G.988 correctly identified as OMCI');
assert(listRegisteredVendors().length === 0, 'registry starts empty');
// Minimal fake buffer that will fail signature (expected)
try {
  processOtdrBuffer(Buffer.alloc(50), 'EXFO');
  assert(false, 'should throw on tiny buffer');
} catch (e) {
  assert(String(e.message).indexOf('ERR_') !== -1 || String(e.message).indexOf('INVALID') !== -1 || String(e.message).indexOf('missing') !== -1, 'rejects invalid buffer');
}

console.log('=== B Calibrated Pack ===');
const pack = createExampleStructuralPack();
const diag = diagnoseWithPack(pack, { lossDb: 0.8, reflectanceDb: -60 });
assert(diag.advisory === true, 'pack diagnosis is advisory');
assert(diag.ranking.length >= 3, 'ranking produced');

console.log('=== C Link Budget Comparison ===');
const cmp = compareLinkBudget({
  design: { lengthKm: 2, splitters: ['1:8'], splices: 4, connectors: 2 },
  measuredRxDbm: -18
});
assert(cmp.calculated.note === 'CALCULATED_NOT_MEASURED', 'calculated side tagged');
assert(Array.isArray(cmp.reasons) && cmp.reasons.length > 0, 'reasons present');

console.log('=== D Asset Fingerprint (binding pure part) ===');
const fp = createAssetFingerprint({ assetType: 'SPLITTER', serial: 'X1', assetId: 'A9' });
assert(fp.fingerprint.length === 64, 'fingerprint length');

console.log('=== E Geometric Plausibility ===');
const bad = assessPathPlausibility({ lengthMeters: 8000, vertexCount: 2 });
assert(bad.plausible === false, 'long path few vertices rejected');
assert(bad.reasons.includes('LONG_PATH_WITH_INSUFFICIENT_VERTICES'), 'correct reason');
const good = assessPathPlausibility({ lengthMeters: 120, vertexCount: 8 });
assert(good.plausible === true, 'reasonable path accepted');

console.log('=== F Exception Board ===');
const ranked = rankExceptionBoard([
  { ticketId: 'T1', slaBreached: true },
  { ticketId: 'T2' },
  { ticketId: 'T3', openConflict: true, evidenceStale: true }
]);
assert(ranked.length === 2, 'only exceptions ranked');
assert(ranked[0].severity === 'HIGH', 'high severity first');

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All A–F pure tests passed.');
