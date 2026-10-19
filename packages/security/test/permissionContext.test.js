'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildImmutablePermissionContext,
  assertTechnicianReadAllowed,
  assertTechnicianMutationAllowed,
  canSupervisorActOnTechnician,
  evaluateOptionalSupervisorOverride,
  privilegeAuditEvent
} = require('../src/permissionContext');

const principal = { sub: 'user-1', role: 'field_tech', authenticated: true, verified: true };

test('permission context is deeply immutable and contains only DB-derived scope', () => {
  const context = buildImmutablePermissionContext({ principal, tenantId: 'tenant-1', technicianId: 'tech-1', subordinates: ['tech-2'] });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.subordinates), true);
  assert.throws(() => { context.tenantId = 'attacker-tenant'; }, TypeError);
  assert.deepEqual(context.subordinates, ['tech-2']);
});

test('field technician can read and mutate only own ticket scope', () => {
  const context = buildImmutablePermissionContext({ principal, tenantId: 'tenant-1', technicianId: 'tech-1' });
  assert.equal(assertTechnicianReadAllowed(context, { tenantId: 'tenant-1', ticketTechnicianId: 'tech-1' }).ok, true);
  assert.equal(assertTechnicianMutationAllowed(context, { tenantId: 'tenant-1', ticketTechnicianId: 'tech-2' }).error, 'TECHNICIAN_READ_SCOPE_REQUIRED');
});

test('supervisor requires materialized subordinate membership', () => {
  const context = buildImmutablePermissionContext({ principal: { ...principal, sub: 'sup-1', role: 'area_supervisor' }, tenantId: 'tenant-1', technicianId: 'sup-tech', subordinates: ['tech-2'] });
  assert.equal(canSupervisorActOnTechnician(context, { tenantId: 'tenant-1', technicianId: 'tech-2' }).ok, true);
  assert.equal(canSupervisorActOnTechnician(context, { tenantId: 'tenant-1', technicianId: 'tech-9' }).error, 'SUPERVISOR_TECHNICIAN_SCOPE_REQUIRED');
});

test('geo/reality override requires approval, second factor, and a technical reason', () => {
  const context = buildImmutablePermissionContext({ principal: { ...principal, role: 'area_supervisor' }, tenantId: 'tenant-1', technicianId: 'sup-tech', subordinates: ['tech-2'] });
  assert.equal(evaluateOptionalSupervisorOverride({ context, tenantId: 'tenant-1', failureCodes: ['GEO_DISTANCE_EXCEEDED'], override: { approved: true, secondFactorVerified: false, reason: 'short' } }).ok, false);
  assert.equal(evaluateOptionalSupervisorOverride({ context, tenantId: 'tenant-1', failureCodes: ['GEO_DISTANCE_EXCEEDED'], override: { approved: true, secondFactorVerified: true, reason: 'Verified emergency restoration with physical site evidence.' } }).ok, false);
  const mfaContext = buildImmutablePermissionContext({ principal: { ...principal, role: 'area_supervisor', mfaVerified: true }, tenantId: 'tenant-1', technicianId: 'sup-tech', subordinates: ['tech-2'] });
  assert.equal(evaluateOptionalSupervisorOverride({ context: mfaContext, tenantId: 'tenant-1', failureCodes: ['GEO_DISTANCE_EXCEEDED'], override: { approved: true, secondFactorVerified: false, reason: 'Verified emergency restoration with physical site evidence.' } }).applied, true);
});

test('privilege audit event is deterministic and hash-bound', () => {
  const event = privilegeAuditEvent({ action: 'FIELD_CLOSE_SUPERVISOR_OVERRIDE', tenantId: 'tenant-1', actorSub: 'sup-1', refId: 'ticket-1', detail: { reason: 'x' } });
  assert.match(event.requestHash, /^[a-f0-9]{64}$/);
  assert.equal(event.action, 'FIELD_CLOSE_SUPERVISOR_OVERRIDE');
});
