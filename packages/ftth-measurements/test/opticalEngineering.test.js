'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/opticalEngineering');

function approx(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    String(actual) + ' not within ' + tolerance + ' of ' + expected);
}

test('dBm and mW conversions are reciprocal', () => {
  for (const dbm of [-40, -28, -8, 0, 3.5, 20]) {
    approx(m.dbmFromMw(m.mwFromDbm(dbm)), dbm, 1e-12);
  }
});

test('power ratio and dB conversions are reciprocal', () => {
  for (const db of [-60, -3, 0, 3, 20]) {
    approx(m.dbFromPowerRatio(m.powerRatioFromDb(db)), db, 1e-12);
  }
});

test('received power applies gains and losses in dB correctly', () => {
  assert.equal(
    m.receivedPowerDbm({
      txPowerDbm: 4,
      lossesDb: [1.5, 2.5, 3],
      gainsDb: [0.25]
    }),
    -2.75
  );
});

test('optical loss from endpoint dBm measurements is the difference', () => {
  assert.equal(m.totalLossDb({ txPowerDbm: 3, rxPowerDbm: -17 }), 20);
});

test('optical budget reports receiver margins without inventing losses', () => {
  const result = m.opticalBudget({
    txPowerDbm: 5,
    sensitivityDbm: -28,
    overloadDbm: -8,
    lossesDb: [2, 3, 7],
    gainsDb: []
  });
  assert.equal(result.totalLossDb, 12);
  assert.equal(result.predictedRxDbm, -7);
  assert.equal(result.sensitivityMarginDb, 21);
  assert.equal(result.overloadHeadroomDb, -1);
  assert.equal(result.withinReceiverWindow, false);
});

test('OTDR distance uses round-trip flight time and group index', () => {
  const n = 1.4682;
  const distance = 1000;
  const tNs = m.roundTripTimeNsFromDistance(distance, n);
  approx(m.distanceFromRoundTripTimeNs(tNs, n), distance, 1e-9);
});

test('OTDR backscatter attenuation includes the round-trip factor', () => {
  const result = m.attenuationDbPerKmFromBackscatterPoints(
    { distanceMeters: 0, powerDbm: -10 },
    { distanceMeters: 1000, powerDbm: -11.2 }
  );
  approx(result.attenuationDbPerKm, 0.6, 1e-12);
  assert.equal(result.physicallyNonNegative, true);
});

test('negative OTDR slope is preserved and flagged rather than fabricated positive loss', () => {
  const result = m.attenuationDbPerKmFromBackscatterPoints(
    { distanceMeters: 0, powerDbm: -10 },
    { distanceMeters: 1000, powerDbm: -9.8 }
  );
  approx(result.attenuationDbPerKm, -0.1, 1e-12);
  assert.equal(result.physicallyNonNegative, false);
  assert.equal(
    result.warning,
    'NEGATIVE_BACKSCATTER_SLOPE_REQUIRES_MEASUREMENT_REVIEW'
  );
});

test('OTDR distance order is mandatory', () => {
  assert.throws(
    () => m.attenuationDbPerKmFromBackscatterPoints(
      { distanceMeters: 1000, powerDbm: -11 },
      { distanceMeters: 0, powerDbm: -10 }
    ),
    /point2\.distanceMeters must be greater/
  );
});

test('OTDR event loss is the measured dB level drop', () => {
  assert.equal(m.eventLossDb(-12, -14.5), 2.5);
});

test('reflectance from powers is non-positive for a passive event', () => {
  const incidentMw = 1;
  const reflectedMw = 0.001;
  approx(m.reflectanceDbFromPowerRatio(reflectedMw, incidentMw), -30, 1e-12);
  assert.ok(m.reflectanceDbFromPowerRatio(reflectedMw, incidentMw) <= 0);
});

test('reflectance from dBm is the reflected-minus-incident difference', () => {
  assert.equal(m.reflectanceDbFromDbm(-40, -10), -30);
});

test('passive reflectance rejects reflected power above incident power', () => {
  assert.throws(
    () => m.reflectanceDbFromPowerRatio(2, 1),
    /reflectedPower must be <= incidentPower/
  );
});

test('idealized pulse-width spatial extent round-trips consistently', () => {
  const n = 1.4682;
  const extent = m.pulseWidthSpatialExtentMetersFromNs(10, n);
  approx(extent, 299792458 * 10e-9 / (2 * n), 1e-12);
});

test('power-measurement loss uses logarithmic ratio', () => {
  assert.equal(
    m.opticalLossDbFromPowerMeasurements({
      transmittedBeforeMw: 1,
      transmittedAfterMw: 0.01
    }),
    20
  );
});

test('invalid zero/negative powers fail closed mathematically', () => {
  assert.throws(() => m.mwFromDbm(Infinity), /dbm must be a finite number/);
  assert.throws(() => m.dbmFromMw(0), /mw must be > 0/);
  assert.throws(() => m.dbFromPowerRatio(-1), /powerRatio must be > 0/);
});

test('negative distance/time inputs are rejected', () => {
  assert.throws(() => m.distanceFromRoundTripTimeSeconds(-1, 1.4682), /roundTripSeconds must be >= 0/);
  assert.throws(() => m.roundTripTimeSecondsFromDistance(-1, 1.4682), /distanceMeters must be >= 0/);
});


test('distance uncertainty propagates independent timing and group-index uncertainty', () => {
  const result = m.distanceUncertaintyFromRoundTripTime({
    roundTripSeconds: 1e-8,
    groupIndex: 1.5,
    roundTripStdSeconds: 1e-10,
    groupIndexStd: 0.001
  });
  const d = 299792458 * 1e-8 / (2 * 1.5);
  const dt = 299792458 / (2 * 1.5);
  const dn = -(299792458 * 1e-8) / (2 * 1.5 * 1.5);
  const expected = Math.sqrt((dt * 1e-10) ** 2 + (dn * 0.001) ** 2);
  approx(result.distanceMeters, d, 1e-12);
  approx(result.stdDistanceMeters, expected, 1e-12);
});

test('OTDR attenuation uncertainty propagates independent endpoint and position uncertainty', () => {
  const result = m.attenuationUncertaintyFromBackscatterPoints(
    { distanceMeters: 0, powerDbm: -10, powerStdDb: 0.05, distanceStdMeters: 0.5 },
    { distanceMeters: 1000, powerDbm: -11.2, powerStdDb: 0.05, distanceStdMeters: 0.5 }
  );
  approx(result.attenuationDbPerKm, 0.6, 1e-12);
  assert.ok(result.stdAttenuationDbPerKm > 0);
});

test('reflectance uncertainty combines independent level errors', () => {
  const result = m.reflectanceUncertaintyFromDbm({
    reflectedDbm: -40,
    incidentDbm: -10,
    reflectedStdDb: 0.2,
    incidentStdDb: 0.1
  });
  assert.equal(result.reflectanceDb, -30);
  approx(result.stdReflectanceDb, Math.sqrt(0.05), 1e-12);
});

test('OTDR backscatter regression returns attenuation and goodness of fit', () => {
  const result = m.fitBackscatterTrace([
    { distanceMeters: 0, powerDbm: -10 },
    { distanceMeters: 500, powerDbm: -10.5 },
    { distanceMeters: 1000, powerDbm: -11 }
  ]);
  approx(result.attenuationDbPerKm, 0.5, 1e-12);
  approx(result.rSquared, 1, 1e-12);
  assert.equal(result.warning, null);
});

test('OTDR regression rejects duplicate distances', () => {
  assert.throws(
    () => m.fitBackscatterTrace([
      { distanceMeters: 0, powerDbm: -10 },
      { distanceMeters: 0, powerDbm: -10.1 }
    ]),
    /strictly increasing/
  );
});
