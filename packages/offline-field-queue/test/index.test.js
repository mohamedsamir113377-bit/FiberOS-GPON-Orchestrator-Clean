'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
// Node 24 exposes globalThis.crypto as a read-only Web Crypto accessor.
// Install it only on runtimes that do not already expose a usable implementation.
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });

const {
  createQueueRecord,
  buildOperationEnvelope,
  transitionState,
  resolveSyncOutcome,
  createEncryptionKey,
  encryptRecord,
  decryptRecord,
  createMemoryStore,
  flushQueue
} = require('../src');

test('queue record is canonical, tenant-authority-free and hashed', async () => {
  const r = await createQueueRecord({
    clientId: 'field-01',
    operationId: 'op-001',
    type: 'ticket.transition',
    aggregateType: 'ticket',
    aggregateId: 'ticket-001',
    baseVersion: 7,
    payload: { toStatus: 'completed' }
  });
  assert.equal(r.state, 'PENDING');
  assert.match(r.envelope.requestHash, /^[0-9a-f]{64}$/);
  assert.equal(r.envelope.payload.tenantId, undefined);
});

test('client cannot enqueue tenant authority', async () => {
  await assert.rejects(
    () => createQueueRecord({ clientId: 'field-01', operationId: 'op-002', type: 'ticket.transition', payload: { tenant_id: 'forged' } }),
    /CLIENT_TENANT_AUTHORITY_FORBIDDEN/
  );
});

test('AES-GCM encrypted queue record cannot be read with a different key', async () => {
  const key = await createEncryptionKey();
  const wrong = await createEncryptionKey();
  const record = await createQueueRecord({ clientId: 'field-01', operationId: 'op-003', type: 'ticket.transition', payload: { toStatus: 'in_progress' } });
  const blob = await encryptRecord(record, key);
  const restored = await decryptRecord(blob, key);
  assert.deepEqual(restored, record);
  await assert.rejects(() => decryptRecord(blob, wrong), /OFFLINE_DECRYPTION_FAILED/);
  assert.notDeepEqual(blob.ciphertext, Buffer.from(JSON.stringify(record)));
});

test('state machine allows deterministic reconnect and rejects invalid transitions', () => {
  assert.equal(transitionState('PENDING', 'SENDING'), 'SENDING');
  assert.equal(transitionState('SENDING', 'CONFLICT'), 'CONFLICT');
  assert.equal(transitionState('CONFLICT', 'PENDING'), 'PENDING');
  assert.throws(() => transitionState('ACKED', 'PENDING'), /OFFLINE_QUEUE_TRANSITION_INVALID/);
});

test('server conflict is preserved, never silently overwritten', () => {
  const record = { operationId: 'op-004', state: 'SENDING', attempts: 1, envelope: {} };
  const out = resolveSyncOutcome(record, { conflict: true, serverVersion: 8, serverHash: 'abc', reason: 'BASE_VERSION_STALE' });
  assert.equal(out.state, 'CONFLICT');
  assert.equal(out.conflict.serverVersion, 8);
  assert.equal(out.conflict.reason, 'BASE_VERSION_STALE');
});

test('flush sends only pending/conflict records and persists outcomes', async () => {
  const store = createMemoryStore();
  const pending = await createQueueRecord({ clientId: 'field-01', operationId: 'op-005', type: 'ticket.transition', payload: { toStatus: 'in_progress' } });
  const acked = { ...(await createQueueRecord({ clientId: 'field-01', operationId: 'op-006', type: 'ticket.transition', payload: {} })), state: 'ACKED' };
  await store.put(pending);
  await store.put(acked);
  const out = await flushQueue(store, { send: async () => ({ ok: true, serverVersion: 9 }) });
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'ACKED');
  assert.equal((await store.get('op-006')).state, 'ACKED');
});


test('generic operation envelope carries server tenant authority and idempotency without client tenant data', async () => {
  const envelope = await buildOperationEnvelope({ clientId:'field-01', operationId:'op-generic-01', type:'inventory.adjust', expectedState:'PENDING', policyVersion:'ops-2026-10', payload:{ delta:2 } });
  assert.equal(envelope.authority.tenantSource, 'SERVER_SESSION');
  assert.equal(envelope.authority.tenantId, null);
  assert.equal(envelope.idempotencyKey, 'op-generic-01');
  assert.match(envelope.requestHash, /^[0-9a-f]{64}$/);
});

test('nested client tenant authority is rejected', async () => {
  await assert.rejects(() => buildOperationEnvelope({ clientId:'field-01', operationId:'op-generic-02', type:'inventory.adjust', payload:{ meta:{ tenant_id:'forged' } } }), /CLIENT_TENANT_AUTHORITY_FORBIDDEN/);
});


test('offline envelope rejects an expired operation deterministically',async()=>{await assert.rejects(()=>buildOperationEnvelope({clientId:'field-01',operationId:'op-expired',type:'inventory.adjust',createdAt:'2026-10-07T10:00:00.000Z',expiresAt:'2026-10-07T09:59:59.000Z'}),/OFFLINE_OPERATION_EXPIRY_INVALID/);});


test('offline envelope rejects malformed expiry instead of leaking a Date RangeError', async () => {
  await assert.rejects(
    () => buildOperationEnvelope({
      clientId: 'field-01',
      operationId: 'op-malformed-expiry',
      type: 'inventory.adjust',
      createdAt: '2026-10-07T10:00:00.000Z',
      expiresAt: 'not-a-date'
    }),
    /OFFLINE_OPERATION_EXPIRY_INVALID/
  );
});

test('flush requeues a conflict before sending so the state machine remains valid', async () => {
  const store = createMemoryStore();
  const conflicted = {
    ...(await createQueueRecord({
      clientId: 'field-01',
      operationId: 'op-conflict-retry',
      type: 'ticket.transition',
      payload: { toStatus: 'completed' }
    })),
    state: 'CONFLICT',
    attempts: 1,
    conflict: { serverVersion: 2, reason: 'BASE_VERSION_STALE' }
  };
  await store.put(conflicted);

  const out = await flushQueue(store, {
    send: async (envelope) => ({ ok: true, serverVersion: 3, requestHash: envelope.requestHash })
  });

  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'ACKED');
  assert.equal(out[0].attempts, 2);
  assert.equal((await store.get('op-conflict-retry')).state, 'ACKED');
});
