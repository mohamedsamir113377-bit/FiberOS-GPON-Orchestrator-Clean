'use strict';

const crypto = require('node:crypto');
const { permissionsForRole } = require('./authorization');

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function text(value) { return value == null ? '' : String(value).trim(); }
function same(a, b) { return text(a) !== '' && text(a) === text(b); }
function deny(code, detail) { return { ok: false, status: 403, error: code, ...(detail ? { detail } : {}) }; }

/**
 * Build once from DB-derived identity facts. Request fields must never be used
 * as inputs for this function. The returned object is recursively immutable.
 */
function buildImmutablePermissionContext({ principal, tenantId, technicianId = null, orgUnitId = null, subordinates = [], permissions } = {}) {
  if (!principal || principal.authenticated !== true || principal.verified !== true) throw new Error('VERIFIED_PRINCIPAL_REQUIRED');
  if (!text(tenantId)) throw new Error('TENANT_CONTEXT_REQUIRED');
  const role = text(principal.role);
  const subordinateIds = [...new Set((Array.isArray(subordinates) ? subordinates : []).map(text).filter(Boolean))].sort();
  const context = {
    actorSub: text(principal.sub),
    role,
    tenantId: text(tenantId),
    technicianId: technicianId ? text(technicianId) : null,
    orgUnitId: orgUnitId ? text(orgUnitId) : null,
    subordinates: subordinateIds,
    permissions: Object.freeze([...(permissions || permissionsForRole(role))].map(String).sort()),
    issuedAt: Date.now(),
    // MFA authority must come from the verified principal/session, never from the mutation body.
    mfaVerified: principal.mfaVerified === true
  };
  return deepFreeze(context);
}

async function loadImmutablePermissionContext(client, principal) {
  if (!client || typeof client.query !== 'function') throw new Error('DB_CLIENT_REQUIRED');
  const identity = await client.query(
    `select up.tenant_id, tech.id as technician_id, tech.org_unit_id
       from user_preferences up
       left join technicians tech on tech.user_id = up.user_id and tech.tenant_id = up.tenant_id and tech.is_active = true
      where up.user_id = $1::uuid limit 1`,
    [principal && principal.sub]
  );
  const row = identity.rows[0];
  if (!row || !row.tenant_id) throw new Error('TENANT_CONTEXT_REQUIRED');
  const subordinateRows = await client.query(
    `select subordinate_technician_id as id
       from technician_subordinates
      where tenant_id = $1::uuid and supervisor_technician_id = $2::uuid and is_active = true`,
    [row.tenant_id, row.technician_id || '00000000-0000-0000-0000-000000000000']
  );
  return buildImmutablePermissionContext({
    principal,
    tenantId: row.tenant_id,
    technicianId: row.technician_id,
    orgUnitId: row.org_unit_id,
    subordinates: subordinateRows.rows.map((x) => x.id)
  });
}

function assertTenant(context, tenantId) {
  if (!context || !same(context.tenantId, tenantId)) return deny('TENANT_SCOPE_REQUIRED');
  return { ok: true };
}

function assertTechnicianReadAllowed(context, { tenantId, technicianId, ticketTechnicianId } = {}) {
  const tenant = assertTenant(context, tenantId);
  if (!tenant.ok) return tenant;
  const target = technicianId || ticketTechnicianId;
  if (context.role === 'field_tech' || context.role === 'technician') {
    if (!same(context.technicianId, target) && !same(context.technicianId, ticketTechnicianId)) return deny('TECHNICIAN_READ_SCOPE_REQUIRED');
    return { ok: true, scope: 'self' };
  }
  if (['area_supervisor', 'team_lead'].includes(context.role)) {
    if (!context.subordinates.includes(text(target)) && !context.subordinates.includes(text(ticketTechnicianId))) return deny('SUPERVISOR_TECHNICIAN_SCOPE_REQUIRED');
    return { ok: true, scope: 'subordinates' };
  }
  return { ok: true, scope: 'tenant_management' };
}

function assertTechnicianMutationAllowed(context, { tenantId, technicianId, ticketTechnicianId } = {}) {
  const read = assertTechnicianReadAllowed(context, { tenantId, technicianId, ticketTechnicianId });
  if (!read.ok) return read;
  if (context.role === 'field_tech' || context.role === 'technician') {
    if (!same(context.technicianId, technicianId || ticketTechnicianId)) return deny('TECHNICIAN_MUTATION_SCOPE_REQUIRED');
    return { ok: true, scope: 'self' };
  }
  if (['area_supervisor', 'team_lead'].includes(context.role)) return { ok: true, scope: 'subordinates' };
  return { ok: true, scope: 'tenant_management' };
}

function canSupervisorActOnTechnician(context, { tenantId, technicianId } = {}) {
  const tenant = assertTenant(context, tenantId);
  if (!tenant.ok) return tenant;
  if (!['area_supervisor', 'team_lead'].includes(context.role)) return deny('SUPERVISOR_ROLE_REQUIRED');
  if (!context.subordinates.includes(text(technicianId))) return deny('SUPERVISOR_TECHNICIAN_SCOPE_REQUIRED');
  return { ok: true, scope: 'direct_or_materialized_subordinate' };
}

function evaluateOptionalSupervisorOverride({ context, tenantId, failureCodes = [], override } = {}) {
  const failures = Array.isArray(failureCodes) ? failureCodes.map(text).filter(Boolean) : [];
  if (!failures.length) return { ok: true, applied: false, reason: 'NO_FAILED_GATES' };
  const tenant = assertTenant(context, tenantId);
  if (!tenant.ok) return tenant;
  if (!['area_supervisor', 'team_lead', 'ops_manager', 'sysadmin'].includes(context.role)) return deny('SUPERVISOR_OVERRIDE_ROLE_REQUIRED');
  const value = override || {};
  const reason = text(value.reason);
  if (value.approved !== true || context.mfaVerified !== true || reason.length < 20) return deny('SUPERVISOR_OVERRIDE_DUAL_APPROVAL_REQUIRED', { required: ['approved','verified_principal_mfa','reason>=20'] });
  return { ok: true, applied: true, failureCodes: failures, reason, actorSub: context.actorSub, authority: 'SUPERVISOR_OVERRIDE_ESCROW' };
}

function privilegeAuditEvent({ action, tenantId, actorSub, refId, detail, requestHash } = {}) {
  const payload = { action: text(action), tenantId: text(tenantId), actorSub: text(actorSub), refId: text(refId), detail: detail || {} };
  const canonical = JSON.stringify(payload);
  return Object.freeze({ ...payload, requestHash: /^[a-f0-9]{64}$/i.test(text(requestHash)) ? text(requestHash) : crypto.createHash('sha256').update(canonical).digest('hex') });
}

module.exports = {
  deepFreeze,
  buildImmutablePermissionContext,
  loadImmutablePermissionContext,
  assertTechnicianReadAllowed,
  assertTechnicianMutationAllowed,
  canSupervisorActOnTechnician,
  evaluateOptionalSupervisorOverride,
  privilegeAuditEvent
};
