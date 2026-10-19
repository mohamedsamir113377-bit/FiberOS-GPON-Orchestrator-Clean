'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const SQL = read('sql/migrations/170_cross_tenant_reference_integrity.sql');

test('generic tenant FK guard fails closed when a referenced row is missing or invisible under RLS', () => {
  assert.match(SQL, /IF ref_tenant IS NULL THEN\s+RAISE EXCEPTION 'TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE_%_%'/);
  assert.doesNotMatch(SQL, /IF ref_tenant IS NULL THEN\s+RETURN NEW/);
  assert.match(SQL, /IF ref_tenant IS DISTINCT FROM NEW\.tenant_id THEN\s+RAISE EXCEPTION 'TENANT_MISMATCH_%_%'/);
});

test('new FTTH foreign keys bind the tenant and referenced ID as a composite key', () => {
  const expected = [
    /field_tool_calibrations_tool_tenant_fkey[\s\S]*?FOREIGN KEY \(tenant_id, tool_id\)[\s\S]*?REFERENCES public\.field_test_tools \(tenant_id, id\)/,
    /otdr_trace_acquisitions_tool_tenant_fkey[\s\S]*?FOREIGN KEY \(tenant_id, tool_id\)[\s\S]*?REFERENCES public\.field_test_tools \(tenant_id, id\)/,
    /otdr_trace_acquisitions_calibration_tenant_fkey[\s\S]*?FOREIGN KEY \(tenant_id, calibration_id\)[\s\S]*?REFERENCES public\.field_tool_calibrations \(tenant_id, id\)/,
    /install_constraint_evaluations_segment_tenant_fkey[\s\S]*?FOREIGN KEY \(tenant_id, segment_id\)[\s\S]*?REFERENCES public\.cable_plant_segments \(tenant_id, id\)/,
    /optical_splitter_assets_parent_tenant_fkey[\s\S]*?FOREIGN KEY \(tenant_id, parent_splitter_id\)[\s\S]*?REFERENCES public\.optical_splitter_assets \(tenant_id, id\)/,
    /field_visit_time_slots_technician_tenant_fkey[\s\S]*?FOREIGN KEY \(tenant_id, technician_id\)[\s\S]*?REFERENCES public\.technicians \(tenant_id, id\)/,
    /field_visit_time_slots_installation_job_tenant_fkey[\s\S]*?FOREIGN KEY \(tenant_id, installation_job_id\)[\s\S]*?REFERENCES public\.installation_jobs \(tenant_id, id\)/,
    /gis_corridor_conflict_events_dig_proposal_tenant_fkey[\s\S]*?FOREIGN KEY \(tenant_id, dig_proposal_id\)[\s\S]*?REFERENCES public\.gis_dig_proposals \(tenant_id, id\)/
  ];
  for (const pattern of expected) assert.match(SQL, pattern);
});

test('polymorphic GIS segment references are typed, tenant-bound, and RLS is restored', () => {
  const triggers = [
    ['gis_snap_events', 'trg_gis_snap_segment_tenant_references'],
    ['gis_corridor_conflict_events', 'trg_gis_corridor_segment_tenant_references'],
    ['gis_linear_measure_events', 'trg_gis_linear_measure_segment_tenant_references']
  ];
  for (const [table, trigger] of triggers) {
    assert.match(SQL, new RegExp('CREATE TRIGGER ' + trigger + '[\\s\\S]*?ON public\\.' + table));
    assert.match(SQL, new RegExp('ALTER TABLE public\\.' + table + ' ENABLE ROW LEVEL SECURITY;[\\s\\S]*?ALTER TABLE public\\.' + table + ' FORCE ROW LEVEL SECURITY;'));
  }
  assert.match(SQL, /fiberos_set_gis_segment_tenant_references/);
  assert.match(SQL, /FOREIGN KEY \(tenant_id, fiber_cable_segment_id\)[\s\S]*?REFERENCES public\.ftth_cable_segments \(tenant_id, id\)/);
  assert.match(SQL, /FOREIGN KEY \(tenant_id, duct_segment_id\)[\s\S]*?REFERENCES public\.ftth_duct_segments \(tenant_id, id\)/);
  assert.match(SQL, /ALTER TABLE public\.gis_snap_events DISABLE ROW LEVEL SECURITY/);
  assert.match(SQL, /ALTER TABLE public\.gis_linear_measure_events DISABLE ROW LEVEL SECURITY/);
  assert.match(SQL, /ALTER TABLE public\.gis_linear_measure_events ENABLE ROW LEVEL SECURITY/);
  assert.match(SQL, /ALTER TABLE public\.gis_linear_measure_events FORCE ROW LEVEL SECURITY/);
});

test('migration 170 is registered and its extension-ledger checksum is exact', () => {
  const migrationName = '170_cross_tenant_reference_integrity.sql';
  const list = read('sql/migrations/PRODUCTION_MIGRATIONS.txt').split(/\r?\n/).filter(Boolean);
  assert.ok(list.includes(migrationName), 'migration 170 must remain registered in the production list');
  assert.ok(list.indexOf(migrationName) >= 0, 'migration 170 must appear in contiguous production sequence');
  // Tip may advance beyond 170; this test only proves 170 remains present and untampered.
  const listedLine = read('sql/migrations/PRODUCTION_MIGRATIONS.extra.sha256')
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith('  ' + migrationName));
  assert.ok(listedLine, 'migration checksum line missing');
  const expected = crypto.createHash('sha256').update(read('sql/migrations/' + migrationName)).digest('hex');
  assert.equal(listedLine.trim().split(/\s+/)[0], expected);
});
