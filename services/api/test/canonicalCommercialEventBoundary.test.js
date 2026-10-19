'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

test('customer order lifecycle bridges creation and status transitions into canonical events', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/customerPortal.js'), 'utf8');
  assert.match(route, /customer\.order\.created/);
  assert.match(route, /customer\.order\.status_changed/);
  assert.match(route, /service-order:/);
  assert.match(route, /PORTAL_ORDER_/);
  assert.match(route, /portal_service_order_events/);
  assert.match(route, /appendOperationalEvent/);
});

test('SLA clock writes are explicitly restricted at the central route authorization layer', () => {
  const policy = fs.readFileSync(path.join(ROOT, 'services/api/src/routeAuthorizationPolicy.js'), 'utf8');
  assert.match(policy, /POST', path: '\/v1\/customer-portal\/sla\/clocks', roles: \['exec','cfo','ops_manager','area_supervisor','sysadmin'\]/);
});

test('SLA clock recording persists evidence-classed clocks and derives only 80/100 thresholds', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/customerPortal.js'), 'utf8');
  assert.match(route, /POST' && path === '\/v1\/customer-portal\/sla\/clocks'/);
  assert.match(route, /portal_sla_clock_events/);
  assert.match(route, /detectAllSlaThresholds/);
  assert.match(route, /portal_sla_enforcement_events/);
  assert.match(route, /threshold\.state === 'breached'/);
  assert.match(route, /NO_INVENTED_ETA/);
  assert.match(route, /PORTAL_SLA_FUTURE_CLOCK_REJECTED/);
  assert.match(route, /PORTAL_SLA_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_CLOCK/);
});

test('central canonical writer rejects a reused idempotency key when the event payload changed', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages/operational-context/src/index.js'), 'utf8');
  assert.match(source, /OUTBOX_IDEMPOTENCY_REUSED_WITH_DIFFERENT_EVENT/);
  assert.match(source, /CAUSATION_EVENT_NOT_IN_TENANT_OUTBOX/);
  assert.match(source, /appendOperationalEvent/);
});

test('field-close is bridged to the canonical event envelope without changing its authority model', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/fieldClose.js'), 'utf8');
  assert.match(route, /appendOperationalEvent/);
  assert.match(route, /field\.close\.validated/);
  assert.match(route, /field-close:/);
  assert.match(route, /appendOperationalEvent/);
  assert.match(route, /runtimeVerificationStatus: 'UNVERIFIED'/);
  assert.match(route, /LIVE_HARDWARE_VERIFICATION_REMAINS_EXTERNAL/);
  assert.match(route, /appendLedgerBlock\(client,/);
});

test('contractor commercial mutations use namespaced canonical event idempotency', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/contractorCommercial.js'), 'utf8');
  assert.match(route, /emitCanonicalCommercialEvent/);
  assert.match(route, /commercial:/);
  assert.match(route, /contractor\.work_package\.transitioned/);
  assert.match(route, /contractor\.measurement\.submitted/);
  assert.match(route, /contractor\.measurement\.status_changed/);
  assert.match(route, /commercial\.reconciliation\.opened/);
  assert.match(route, /commercial\.reconciliation\.status_changed/);
  assert.match(route, /CONTRACTOR_MEASUREMENT_PERSISTED/);
  assert.match(route, /PAYMENT AUTHORITY REMAINS SEPARATE/);
});

test('canonical event migration keeps legacy outbox rows valid while enforcing canonical rows', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'sql/migrations/153_canonical_operational_event_envelope.sql'), 'utf8');
  assert.match(migration, /canonical_event_version/);
  assert.match(migration, /outbox_canonical_event_metadata_check/);
  assert.match(migration, /idx_outbox_tenant_idempotency/);
  assert.match(migration, /OUTBOX_CANONICAL_FIELDS_IMMUTABLE/);
  assert.match(migration, /CREATE TRIGGER trg_outbox_canonical_immutability/);
});
