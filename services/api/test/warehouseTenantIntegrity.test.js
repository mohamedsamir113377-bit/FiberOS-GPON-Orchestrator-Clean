'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../sql/migrations/109_warehouse_cross_tenant_reference_closure.sql'),
  'utf8'
);
const tenantFkAudit = fs.readFileSync(
  path.resolve(__dirname, '../../../scripts/buyer-acceptance/adversarial-tenant-fk-mutation-audit.js'),
  'utf8'
);

test('warehouse cross-tenant references are closed with composite tenant FKs', () => {
  assert.match(migration, /warehouse_bins_id_tenant_key/);
  assert.match(migration, /warehouse_bins_parent_bin_tenant_fk/);
  assert.match(migration, /FOREIGN KEY \(parent_bin_id, warehouse_id, tenant_id\)/);
  assert.match(migration, /warehouse_transfers_id_tenant_key/);
  assert.match(migration, /warehouse_transfer_lines_transfer_tenant_fk/);
  assert.match(migration, /inventory_items_id_tenant_key/);
  assert.match(migration, /warehouse_transfer_lines_item_tenant_fk/);
  assert.match(migration, /warehouse_transfer_lines_source_bin_tenant_fk/);
  assert.match(migration, /warehouse_transfer_lines_target_bin_tenant_fk/);
  assert.match(migration, /fiberos_validate_warehouse_transfer_line_scope/);
  assert.match(migration, /warehouse_transfer_lines_scope_guard/);
});

test('warehouse cross-tenant closure removes the UUID-only foreign keys', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS warehouse_bins_parent_bin_id_fkey/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS warehouse_transfer_lines_transfer_id_fkey/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS warehouse_transfer_lines_item_id_fkey/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS warehouse_transfer_lines_source_bin_id_fkey/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS warehouse_transfer_lines_target_bin_id_fkey/);
});

test('exhaustive tenant-FK audit preserves the target composite key shape in fixtures', () => {
  assert.ok(tenantFkAudit.includes('function getProtectedFkColumns(state, table)'));
  assert.ok(tenantFkAudit.includes('constraintTouchesAnyColumn(row.definition, protectedColumns)'));
  assert.ok(tenantFkAudit.includes('!protectedColumns.has(column.column_name)'));
  assert.ok(tenantFkAudit.includes('parentKeyColumns.has(name)'));
  assert.ok(tenantFkAudit.includes('values.segment_id = values[targetSegmentColumn]'));
  assert.ok(tenantFkAudit.includes("targetSegmentColumn === 'fiber_cable_segment_id' ? 'FIBER_CABLE' : 'DUCT'"));
  assert.ok(tenantFkAudit.includes('state.fkColumns.clear()'));
});
