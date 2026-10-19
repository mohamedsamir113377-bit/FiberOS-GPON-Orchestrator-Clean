'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { technicianDensityClusterQuery } = require('../src/spatialClusteringPolicy');

test('requires projected SRID for meter-meaningful DBSCAN', () => {
  assert.throws(
    () => technicianDensityClusterQuery({ lat: 30, lon: 31, epsMeters: 100 }),
    /GIS_CLUSTER_PROJECTED_SRID_REQUIRED/
  );
});

test('builds ClusterDBSCAN query with transform', () => {
  const q = technicianDensityClusterQuery({
    lat: 30.04,
    lon: 31.23,
    epsMeters: 150,
    minPoints: 3,
    projectedSrid: 32636,
    filterRadiusM: 5000,
    limit: 50
  });
  assert.match(q.text, /ST_ClusterDBSCAN/);
  assert.match(q.text, /ST_Transform/);
  assert.match(q.text, /ST_DWithin/);
  assert.equal(q.meta.projectedSrid, 32636);
  assert.equal(q.meta.epsMeters, 150);
});
