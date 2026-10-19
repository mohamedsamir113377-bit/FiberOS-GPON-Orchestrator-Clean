'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mvtQuery, LAYERS } = require('../src/db');

test('XYZ tile coordinates are bounded by 2^z at zoom zero and zoom 24', () => {
  assert.doesNotThrow(() => mvtQuery('duct', 0, 0, 0));
  assert.throws(() => mvtQuery('duct', 0, 1, 0), /GIS_TILE_COORDINATE_INVALID/);
  assert.throws(() => mvtQuery('duct', 0, 0, 1), /GIS_TILE_COORDINATE_INVALID/);
  const max = 2 ** 24 - 1;
  assert.doesNotThrow(() => mvtQuery('duct', 24, max, max));
  assert.throws(() => mvtQuery('duct', 24, 2 ** 24, 0), /GIS_TILE_COORDINATE_INVALID/);
});

test('fault, installation and current-technician layers are explicitly allow-listed for MVT', () => {
  assert.deepEqual(Object.keys(LAYERS).sort(), ['duct','evidence','fault','fiber_cable','installation','network_asset','technician','technician_position','ticket_location'].sort());
  for (const layer of ['fault','installation','technician']) {
    const q = mvtQuery(layer, 10, 500, 500);
    assert.match(q.text, /ST_AsMVT/);
    assert.equal(q.values[3], layer); assert.match(q.text,/ST_Transform\(raw_geom::geometry,3857\)/); assert.match(q.text,/margin => 64\.0\/4096\.0/); assert.doesNotMatch(q.text,/mvt_geom', 'id'/);
  }
});
test('MVT layer query text is sourced only from the fixed layer registry', () => {
  assert.throws(() => mvtQuery('fault_jobs;drop table', 10, 1, 1), /GIS_LAYER_NOT_ALLOWED/);
});
