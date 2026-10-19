'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nearestTechniciansQuery, assertRadius } = require('../src/proximityPolicy');

test('nearest query uses ST_DWithin and KNN operator', () => {
  const q = nearestTechniciansQuery({ lat: 30.04, lon: 31.23, maxMeters: 3000, limit: 10 });
  assert.match(q.text, /ST_DWithin/);
  assert.match(q.text, /<->/);
  assert.equal(q.values[2], 3000);
  assert.equal(q.values[4], 10);
  assert.equal(q.meta.method, 'ST_DWithin+KNN');
});

test('radius caps enforced', () => {
  assert.throws(() => assertRadius(10), /GIS_RADIUS_INVALID/);
  assert.throws(() => nearestTechniciansQuery({ lat: 0, lon: 0, maxMeters: 999999 }), /GIS_RADIUS_INVALID/);
});
