'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  plantConflictWithDigQuery,
  classifyConflicts,
  assertBufferM
} = require('../src/corridorConflictPolicy');
const {
  interpolateAlongSegmentQuery,
  locateBetweenFractionsQuery,
  otdrMetersToMapQuery,
  otdrChainToMapQuery,
  metersToFraction
} = require('../src/linearMeasurePolicy');
const {
  danglingEdgesQuery,
  summarizeIntegrity
} = require('../src/topologyIntegrityPolicy');
const { simplifySegmentQuery } = require('../src/geometryQualityPolicy');
const {
  applicationGraphPathQuery,
  routingCapabilityManifest
} = require('../src/routingBoundaryPolicy');

test('buffer bounds', () => {
  assert.equal(assertBufferM(2), 2);
  assert.throws(() => assertBufferM(0.1));
  assert.throws(() => assertBufferM(100));
});

test('corridor conflict SQL uses buffer predicates', () => {
  const q = plantConflictWithDigQuery({
    digWkt: 'POLYGON((31 30, 31.01 30, 31.01 30.01, 31 30.01, 31 30))',
    bufferM: 3
  });
  assert.match(q.text, /ST_Buffer/);
  assert.match(q.text, /ST_Intersects/);
  assert.match(q.text, /ST_Overlaps/);
  assert.match(q.text, /ftth_cable_segments/);
});

test('classify conflicts', () => {
  const s = classifyConflicts([
    { intersects_buffer: true, distance_m: 0.5 },
    { intersects_buffer: false, overlaps_buffer: true, distance_m: 1.5 }
  ], 2);
  assert.equal(s.severity, 'CRITICAL');
  assert.equal(s.criticalCount, 1);
});

test('linear interpolate + substring + otdr', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const a = interpolateAlongSegmentQuery({ segmentId: id, fraction: 0.5 });
  assert.match(a.text, /ST_LineInterpolatePoint/);
  const b = locateBetweenFractionsQuery({ segmentId: id, fromFraction: 0.1, toFraction: 0.4 });
  assert.match(b.text, /ST_LineSubstring/);
  const c = otdrMetersToMapQuery({ segmentId: id, metersFromStart: 120 });
  assert.match(c.text, /otdr_meters/);
  assert.equal(metersToFraction(50, 100), 0.5);
});


test('OTDR chain query requires explicit order and validates orientation, tenant ownership and continuity', () => {
  const first = '00000000-0000-4000-8000-000000000001';
  const second = '00000000-0000-4000-8000-000000000002';
  const q = otdrChainToMapQuery({ segmentIds: [first, second], directions: [1, -1], metersFromStart: 150, continuityToleranceM: 1.5 });
  assert.match(q.text, /WITH ORDINALITY/);
  assert.match(q.text, /ST_Reverse/);
  assert.match(q.text, /ST_Distance\(previous_end::geography/);
  assert.match(q.text, /CHAIN_DISCONNECTED/);
  assert.match(q.text, /CHAIN_SEGMENT_MISSING/);
  assert.match(q.text, /OTDR_DISTANCE_OUT_OF_RANGE/);
  assert.match(q.text, /user_preferences/);
  assert.deepEqual(q.values, [[first, second], [1, -1], 150, 1.5]);
  assert.equal(q.meta.orderAuthority, 'CALLER_SUPPLIED_REVIEWED_AS_BUILT_SEQUENCE');
  assert.throws(() => otdrChainToMapQuery({ segmentIds: [first, first], metersFromStart: 1 }), /GIS_SEGMENT_CHAIN_DUPLICATE/);
  assert.throws(() => otdrChainToMapQuery({ segmentIds: [first], directions: [-1, 1], metersFromStart: 1 }), /GIS_SEGMENT_DIRECTION_INVALID/);
  assert.throws(() => otdrChainToMapQuery({ segmentIds: [first], continuityToleranceM: 11, metersFromStart: 1 }), /GIS_CHAIN_CONTINUITY_TOLERANCE_INVALID/);
});

test('topology integrity summarize', () => {
  const s = summarizeIntegrity({ dangling: [{}], loops: [], invalidGeom: [], degenerate: [] });
  assert.equal(s.severity, 'HIGH');
  assert.match(danglingEdgesQuery().text, /physical_topology_edges/);
});

test('simplify display only', () => {
  const q = simplifySegmentQuery({
    segmentId: '00000000-0000-4000-8000-000000000001',
    toleranceM: 2
  });
  assert.match(q.text, /ST_SimplifyPreserveTopology/);
  assert.equal(q.meta.truthBoundary.includes('DISPLAY_ONLY'), true);
});

test('application graph route recursive', () => {
  const q = applicationGraphPathQuery({
    fromAssetId: '00000000-0000-4000-8000-000000000001',
    toAssetId: '00000000-0000-4000-8000-000000000002',
    maxDepth: 5
  });
  assert.match(q.text, /WITH RECURSIVE/);
  const m = routingCapabilityManifest();
  assert.ok(m.implementedInSource.includes('APPLICATION_GRAPH'));
  assert.ok(m.pendingRuntime.includes('PGROUTING'));
});
