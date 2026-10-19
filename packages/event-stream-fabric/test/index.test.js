'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/index');

test('partitionKey is tenant-scoped and deterministic', () => {
  const a = f.partitionKey({ tenantId: 'T1', aggregateId: 'A1' });
  const b = f.partitionKey({ tenantId: 'T1', aggregateId: 'A1' });
  const c = f.partitionKey({ tenantId: 'T2', aggregateId: 'A1' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('partitionOf is stable and bounded', () => {
  const p = f.partitionOf('abc', 8);
  assert.equal(p, f.partitionOf('abc', 8));
  assert.ok(p >= 0 && p < 8);
});

test('createEnvelope derives a deterministic eventId', () => {
  const e1 = f.createEnvelope({ tenantId: 'T1', type: 'X', occurredAt: '2026-01-01T00:00:00Z', payload: { a: 1 } });
  const e2 = f.createEnvelope({ tenantId: 'T1', type: 'X', occurredAt: '2026-01-01T00:00:00Z', payload: { a: 1 } });
  assert.equal(e1.eventId, e2.eventId);
});

test('orderingGuarantee detects a sequence regression in one partition', () => {
  const mk = (seq) => f.createEnvelope({ tenantId: 'T1', type: 'X', aggregateId: 'A', sequence: seq, occurredAt: '2026-01-01T00:00:00Z' });
  const r = f.orderingGuarantee([mk(1), mk(3), mk(2)]);
  assert.equal(r.ordered, false);
  assert.equal(r.violations.length, 1);
});

test('idempotent consumer applies each event once', () => {
  const c = f.createIdempotentConsumer();
  const e = f.createEnvelope({ tenantId: 'T1', type: 'X', aggregateId: 'A' });
  assert.equal(c.consume(e, () => 1).applied, true);
  assert.equal(c.consume(e, () => 1).applied, false);
  assert.equal(c.size(), 1);
});

test('replayWindow filters by time and schemaCompatibility classifies', () => {
  const e = f.createEnvelope({ tenantId: 'T1', type: 'X', occurredAt: '2026-05-01T00:00:00Z' });
  const w = f.replayWindow([e], { from: '2026-04-01T00:00:00Z', to: '2026-06-01T00:00:00Z' });
  assert.equal(w.length, 1);
  assert.equal(f.schemaCompatibility({ a: 1 }, { a: 1, b: 2 }).mode, 'BACKWARD');
  assert.equal(f.schemaCompatibility({ a: 1 }, { a: 1 }).mode, 'FULL');
});
