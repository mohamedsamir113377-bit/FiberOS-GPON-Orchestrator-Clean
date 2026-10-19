'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProfile, weightedObservedRate, compareToObserved } = require('../src/costCalibration');

test('cost calibration profile validates governance metadata and validity window', () => {
  const p = normalizeProfile({
    workType: 'civil',
    unit: 'm',
    currency: 'egp',
    modelVersion: '1.0.0',
    valueMinor: 1250,
    validFrom: '2026-10-01T00:00:00Z',
    validTo: '2026-12-31T23:59:59Z',
    sourceRef: 'contractor-measurement:2026-10',
    provenance: { basis: 'VERIFIED_CONTRACTOR_MEASUREMENTS', evidenceClass: 'measured' }
  });
  assert.equal(p.modelKey, 'commercial.cost');
  assert.equal(p.currency, 'EGP');
  assert.equal(p.profileKey, 'unit_rate:civil:m:EGP');
});

test('observed rate is a weighted calculation, never a fabricated constant', () => {
  const out = weightedObservedRate([
    { quantity: 2, rateMinor: 1000 },
    { quantity: 6, rateMinor: 1500 }
  ]);
  assert.equal(out.dataAvailable, true);
  assert.equal(out.quantity, 8);
  assert.equal(out.weightedRateMinor, 1375);
});

test('comparison stays unavailable when there is no observed basis', () => {
  const out = compareToObserved({ valueMinor: 1200 }, { dataAvailable: false, weightedRateMinor: null });
  assert.equal(out.dataAvailable, false);
  assert.equal(out.deltaMinor, null);
});
