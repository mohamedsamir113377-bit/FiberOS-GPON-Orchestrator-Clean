'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTEXT_SCHEMA,
  EVENT_SCHEMA,
  createOperationalContext,
  createOperationalEvent,
  sha256Json
} = require('../src');

const base = Object.freeze({
  tenantId: '11111111-1111-4111-8111-111111111111',
  correlationId: 'corr-20261008-root-operation',
  actorId: '22222222-2222-4222-8222-222222222222',
  role: 'ops_manager',
  operation: 'reality.operation.plan',
  networkFamily: 'gpon',
  subjectRef: { type: 'service_order', id: '33333333-3333-4333-8333-333333333333' },
  policyProfileId: '44444444-4444-4444-8444-444444444444',
  truthBoundary: 'POLICY_SELECTION_IS_NOT_RUNTIME_VERIFICATION',
  createdAt: '2026-10-08T00:00:00.000Z',
  securityClassification: 'restricted',
  provenance: { origin: 'unit-test', policySelection: true }
});

test('canonical JSON is key-order stable', () => {
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
});

test('operational context is tenant-rooted and content-addressed', () => {
  const a = createOperationalContext(base);
  const b = createOperationalContext({ ...base, provenance: { policySelection: true, origin: 'unit-test' } });
  assert.equal(a.schema, CONTEXT_SCHEMA);
  assert.equal(a.tenantId, base.tenantId);
  assert.equal(a.contextHash, b.contextHash);
  assert.notEqual(a.contextHash, '');
});

test('tenant identity is mandatory and is not inferred from optional browser fields', () => {
  assert.throws(() => createOperationalContext({ ...base, tenantId: undefined }), /TENANT_ID_REQUIRED/);
  const c = createOperationalContext({ ...base, tenant_id: 'attacker-tenant', tenantId: base.tenantId });
  assert.equal(c.tenantId, base.tenantId);
});

test('event envelope binds tenant, correlation, policy and integrity', () => {
  const ev = createOperationalEvent({
    ...base,
    eventType: 'reality.operation.plan.created',
    aggregateType: 'operation_plan',
    aggregateId: '55555555-5555-4555-8555-555555555555',
    idempotencyKey: 'idem-20261008-1234567890',
    payload: { recommendationStatus: 'candidate' }
  });
  assert.equal(ev.schema, EVENT_SCHEMA);
  assert.equal(ev.tenantId, base.tenantId);
  assert.equal(ev.correlationId, base.correlationId);
  assert.match(ev.payloadSha256, /^[a-f0-9]{64}$/);
  assert.match(ev.integritySha256, /^[a-f0-9]{64}$/);
  assert.equal(ev.runtimeVerificationStatus, 'UNVERIFIED');
});

test('event rejects forged prebuilt contexts', () => {
  const context = createOperationalContext(base);
  assert.throws(() => createOperationalEvent({
    ...base, context: { ...context, tenantId: 'attacker-tenant' },
    eventType: 'reality.operation.plan.created', aggregateType: 'operation_plan',
    aggregateId: '55555555-5555-4555-8555-555555555555',
    idempotencyKey: 'idem-20261008-1234567890', payload: {}
  }), /OPERATIONAL_CONTEXT_HASH_INVALID/);
});

test('canonicalization rejects prototype-pollution keys', () => {
  assert.throws(() => sha256Json(JSON.parse('{"__proto__":{"polluted":true}}')), /CANONICAL_KEY_FORBIDDEN|CANONICAL_KEY_INVALID/);
});

test('event rejects weak idempotency keys and unsafe event types', () => {
  assert.throws(() => createOperationalEvent({
    ...base, eventType: 'Reality/Plan', aggregateType: 'operation_plan',
    aggregateId: '55555555-5555-4555-8555-555555555555', idempotencyKey: 'short',
    payload: {}
  }), /IDEMPOTENCY_KEY_TOO_SHORT/);
  assert.throws(() => createOperationalEvent({
    ...base, eventType: 'reality', aggregateType: 'operation_plan',
    aggregateId: '55555555-5555-4555-8555-555555555555',
    idempotencyKey: 'idem-20261008-1234567890', payload: {}
  }), /EVENT_TYPE_INVALID/);
});

test('event integrity changes when payload changes', () => {
  const a = createOperationalEvent({
    ...base, eventType: 'reality.operation.plan.created', aggregateType: 'operation_plan',
    aggregateId: '55555555-5555-4555-8555-555555555555',
    idempotencyKey: 'idem-20261008-1234567890', payload: { status: 'candidate' }
  });
  const b = createOperationalEvent({
    ...base, eventType: 'reality.operation.plan.created', aggregateType: 'operation_plan',
    aggregateId: '55555555-5555-4555-8555-555555555555',
    idempotencyKey: 'idem-20261008-1234567891', payload: { status: 'selected' }
  });
  assert.notEqual(a.payloadSha256, b.payloadSha256);
  assert.notEqual(a.integritySha256, b.integritySha256);
});
