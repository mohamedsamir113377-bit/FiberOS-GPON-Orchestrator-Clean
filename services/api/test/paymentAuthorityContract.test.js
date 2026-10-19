'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sqlPath = path.resolve(__dirname, '../../../sql/migrations/091_payment_authority_force_rls.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

test('payment authority has FORCE RLS owner policies for SECURITY DEFINER execution', () => {
  assert.match(sql, /ALTER TABLE payment_cycles FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE payment_cycle_events FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE invoices FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE POLICY payment_cycles_owner_select ON payment_cycles/);
  assert.match(sql, /CREATE POLICY payment_cycles_owner_insert ON payment_cycles/);
  assert.match(sql, /CREATE POLICY payment_cycles_owner_update ON payment_cycles/);
  assert.match(sql, /CREATE POLICY payment_cycle_events_owner_select ON payment_cycle_events/);
  assert.match(sql, /CREATE POLICY payment_cycle_events_owner_insert ON payment_cycle_events/);
  assert.match(sql, /CREATE POLICY invoices_owner_select ON invoices/);
  assert.match(sql, /CREATE POLICY invoices_owner_update ON invoices/);
});

test('payment start rejects terminal invoice states', () => {
  assert.match(
    sql,
    /IF invoice_status NOT IN \('draft','issued','partially_paid','overdue'\) THEN\s+RAISE EXCEPTION 'PAYMENT_INVOICE_NOT_PAYABLE'/
  );
});

test('payment transition validates invoice state and target state', () => {
  assert.match(sql, /IF p_to_state IS NULL OR p_to_state NOT IN \('approved','rejected','paid'\) THEN/);
  assert.match(sql, /RAISE EXCEPTION 'PAYMENT_INVOICE_NOT_APPROVABLE'/);
  assert.match(sql, /RAISE EXCEPTION 'PAYMENT_INVOICE_NOT_PAYABLE'/);
  assert.match(sql, /RAISE EXCEPTION 'PAYMENT_INVOICE_STATE_CONFLICT'/);
});
