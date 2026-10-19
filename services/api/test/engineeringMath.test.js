'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleEngineering } = require('../src/routes/engineering');

test('OTDR distance endpoint returns deterministic calculation', () => {
  const result = handleEngineering('/v1/engineering/otdr-distance', {
    roundTripSeconds: 1e-8,
    groupIndex: 1.5
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.authority, 'CALCULATED_ADVISORY');
  assert.ok(result.body.result > 0);
});

test('OTDR trace-fit endpoint returns regression-derived attenuation', () => {
  const result = handleEngineering('/v1/engineering/otdr-trace-fit', {
    points: [
      { distanceMeters: 0, powerDbm: -10 },
      { distanceMeters: 500, powerDbm: -10.5 },
      { distanceMeters: 1000, powerDbm: -11 }
    ]
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.attenuationDbPerKm, 0.5);
  assert.equal(result.body.result.rSquared, 1);
});

test('OTDR reflectance endpoint remains advisory', () => {
  const result = handleEngineering('/v1/engineering/otdr-reflectance', {
    reflectedDbm: -40,
    incidentDbm: -10
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.authority, 'CALCULATED_ADVISORY');
  assert.equal(result.body.result, -30);
});

test('invalid OTDR input fails closed at the API boundary', () => {
  const result = handleEngineering('/v1/engineering/otdr-distance', {
    roundTripSeconds: -1,
    groupIndex: 1.4682
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'NEGATIVE_VALUE');
});

test('unknown engineering endpoint does not silently calculate anything', () => {
  const result = handleEngineering('/v1/engineering/not-real', {});
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'ENGINEERING_ENDPOINT_NOT_FOUND');
});


test('calibrated diagnosis rejects an absent calibration pack', () => {
  const result = handleEngineering('/v1/engineering/calibrated-diagnosis', {
    observation: { lossDb: 0.2 }
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'CALIBRATED_PACK_REQUIRED');
});
