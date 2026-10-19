'use strict';

/**
 * Object-level and property-level authorization helpers.
 * Grounded in OWASP API Security Top 10 2023:
 * - API1 Broken Object Level Authorization
 * - API3 Broken Object Property Level Authorization
 *
 * Does not replace RLS; complements it for explicit handler checks.
 * Prefer UUID identifiers; never trust client-supplied tenant or actor ids.
 */

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Client may pass resource id; must not pass tenantId / ownerId as authority.
 */
function rejectClientAuthorityFields(body, extraForbidden = []) {
  const b = body || {};
  const forbidden = new Set([
    'tenantId', 'tenant_id', 'ownerId', 'owner_id', 'actorId', 'actor_id',
    'userId', 'user_id', 'createdBy', 'created_by', 'role', 'roles',
    ...extraForbidden
  ]);
  const hits = Object.keys(b).filter((k) => forbidden.has(k));
  if (hits.length) {
    const e = new Error('CLIENT_AUTHORITY_FIELDS_FORBIDDEN');
    e.code = 'CLIENT_AUTHORITY_FIELDS_FORBIDDEN';
    e.statusCode = 400;
    e.fields = hits;
    throw e;
  }
  return true;
}

/**
 * After loading a row, verify it belongs to session tenant.
 */
function assertTenantOwnsRow(row, sessionTenantId, { notFoundCode = 'RESOURCE_NOT_FOUND' } = {}) {
  if (!row) {
    const e = new Error(notFoundCode);
    e.code = notFoundCode;
    e.statusCode = 404;
    throw e;
  }
  const rowTenant = row.tenant_id || row.tenantId;
  if (!sessionTenantId || !rowTenant || String(rowTenant) !== String(sessionTenantId)) {
    // Uniform 404 to avoid existence leaks (OWASP guidance spirit)
    const e = new Error(notFoundCode);
    e.code = notFoundCode;
    e.statusCode = 404;
    throw e;
  }
  return row;
}

/**
 * API3: only allow listed properties from client body into an update patch.
 */
function pickAllowedProperties(body, allowedKeys) {
  const b = body || {};
  const allow = new Set(allowedKeys);
  const out = {};
  const rejected = [];
  for (const [k, v] of Object.entries(b)) {
    if (allow.has(k)) out[k] = v;
    else rejected.push(k);
  }
  return Object.freeze({
    patch: Object.freeze(out),
    rejected: Object.freeze(rejected),
    truthBoundary: 'PROPERTY_ALLOWLIST_APPLIED'
  });
}

/**
 * Strip sensitive properties from response objects (excessive data exposure).
 */
function redactProperties(row, denyKeys) {
  if (!row || typeof row !== 'object') return row;
  const deny = new Set(denyKeys);
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!deny.has(k)) out[k] = v;
  }
  return out;
}

function assertUuidParam(value, field = 'id') {
  if (!isUuid(value)) {
    const e = new Error('RESOURCE_ID_INVALID');
    e.code = 'RESOURCE_ID_INVALID';
    e.field = field;
    e.statusCode = 400;
    throw e;
  }
  return String(value).toLowerCase();
}

module.exports = {
  isUuid,
  rejectClientAuthorityFields,
  assertTenantOwnsRow,
  pickAllowedProperties,
  redactProperties,
  assertUuidParam
};
