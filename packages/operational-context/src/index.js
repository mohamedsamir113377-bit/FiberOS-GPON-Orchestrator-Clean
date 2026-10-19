'use strict';

const { buildOperationalTrace } = require('./trace');
const crypto = require('node:crypto');

const CONTEXT_SCHEMA = 'fiberos.operational-context.v1';
const EVENT_SCHEMA = 'fiberos.operational-event.v1';
const MAX = Object.freeze({
  id: 160,
  operation: 120,
  eventType: 160,
  aggregateType: 120,
  subjectType: 80,
  securityClassification: 20,
  correlation: 160,
  idempotency: 160,
  arrays: 64,
  objectKeys: 128,
  payloadBytes: 1024 * 1024,
  payloadDepth: 10
});
const SECURITY_CLASSIFICATIONS = Object.freeze(['public', 'internal', 'confidential', 'restricted']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const EVENT_TYPE_RE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,15}$/;

function fail(code, message = code) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function boundedString(value, code, max = MAX.id, { required = false } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) fail(code);
    return null;
  }
  const out = String(value).trim();
  if (out.length > max) fail(code + '_TOO_LONG');
  return out;
}

function requiredId(value, code) {
  const out = boundedString(value, code, MAX.id, { required: true });
  if (!ID_RE.test(out)) fail(code + '_INVALID');
  return out;
}

function normalizeEntityRef(value, code = 'ENTITY_REF_REQUIRED') {
  if (!value || typeof value !== 'object') fail(code);
  const type = boundedString(value.type, code + '_TYPE', MAX.subjectType, { required: true });
  const id = requiredId(value.id, code + '_ID');
  return Object.freeze({
    type: type.toLowerCase(),
    id
  });
}

function canonicalize(value, depth = 0) {
  if (depth > MAX.payloadDepth) fail('CANONICAL_DEPTH_EXCEEDED');
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'undefined') fail('CANONICAL_UNDEFINED');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('CANONICAL_NONFINITE_NUMBER');
    return value;
  }
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail('CANONICAL_INVALID_DATE');
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (value.length > MAX.arrays) fail('CANONICAL_ARRAY_TOO_LARGE');
    return value.map(v => canonicalize(v, depth + 1));
  }
  const keys = Object.keys(value).sort();
  if (keys.length > MAX.objectKeys) fail('CANONICAL_OBJECT_TOO_LARGE');
  const out = {};
  for (const key of keys) {
    if (!String(key).trim()) fail('CANONICAL_KEY_INVALID');
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('CANONICAL_KEY_FORBIDDEN');
    out[key] = canonicalize(value[key], depth + 1);
  }
  return out;
}

function sha256Json(value) {
  const serialized = JSON.stringify(canonicalize(value));
  const size = Buffer.byteLength(serialized, 'utf8');
  if (size > MAX.payloadBytes) fail('CANONICAL_PAYLOAD_TOO_LARGE');
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function isoTimestamp(value, code) {
  if (value == null) return new Date().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) fail(code);
  return d.toISOString();
}

function normalizeClassification(value, code = 'SECURITY_CLASSIFICATION_INVALID') {
  const out = String(value || 'restricted').trim().toLowerCase();
  if (!SECURITY_CLASSIFICATIONS.includes(out)) fail(code);
  return out;
}

function normalizeProvenance(value) {
  if (value == null) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) fail('PROVENANCE_OBJECT_REQUIRED');
  return Object.freeze(canonicalize(value));
}

function createOperationalContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('OPERATIONAL_CONTEXT_INPUT_REQUIRED');

  const tenantId = requiredId(input.tenantId, 'TENANT_ID_REQUIRED');
  const correlationId = requiredId(input.correlationId, 'CORRELATION_ID_REQUIRED');
  const operation = boundedString(input.operation, 'OPERATION_REQUIRED', MAX.operation, { required: true });
  const actorId = input.actorId == null ? null : requiredId(input.actorId, 'ACTOR_ID_INVALID');
  const actorRole = boundedString(input.role, 'ACTOR_ROLE_INVALID', MAX.subjectType);
  const networkFamily = boundedString(input.networkFamily, 'NETWORK_FAMILY_INVALID', MAX.subjectType, { required: true })?.toLowerCase();
  const subjectRef = input.subjectRef == null ? null : normalizeEntityRef(input.subjectRef, 'SUBJECT_REF');
  const entityRefs = Array.isArray(input.entityRefs)
    ? Object.freeze(input.entityRefs.slice(0, MAX.arrays).map(v => normalizeEntityRef(v, 'ENTITY_REF')))
    : Object.freeze([]);
  if (Array.isArray(input.entityRefs) && input.entityRefs.length > MAX.arrays) fail('ENTITY_REFS_TOO_LARGE');

  const context = {
    schema: CONTEXT_SCHEMA,
    tenantId,
    correlationId,
    causationId: input.causationId == null ? null : requiredId(input.causationId, 'CAUSATION_ID_INVALID'),
    actor: actorId ? Object.freeze({ id: actorId, role: actorRole }) : null,
    operation,
    networkFamily,
    subjectRef,
    entityRefs,
    policy: input.policyProfileId || input.policyProfileKey
      ? Object.freeze({
          profileId: input.policyProfileId == null ? null : requiredId(input.policyProfileId, 'POLICY_PROFILE_ID_INVALID'),
          profileKey: boundedString(input.policyProfileKey, 'POLICY_PROFILE_KEY_INVALID', MAX.id)
        })
      : null,
    truthBoundary: boundedString(input.truthBoundary, 'TRUTH_BOUNDARY_INVALID', 240, { required: true }),
    securityClassification: normalizeClassification(input.securityClassification),
    provenance: normalizeProvenance(input.provenance),
    createdAt: isoTimestamp(input.createdAt, 'CREATED_AT_INVALID'),
    observedAt: input.observedAt == null ? null : isoTimestamp(input.observedAt, 'OBSERVED_AT_INVALID'),
    schemaVersion: boundedString(input.schemaVersion || '1', 'SCHEMA_VERSION_INVALID', 32, { required: true })
  };

  const contextHash = sha256Json(context);
  return Object.freeze({ ...context, contextHash });
}

function validateIdempotencyKey(value) {
  const key = boundedString(value, 'IDEMPOTENCY_KEY_REQUIRED', MAX.id, { required: true });
  if (key.length < 16) fail('IDEMPOTENCY_KEY_TOO_SHORT');
  return key;
}

function validateEventType(value) {
  const eventType = boundedString(value, 'EVENT_TYPE_REQUIRED', MAX.eventType, { required: true });
  if (!EVENT_TYPE_RE.test(eventType)) fail('EVENT_TYPE_INVALID');
  return eventType;
}

function validateOperationalContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== CONTEXT_SCHEMA) fail('OPERATIONAL_CONTEXT_INVALID');
  const candidate = { ...value };
  const suppliedHash = candidate.contextHash;
  delete candidate.contextHash;
  const canonical = canonicalize(candidate);
  const expectedHash = sha256Json(canonical);
  if (typeof suppliedHash !== 'string' || !/^[a-f0-9]{64}$/.test(suppliedHash) || suppliedHash !== expectedHash) fail('OPERATIONAL_CONTEXT_HASH_INVALID');
  return Object.freeze({ ...canonical, contextHash: suppliedHash });
}

function createOperationalEvent(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('OPERATIONAL_EVENT_INPUT_REQUIRED');

  const context = input.context && input.context.schema === CONTEXT_SCHEMA
    ? validateOperationalContext(input.context)
    : createOperationalContext({
        ...(input.context || {}),
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        causationId: input.causationId,
        actorId: input.actorId,
        role: input.role,
        operation: input.operation,
        networkFamily: input.networkFamily,
        subjectRef: input.subjectRef,
        entityRefs: input.entityRefs,
        policyProfileId: input.policyProfileId,
        policyProfileKey: input.policyProfileKey,
        truthBoundary: input.truthBoundary,
        securityClassification: input.securityClassification,
        provenance: input.provenance,
        schemaVersion: input.schemaVersion
      });

  if (input.context && input.context.tenantId !== context.tenantId) fail('CONTEXT_TENANT_MISMATCH');
  if (input.tenantId && String(input.tenantId) !== context.tenantId) fail('EVENT_TENANT_CONTEXT_MISMATCH');

  const eventId = input.eventId == null ? crypto.randomUUID() : requiredId(input.eventId, 'EVENT_ID_INVALID');
  const aggregateType = boundedString(input.aggregateType, 'AGGREGATE_TYPE_REQUIRED', MAX.aggregateType, { required: true });
  const aggregateId = requiredId(input.aggregateId, 'AGGREGATE_ID_REQUIRED');
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const occurredAt = isoTimestamp(input.occurredAt, 'OCCURRED_AT_INVALID');
  const securityClassification = normalizeClassification(input.securityClassification || context.securityClassification);
  const payload = canonicalize(input.payload == null ? {} : input.payload);
  const payloadSha256 = sha256Json(payload);

  const eventCore = {
    schema: EVENT_SCHEMA,
    eventId,
    tenantId: context.tenantId,
    eventType: validateEventType(input.eventType),
    aggregateType,
    aggregateId,
    occurredAt,
    correlationId: context.correlationId,
    causationId: context.causationId,
    idempotencyKey,
    securityClassification,
    runtimeVerificationStatus: boundedString(input.runtimeVerificationStatus || 'UNVERIFIED', 'RUNTIME_VERIFICATION_STATUS_INVALID', 80, { required: true }),
    provenance: context.provenance,
    context,
    payload,
    payloadSha256
  };
  const integritySha256 = sha256Json(eventCore);
  return Object.freeze({ ...eventCore, integritySha256 });
}

async function appendOperationalEvent(client, input = {}) {
  if (!client || typeof client.query !== 'function') fail('OUTBOX_CLIENT_REQUIRED');
  const envelope = createOperationalEvent(input);
  if (envelope.causationId) {
    const cause = await client.query(
      'select 1 from outbox_events where tenant_id=$1 and event_id=$2::uuid limit 1',
      [envelope.tenantId, envelope.causationId]
    );
    if (!cause.rows[0]) fail('CAUSATION_EVENT_NOT_IN_TENANT_OUTBOX');
  }
  const inserted = await client.query(
    `insert into outbox_events(
       tenant_id,event_id,aggregate_type,aggregate_id,event_type,payload,
       canonical_event_version,correlation_id,causation_id,idempotency_key,
       security_classification,occurred_at,payload_sha256,integrity_sha256,publish_status
     ) values(
       $1,$2::uuid,$3,$4,$5,$6::jsonb,
       $7,$8,$9,$10,$11,$12::timestamptz,$13,$14,'pending'
     )
     on conflict do nothing
     returning event_id,created_at,publish_status`,
    [
      envelope.tenantId,
      envelope.eventId,
      envelope.aggregateType,
      envelope.aggregateId,
      envelope.eventType,
      JSON.stringify(envelope),
      envelope.schema,
      envelope.correlationId,
      envelope.causationId,
      envelope.idempotencyKey,
      envelope.securityClassification,
      envelope.occurredAt,
      envelope.payloadSha256,
      envelope.integritySha256
    ]
  );

  if (inserted.rows[0]) return Object.freeze({
    envelope,
    outbox: inserted.rows[0],
    replayed: false
  });

  const replay = await client.query(
    'select event_id,created_at,publish_status,payload_sha256,integrity_sha256 from outbox_events where tenant_id=$1 and idempotency_key=$2 limit 1',
    [envelope.tenantId, envelope.idempotencyKey]
  );
  if (!replay.rows[0]) fail('OUTBOX_EVENT_COLLISION');
  if (String(replay.rows[0].payload_sha256 || '').toLowerCase() !== envelope.payloadSha256 ||
      String(replay.rows[0].integrity_sha256 || '').toLowerCase() !== envelope.integritySha256) {
    fail('OUTBOX_IDEMPOTENCY_REUSED_WITH_DIFFERENT_EVENT');
  }
  return Object.freeze({
    envelope,
    outbox: replay.rows[0],
    replayed: true
  });
}

module.exports = {
  CONTEXT_SCHEMA,
  EVENT_SCHEMA,
  SECURITY_CLASSIFICATIONS,
  canonicalize,
  sha256Json,
  normalizeEntityRef,
  createOperationalContext,
  validateOperationalContext,
  createOperationalEvent,
  appendOperationalEvent,
  validateIdempotencyKey,
  validateEventType,
  buildOperationalTrace
};
