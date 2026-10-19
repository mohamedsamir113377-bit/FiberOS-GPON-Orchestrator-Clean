'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateOdnPowerBudget,
  referenceGponExample20km,
  ODN_CLASSES
} = require('../src/odnPowerBudget');
const {
  evaluateSpliceLossFromOtdr,
  validateOtdrAcquisition,
  selectMaintenanceWavelength
} = require('../src/otdrTracePolicy');
const {
  evaluateToolCalibration,
  authorizeMeasurementCampaign
} = require('../src/fieldToolCalibration');
const {
  assertSystemFaultType,
  listTaxonomy,
  isHandbookSix
} = require('../src/ponFaultTaxonomy');

test('ODN classes match ITU-T Manual ranges from gap report', () => {
  assert.equal(ODN_CLASSES.A.minDb, 5);
  assert.equal(ODN_CLASSES.A.maxDb, 20);
  assert.equal(ODN_CLASSES.B.minDb, 10);
  assert.equal(ODN_CLASSES.B.maxDb, 25);
  assert.equal(ODN_CLASSES.C.minDb, 15);
  assert.equal(ODN_CLASSES.C.maxDb, 30);
  assert.equal(ODN_CLASSES['B+'].minDb, 13);
  assert.equal(ODN_CLASSES['B+'].maxDb, 28);
  assert.equal(ODN_CLASSES['B+'].fecRequiredDownstream, true);
  assert.equal(ODN_CLASSES['C+'].maxDb, 32);
});

test('reference G-PON 20 km example totals 30 dB and is accepted at Class C limit', () => {
  const r = referenceGponExample20km();
  assert.ok(Math.abs(r.path.totalWithMarginsDb - 30) < 1e-9);
  assert.equal(r.rejected, false);
  assert.equal(r.status, 'ACCEPTED');
});

test('over-budget design is rejected', () => {
  const r = evaluateOdnPowerBudget({
    odnClass: 'B+',
    lengthKm: 20,
    fiberAttenuationDbPerKm: 0.4,
    splices: 15,
    spliceLossDb: 0.1,
    connectors: 4,
    connectorLossDb: 0.35,
    splitterLossDb: 17.1,
    designMarginDb: 1,
    maintenanceMarginDb: 1
  });
  // total 30 > B+ max 28
  assert.equal(r.rejected, true);
  assert.equal(r.status, 'REJECTED_OVER_BUDGET');
});

test('unidirectional splice loss is not admissible', () => {
  const r = evaluateSpliceLossFromOtdr({ forwardLossDb: 0.05 });
  assert.equal(r.accepted, false);
  assert.equal(r.status, 'REJECTED_BIDIRECTIONAL_REQUIRED');
});

test('bidirectional average within core-aligned fusion limit is accepted', () => {
  const r = evaluateSpliceLossFromOtdr({
    forwardLossDb: 0.02,
    reverseLossDb: 0.03,
    method: 'FUSION_CORE'
  });
  assert.equal(r.accepted, true);
  assert.ok(Math.abs(r.bidirectionalAverageDb - 0.025) < 1e-12);
});

test('maintenance wavelength when both 1310 and 1550 active is 1650 nm', () => {
  const w = selectMaintenanceWavelength({ activeDownstreamNm: 1550, activeUpstreamNm: 1310 });
  assert.equal(w.wavelengthNm, 1650);
});

test('OTDR acquisition metadata validates direction and IOR', () => {
  const m = validateOtdrAcquisition({
    wavelengthNm: 1625,
    pulseWidthNs: 100,
    ior: 1.4681,
    direction: 'A_TO_B'
  });
  assert.equal(m.isMaintenanceBand, true);
  assert.equal(m.liveTrafficSafe, false);
  assert.equal(m.liveTrafficSafety.status, 'CANDIDATE_ONLY');
});

test('expired tool calibration rejects campaign', () => {
  const e = evaluateToolCalibration({
    toolKind: 'OTDR',
    serialNumber: 'OTDR-001',
    calibrationCertificateId: 'CERT-1',
    calibratedAt: '2024-01-01',
    validUntil: '2025-01-01',
    asOf: '2026-10-09'
  });
  assert.equal(e.accepted, false);
  assert.equal(e.status, 'REJECTED_EXPIRED');
});

test('uncalibrated campaign is rejected; valid cert is accepted', () => {
  const bad = authorizeMeasurementCampaign({
    tools: [{ toolKind: 'POWER_METER', serialNumber: 'PM-1' }],
    asOf: '2026-10-09'
  });
  assert.equal(bad.accepted, false);

  const good = authorizeMeasurementCampaign({
    tools: [{
      toolKind: 'OTDR',
      serialNumber: 'OTDR-9',
      calibrationCertificateId: 'ISO-9001-TRACE-1',
      calibratedAt: '2026-01-01',
      validUntil: '2027-01-01'
    }],
    asOf: '2026-10-09'
  });
  assert.equal(good.accepted, true);
});

test('handbook six fault taxonomy is locked', () => {
  const tax = listTaxonomy();
  assert.equal(tax.handbookSix.length, 6);
  assert.equal(isHandbookSix('ROGUE_ONT'), true);
  assert.equal(isHandbookSix('DYING_GASP'), true);
  assert.throws(() => assertSystemFaultType('MADE_UP_FAULT'), /FAULT_TYPE_NOT_IN_SYSTEM_TAXONOMY/);
  assert.equal(assertSystemFaultType('OPTICAL_LOSS'), 'OPTICAL_LOSS');
});

test('calibration chronology rejects future, reversed, and implausibly long validity', () => {
  const base = {
    toolKind: 'OTDR',
    serialNumber: 'OTDR-CHRONOLOGY',
    calibrationCertificateId: 'CERT-CHRONOLOGY',
    calibratedAt: '2026-01-01T00:00:00Z',
    validUntil: '2027-01-01T00:00:00Z',
    asOf: '2026-10-09T00:00:00Z'
  };
  assert.throws(() => evaluateToolCalibration({ ...base, calibratedAt: '2028-01-01T00:00:00Z' }),
    (error) => error.code === 'CALIBRATION_DATE_IN_FUTURE');
  assert.throws(() => evaluateToolCalibration({ ...base, calibratedAt: '2027-01-02T00:00:00Z', asOf: '2027-02-01T00:00:00Z' }),
    (error) => error.code === 'CALIBRATION_VALIDITY_INCONSISTENT');
  assert.throws(() => evaluateToolCalibration({ ...base, validUntil: '2032-01-02T00:00:00Z' }),
    (error) => error.code === 'CALIBRATION_VALIDITY_IMPLAUSIBLE');
});

test('ODN class minimum uses the same margin-inclusive loss basis as the maximum', () => {
  const r = evaluateOdnPowerBudget({
    odnClass: 'C', lengthKm: 1, fiberAttenuationDbPerKm: 14.5,
    designMarginDb: 1, maintenanceMarginDb: 1
  });
  assert.equal(r.path.pathLossDb, 14.5);
  assert.equal(r.path.totalWithMarginsDb, 16.5);
  assert.equal(r.status, 'ACCEPTED');
});

test('ODN budget rejects a non-positive available receiver budget explicitly', () => {
  assert.throws(() => evaluateOdnPowerBudget({
    lengthKm: 1, fiberAttenuationDbPerKm: 0.35, txDbm: -30, receiverSensitivityDbm: -28
  }), (error) => error.code === 'ODN_BUDGET_NON_POSITIVE_AVAILABLE' && error.statusCode === 422);
});

test('under class minimum is blocked without attenuator evidence', () => {
  const r = evaluateOdnPowerBudget({
    odnClass: 'B+',
    lengthKm: 1,
    fiberAttenuationDbPerKm: 0.2,
    splices: 0,
    connectors: 0,
    splitterLossDb: 0,
    designMarginDb: 0,
    maintenanceMarginDb: 0
  });
  assert.equal(r.underClassMinimum, true);
  assert.equal(r.accepted, false);
  assert.equal(r.blocked, true);
  assert.equal(r.status, 'BLOCKED_UNDER_CLASS_MIN');
});

test('under class minimum with attenuator evidence may accept', () => {
  const r = evaluateOdnPowerBudget({
    odnClass: 'B+',
    lengthKm: 1,
    fiberAttenuationDbPerKm: 0.2,
    splices: 0,
    connectors: 0,
    splitterLossDb: 0,
    designMarginDb: 0,
    maintenanceMarginDb: 0,
    attenuatorDocumented: true
  });
  assert.equal(r.accepted, true);
  assert.equal(r.status, 'ACCEPTED_WITH_ATTENUATOR');
});

test('unknown splice method is rejected', () => {
  const r = evaluateSpliceLossFromOtdr({
    forwardLossDb: 0.02,
    reverseLossDb: 0.02,
    method: 'MAGIC_GLUE'
  });
  assert.equal(r.accepted, false);
  assert.equal(r.status, 'REJECTED_METHOD_UNKNOWN');
});
