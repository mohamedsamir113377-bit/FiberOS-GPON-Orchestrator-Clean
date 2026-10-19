'use strict';

/**
 * WHY THIS FILE MATTERS MORE THAN IT LOOKS:
 * Builds advisory JWT claims (nation_iso, org_id, employee_id, role_key).
 *
 * CRITICAL H-5 DECISION (2026-09-17 — closed by explicit truth-bound statement):
 * These claims are NOT the enforced tenant isolation boundary.
 * The only enforced isolation in this package is tenant_id via
 * fiberos_current_tenant_id() → user_preferences.tenant_id keyed by auth.uid()
 * (see migrations 023, 072 and related RLS). There is no `organizations` table
 * in sql/migrations. Do not invent a mapping and do not treat org_id as a
 * substitute for tenant_id. Buyer may later wire their own org model; until
 * then these claims remain advisory / hierarchical-helper only.
 *
 * In production this logic may run inside a Supabase Auth Custom Access Token
 * Hook or equivalent. The content validation below is real.
 */

class ClaimsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClaimsError';
  }
}

/**
 * @param {object} employee   { employeeId, orgId, roleKey, isActive }
 * @param {object} organization { orgId, homeNationIso, isActive }
 */
/**
 * H-5 closed (2026-09-17): See module header and docs/REQUIRED_ADDITIONS_STATEMENT.md.
 * org_id / nation_iso / employee_id / role_key are advisory only.
 * Enforced boundary = tenant_id via user_preferences + RLS only.
 */
function buildJwtClaims({ employee, organization }) {
  if (!employee) throw new ClaimsError('ERR_EMPLOYEE_REQUIRED');
  if (!organization) throw new ClaimsError('ERR_ORGANIZATION_REQUIRED');

  // An offboarded employee or a suspended client organization must NEVER get
  // valid claims, even if their row still physically exists in the table for
  // audit/history reasons. This is the actual security boundary, not the UI.
  if (employee.isActive !== true) {
    throw new ClaimsError(`ERR_EMPLOYEE_INACTIVE: ${employee.employeeId}`);
  }
  if (organization.isActive !== true) {
    throw new ClaimsError(`ERR_ORGANIZATION_INACTIVE: ${organization.orgId}`);
  }

  // Cross-check, not a trust-the-caller assumption: an employee's own org_id
  // must match the organization record passed in, or something upstream is
  // already inconsistent and must fail loudly here rather than mint a token
  // that would let someone slip between tenants.
  if (employee.orgId !== organization.orgId) {
    throw new ClaimsError(
      `ERR_EMPLOYEE_ORG_MISMATCH: employee ${employee.employeeId} belongs to org ${employee.orgId}, not ${organization.orgId}`
    );
  }

  if (!organization.homeNationIso) {
    throw new ClaimsError(`ERR_ORGANIZATION_MISSING_NATION: ${organization.orgId}`);
  }
  if (!employee.employeeId || !String(employee.employeeId).trim()) throw new ClaimsError('ERR_EMPLOYEE_ID_REQUIRED');
  if (!employee.roleKey || !String(employee.roleKey).trim()) throw new ClaimsError('ERR_EMPLOYEE_ROLE_REQUIRED');
  if (!organization.orgId || !String(organization.orgId).trim()) throw new ClaimsError('ERR_ORGANIZATION_ID_REQUIRED');

  return {
    nation_iso: organization.homeNationIso,
    org_id: organization.orgId,
    employee_id: employee.employeeId,
    role_key: employee.roleKey,
  };
}

module.exports = { buildJwtClaims, ClaimsError };
