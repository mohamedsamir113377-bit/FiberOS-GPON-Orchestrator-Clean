'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeConsumption, detectGaps, interpolateGaps, comparePeriods } = require('../../src/capabilities/energy-analytics.cjs');

test('derives consumption from cumulative readings', () => {
  const r = computeConsumption([
    { ts: '2026-10-01T00:00:00Z', kwh: 1000 },
    { ts: '2026-10-02T00:00:00Z', kwh: 1012.5 },
    { ts: '2026-10-03T00:00:00Z', kwh: 1020 },
  ]);
  assert.equal(r.totalKwh, 20);
  assert.equal(r.intervals.length, 2);
});
test('a decreasing counter is flagged as a meter reset, never as negative usage', () => {
  const r = computeConsumption([
    { ts: '2026-10-01T00:00:00Z', kwh: 500 },
    { ts: '2026-10-02T00:00:00Z', kwh: 5 },
  ]);
  assert.equal(r.intervals[0].kind, 'meter-reset');
  assert.ok(r.totalKwh >= 0);
});
test('gaps are reported, not silently filled', () => {
  const g = detectGaps([
    { ts: '2026-10-01T00:00:00Z', kwh: 1 },
    { ts: '2026-10-02T00:00:00Z', kwh: 2 },
    { ts: '2026-10-06T00:00:00Z', kwh: 3 },
  ], 86400000, 1.5);
  assert.equal(g.complete, false);
  assert.equal(g.gapCount, 1);
  assert.equal(g.gaps[0].missingIntervals, 3);
});
test('interpolation only fills gaps under the allowed maximum', () => {
  const filled = interpolateGaps([
    { ts: '2026-10-01T00:00:00Z', kwh: 0 },
    { ts: '2026-10-03T00:00:00Z', kwh: 100 },
  ], 86400000, 3 * 86400000);
  assert.equal(filled.filter((p) => p.interpolated).length, 1);
  const notFilled = interpolateGaps([
    { ts: '2026-10-01T00:00:00Z', kwh: 0 },
    { ts: '2026-10-03T00:00:00Z', kwh: 100 },
  ], 86400000, 3600000);
  assert.equal(notFilled.filter((p) => p.interpolated).length, 0);
});
test('comparison refuses a fabricated percentage on a zero base', () => {
  assert.equal(comparePeriods(0, 50).percentChange, null);
  assert.equal(comparePeriods(100, 150).percentChange, 50);
});
