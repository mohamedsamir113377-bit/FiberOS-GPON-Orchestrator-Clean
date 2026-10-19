'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { distanceMeters, evaluate } = require('../src/realityGate');

test('reality gate rejects equal but invalid coordinate pairs', () => {
  assert.deepEqual(distanceMeters({ lat: 999, lon: 999 }, { lat: 999, lon: 999 }), { ok: false, reason: 'COORDINATES_OUT_OF_RANGE', meters: null });
  assert.equal(evaluate({ lat: 0, lon: 0 }, { lat: 0, lon: 181 }, 50).errorCode, 'COORDINATES_OUT_OF_RANGE');
});

test('reality gate accepts WGS84 boundary coordinates', () => {
  assert.equal(distanceMeters({ lat: 90, lon: 180 }, { lat: 90, lon: -180 }).ok, true);
  assert.equal(evaluate({ lat: -90, lon: -180 }, { lat: -90, lon: -180 }, 50).passed, true);
});
