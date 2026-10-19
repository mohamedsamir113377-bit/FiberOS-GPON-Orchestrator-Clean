'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/fieldOperationsIntelligence');

test('alarm correlation uses explicit topology/time evidence only', () => {
  const out = I.correlateAlarmSignals([
    { alarmId:'a1', assetId:'root', code:'LOS', severity:'CRITICAL', observedAt:'2026-10-03T10:00:00Z', source:'nms' },
    { alarmId:'a2', assetId:'child', code:'LINK_DOWN', severity:'MAJOR', observedAt:'2026-10-03T10:05:00Z', source:'nms' }
  ], [{fromAssetId:'root',toAssetId:'child'}], {windowMinutes:15});
  assert.equal(out.length,1);
  assert.deepEqual(out[0].rootCauseCandidates[0], {assetId:'root',signalCount:1,downstreamObservedSignalCount:1,supportScore:2});
  assert.equal(out[0].prediction,false);
  assert.equal(out[0].autonomousAction,false);
});

test('optical fingerprint reports observed linear trend without forecasting', () => {
  const out = I.opticalHealthFingerprint([
    { measuredAt:'2026-10-01T00:00:00Z', value:-18 },
    { measuredAt:'2026-10-02T00:00:00Z', value:-19 },
    { measuredAt:'2026-10-03T00:00:00Z', value:-20 }
  ], {degradationRatePerDay:0.5});
  assert.equal(out.sampleCount,3);
  assert.equal(out.latestValue,-20);
  assert.equal(out.degradationObserved,true);
  assert.match(out.basis,/no forecasting/i);
});

test('evidence chain is hashed deterministically and reports missing required evidence', () => {
  const out = I.buildEvidenceChain([
    {type:'ticket', reference:'T-1'},
    {type:'technician', reference:'TECH-1'},
    {type:'gps', reference:'POS-9', observedAt:'2026-10-03T10:00:00Z'},
    {type:'timestamp', observedAt:'2026-10-03T10:00:01Z'},
    {type:'closure', reference:'completed'}
  ]);
  assert.equal(out.completeness.missingTypes.includes('asset'), true);
  assert.equal(out.completeness.orderValid, true);
  assert.match(out.chainHash,/^[a-f0-9]{64}$/);
});

test('capacity intelligence is derived from persisted port states', () => {
  const out = I.capacityIntelligence({totalPorts:32, provisionedPorts:30, usedPorts:24, reservedPorts:4});
  assert.equal(out.allocatedPorts,28);
  assert.equal(out.freePorts,4);
  assert.equal(out.utilizationPct,87.5);
  assert.equal(out.status,'LOW_HEADROOM');
  assert.equal(out.basis.includes('database-derived'), true);
});
