'use strict';

/**
 * Event-driven data-mesh fabric primitives.
 * Concept source (public): event-driven data-mesh / event-streaming literature
 * (partition keys, ordering, idempotent consumption, replay, schema compatibility).
 * Pure and dependency-free; no broker is contacted here.
 */

const crypto = require('node:crypto');

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function partitionKey(event) {
  if (!event || !event.tenantId) throw new Error('ESF_TENANT_REQUIRED');
  const k = event.aggregateId || event.key || event.id || 'anonymous';
  return sha256(String(event.tenantId) + '|' + String(k)).slice(0, 16);
}
function partitionOf(key, count) {
  const n = Math.trunc(count);
  if (!Number.isInteger(n) || n < 1) throw new Error('ESF_PARTITION_COUNT_INVALID');
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

function createEnvelope(input) {
  input = input || {};
  if (!input.tenantId) throw new Error('ESF_TENANT_REQUIRED');
  if (!input.type) throw new Error('ESF_TYPE_REQUIRED');
  const base = {
    schemaVersion: String(input.schemaVersion || '1'),
    tenantId: String(input.tenantId),
    type: String(input.type),
    aggregateType: input.aggregateType == null ? null : String(input.aggregateType),
    aggregateId: input.aggregateId == null ? null : String(input.aggregateId),
    sequence: Number.isSafeInteger(input.sequence) ? input.sequence : null,
    occurredAt: input.occurredAt || new Date().toISOString(),
    causationId: input.causationId == null ? null : String(input.causationId),
    correlationId: input.correlationId == null ? null : String(input.correlationId),
    payload: input.payload || {}
  };
  const eventId = sha256(stableStringify(base));
  return Object.freeze({ ...base, eventId, partitionKey: partitionKey(base) });
}

function orderingGuarantee(envelopes) {
  if (!Array.isArray(envelopes)) throw new Error('ESF_ENVELOPES_REQUIRED');
  const byKey = new Map();
  for (const e of envelopes) {
    const k = e.partitionKey || partitionKey(e);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }
  const violations = [];
  for (const [k, list] of byKey) {
    let last = -1;
    for (const e of list) {
      if (e.sequence == null) continue;
      if (e.sequence <= last) violations.push({ partitionKey: k, eventId: e.eventId, sequence: e.sequence });
      last = Math.max(last, e.sequence);
    }
  }
  return Object.freeze({ ordered: violations.length === 0, violations: Object.freeze(violations), partitions: byKey.size });
}

function createIdempotentConsumer(seen = new Set()) {
  return Object.freeze({
    consume(envelope, handler) {
      if (!envelope || !envelope.eventId) throw new Error('ESF_EVENT_ID_REQUIRED');
      if (seen.has(envelope.eventId)) return Object.freeze({ applied: false, reason: 'DUPLICATE_EVENT' });
      const result = typeof handler === 'function' ? handler(envelope) : undefined;
      seen.add(envelope.eventId);
      return Object.freeze({ applied: true, result });
    },
    size: () => seen.size
  });
}

function replayWindow(envelopes, { from, to }) {
  const f = Date.parse(from), t = Date.parse(to);
  if (!Number.isFinite(f) || !Number.isFinite(t) || f > t) throw new Error('ESF_REPLAY_WINDOW_INVALID');
  const out = (envelopes || []).filter((e) => {
    const ts = Date.parse(e.occurredAt);
    return Number.isFinite(ts) && ts >= f && ts <= t;
  });
  return Object.freeze(out);
}

function schemaCompatibility(previous, next) {
  if (!previous || !next) throw new Error('ESF_SCHEMA_REQUIRED');
  const prevFields = new Set(Object.keys(previous));
  const nextFields = new Set(Object.keys(next));
  const added = [...nextFields].filter((k) => !prevFields.has(k));
  const removed = [...prevFields].filter((k) => !nextFields.has(k));
  const optional = (added.length > 0 && removed.length === 0) ? 'BACKWARD' : (removed.length > 0 && added.length === 0) ? 'FORWARD' : (added.length === 0 && removed.length === 0) ? 'FULL' : 'NONE';
  return Object.freeze({ compatible: added.length === 0 || removed.length === 0, mode: optional, added: Object.freeze(added), removed: Object.freeze(removed) });
}

module.exports = { stableStringify, sha256, partitionKey, partitionOf, createEnvelope, orderingGuarantee, createIdempotentConsumer, replayWindow, schemaCompatibility };
