'use strict';

const nodeCrypto = (() => {
  try { return require('node:crypto'); } catch (_) { return null; }
})();

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}

function requireBrowserCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('OFFLINE_CRYPTO_UNAVAILABLE');
  }
  return c;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(stable(value));
  if (nodeCrypto) return nodeCrypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  const digest = await requireBrowserCrypto().subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function assertPlainOperation(operation) {
  if (!operation || typeof operation !== 'object') throw new Error('OFFLINE_OPERATION_REQUIRED');
  if (!operation.clientId || !operation.operationId || !operation.type) throw new Error('OFFLINE_OPERATION_IDENTITY_REQUIRED');
  assertNoClientTenantAuthority(operation);
}

function assertNoClientTenantAuthority(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'tenantId' || key === 'tenant_id') throw new Error('CLIENT_TENANT_AUTHORITY_FORBIDDEN');
    assertNoClientTenantAuthority(nested);
  }
}

async function buildOperationEnvelope(operation = {}) {
  assertPlainOperation(operation);
  const createdAt = operation.createdAt || new Date().toISOString();
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) throw new Error('OFFLINE_OPERATION_CREATED_AT_INVALID');
  let expiresAt = null;
  if (operation.expiresAt != null) {
    const expiryDate = new Date(operation.expiresAt);
    const expiryMs = expiryDate.getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= createdMs) {
      throw new Error('OFFLINE_OPERATION_EXPIRY_INVALID');
    }
    expiresAt = expiryDate.toISOString();
  }
  const envelope = {
    schemaVersion: '1',
    operationEnvelope: 'fiberos.operation-envelope.v1',
    clientId: String(operation.clientId),
    operationId: String(operation.operationId),
    type: String(operation.type),
    aggregateType: operation.aggregateType || null,
    aggregateId: operation.aggregateId || null,
    baseVersion: operation.baseVersion == null ? null : operation.baseVersion,
    expectedState: operation.expectedState == null ? null : String(operation.expectedState),
    policyVersion: operation.policyVersion == null ? null : String(operation.policyVersion),
    payload: operation.payload || {},
    authority: { tenantSource: 'SERVER_SESSION', tenantId: null },
    idempotencyKey: String(operation.idempotencyKey || operation.operationId),
    createdAt,
    expiresAt
  };
  envelope.requestHash = await sha256Hex(envelope);
  return Object.freeze(envelope);
}

async function createQueueRecord(operation) {
  const envelope = await buildOperationEnvelope(operation);
  return { version: 1, operationId: envelope.operationId, state: 'PENDING', attempts: 0, envelope, queuedAt: envelope.createdAt };
}

function transitionState(current, next) {
  const edges = {
    PENDING: ['SENDING', 'REJECTED'],
    SENDING: ['ACKED', 'REJECTED', 'CONFLICT'],
    CONFLICT: ['PENDING', 'REJECTED'],
    ACKED: [],
    REJECTED: []
  };
  if (!edges[current] || !edges[current].includes(next)) throw new Error('OFFLINE_QUEUE_TRANSITION_INVALID');
  return next;
}

function resolveSyncOutcome(record, result) {
  if (!result || typeof result !== 'object') return { ...record, state: transitionState(record.state, 'REJECTED'), lastError: 'SYNC_RESPONSE_INVALID' };
  if (result.ok === true || result.status === 'ACKED') {
    return { ...record, state: transitionState(record.state, 'ACKED'), serverVersion: Number.isSafeInteger(result.serverVersion) ? result.serverVersion : null, lastError: null };
  }
  if (result.conflict === true || result.status === 'CONFLICT' || result.error === 'SYNC_CONFLICT') {
    return {
      ...record,
      state: transitionState(record.state, 'CONFLICT'),
      conflict: {
        serverVersion: Number.isSafeInteger(result.serverVersion) ? result.serverVersion : null,
        serverHash: result.serverHash || null,
        reason: String(result.reason || 'SERVER_STATE_CONFLICT')
      }
    };
  }
  return { ...record, state: transitionState(record.state, 'REJECTED'), lastError: String(result.error || 'SYNC_REJECTED') };
}

async function encryptRecord(record, key) {
  const c = requireBrowserCrypto();
  if (!key) throw new Error('OFFLINE_ENCRYPTION_KEY_REQUIRED');
  const iv = c.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(record));
  const ciphertext = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    schema: 'fiberos.offline-queue.v1',
    operationId: record.operationId,
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext))
  };
}

async function decryptRecord(blob, key) {
  const c = requireBrowserCrypto();
  if (!blob || blob.schema !== 'fiberos.offline-queue.v1' || !key) throw new Error('OFFLINE_ENCRYPTED_RECORD_INVALID');
  try {
    const plaintext = await c.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(blob.iv) },
      key,
      new Uint8Array(blob.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (_) {
    throw new Error('OFFLINE_DECRYPTION_FAILED');
  }
}

async function createEncryptionKey() {
  return requireBrowserCrypto().subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function createMemoryStore() {
  const map = new Map();
  return {
    async put(record) { map.set(record.operationId, record); },
    async get(operationId) { return map.get(operationId) || null; },
    async list() { return [...map.values()].sort((a,b) => a.operationId.localeCompare(b.operationId)); },
    async delete(operationId) { map.delete(operationId); },
    async clear() { map.clear(); }
  };
}

function createIndexedDbStore({ dbName = 'fiberos-offline-field-queue', storeName = 'operations' } = {}) {
  if (!globalThis.indexedDB) throw new Error('INDEXEDDB_UNAVAILABLE');
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'operationId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('INDEXEDDB_OPEN_FAILED'));
    });
  }
  async function tx(mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const request = action(db.transaction(storeName, mode).objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('INDEXEDDB_OPERATION_FAILED'));
      });
    } finally { db.close(); }
  }
  return {
    put(record) { return tx('readwrite', s => s.put(record)); },
    get(id) { return tx('readonly', s => s.get(id)); },
    list() { return tx('readonly', s => s.getAll()); },
    delete(id) { return tx('readwrite', s => s.delete(id)); },
    clear() { return tx('readwrite', s => s.clear()); }
  };
}

async function flushQueue(store, { send, maxAttempts = 5 } = {}) {
  if (!store || typeof store.list !== 'function' || typeof send !== 'function') throw new Error('OFFLINE_FLUSH_CONTRACT_INVALID');
  const results = [];
  for (const original of await store.list()) {
    if (!['PENDING', 'CONFLICT'].includes(original.state)) continue;
    if (original.attempts >= maxAttempts) {
      results.push({ operationId: original.operationId, state: original.state, skipped: 'MAX_ATTEMPTS' });
      continue;
    }
    let sending;
    try {
      const pending = original.state === 'CONFLICT'
        ? { ...original, state: transitionState(original.state, 'PENDING') }
        : original;
      sending = {
        ...pending,
        state: transitionState(pending.state, 'SENDING'),
        attempts: pending.attempts + 1
      };
      await store.put(sending);
      const outcome = resolveSyncOutcome(sending, await send(sending.envelope));
      await store.put(outcome);
      results.push(outcome);
    } catch (error) {
      const rejected = { ...sending, state: transitionState(sending.state, 'REJECTED'), lastError: String(error && error.message || error) };
      await store.put(rejected);
      results.push(rejected);
    }
  }
  return results;
}

module.exports = {
  stable,
  sha256Hex,
  createQueueRecord,
  buildOperationEnvelope,
  assertNoClientTenantAuthority,
  transitionState,
  resolveSyncOutcome,
  createEncryptionKey,
  encryptRecord,
  decryptRecord,
  createMemoryStore,
  createIndexedDbStore,
  flushQueue
};
