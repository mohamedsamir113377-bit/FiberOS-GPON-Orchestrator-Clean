'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  snapPointToSegmentQuery,
  geotagPointToRegionQuery,
  assetsBetweenDistancesQuery
} = require('../src/linearSnapPolicy');

test('snap query uses ClosestPoint and LineLocatePoint', () => {
  const q = snapPointToSegmentQuery({ lat: 30.04, lon: 31.23, maxDistanceM: 15, layer: 'FIBER_CABLE' });
  assert.match(q.text, /ST_ClosestPoint/);
  assert.match(q.text, /ST_LineLocatePoint/);
  assert.match(q.text, /ST_DWithin/);
  assert.match(q.text, /ftth_cable_segments/);
  assert.equal(q.meta.maxDistanceM, 15);
});

test('geotag uses ST_Covers on operational_regions', () => {
  const q = geotagPointToRegionQuery({ lat: 30, lon: 31 });
  assert.match(q.text, /ST_Covers/);
  assert.match(q.text, /operational_regions/);
});

test('distance band rejects inverted min/max', () => {
  assert.throws(
    () => assetsBetweenDistancesQuery({ lat: 0, lon: 0, minDistanceM: 500, maxDistanceM: 100 }),
    /GIS_DISTANCE_BAND_INVALID/
  );
  const q = assetsBetweenDistancesQuery({ lat: 30, lon: 31, minDistanceM: 100, maxDistanceM: 800 });
  assert.match(q.text, /NOT ST_DWithin/);
});
