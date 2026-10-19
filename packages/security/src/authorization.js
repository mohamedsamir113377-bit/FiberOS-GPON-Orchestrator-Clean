'use strict';

/**
 * Canonical application authorization model.
 * JWT verification produces the trusted principal; this module is the single
 * policy source that maps principal role -> permission -> resource/action.
 * Client-provided role/tenant fields are never consulted here.
 *
 * C-3 fix (2026-09-17): authorize() deliberately does NOT accept `:self`
 * scopes. A role that only has `ticket:transition:self` must not pass
 * authorize(principal, 'ticket', 'transition'). Callers that need self-scope
 * must use hasPermission(principal, 'ticket:transition:self') AND verify
 * resource ownership in the handler.
 */
const ROLE_PERMISSIONS = Object.freeze({
  technician: Object.freeze(['ticket:read:self','ticket:transition:self','evidence:write:self','position:write:self']),
  field_tech: Object.freeze(['ticket:read:self','ticket:transition:self','evidence:write:self','position:write:self']),
  team_lead: Object.freeze(['ticket:read:team','dispatch:read']),
  dispatcher: Object.freeze(['ticket:read:tenant','ticket:transition:tenant','dispatch:read','dispatch:rank']),
  call_center: Object.freeze(['ticket:read:tenant','ticket:read:customer','call:operate','assurance:read']),
  ops_manager: Object.freeze(['ticket:read:tenant','ticket:transition:tenant','dispatch:read','dispatch:rank','inventory:write','billing:read','billing:write','assurance:read','position:write:any']),
  area_supervisor: Object.freeze(['ticket:read:tenant','ticket:transition:tenant','dispatch:read','dispatch:rank','inventory:write','assurance:read','position:write:any']),
  exec: Object.freeze(['ticket:read:tenant','dispatch:read','billing:read','assurance:read','position:write:any']),
  cfo: Object.freeze(['billing:read','billing:write']),
  warehouse: Object.freeze(['inventory:write']),
  procurement: Object.freeze(['inventory:write','billing:read']),
  data_collector: Object.freeze(['evidence:write:self','position:write:self','ticket:read:self']),
  qc: Object.freeze(['evidence:read','evidence:verify','assurance:read']),
  sysadmin: Object.freeze(['ticket:read:tenant','ticket:transition:tenant','dispatch:read','dispatch:rank','inventory:write','billing:read','billing:write','assurance:read','position:write:any','system:admin']),
  customer: Object.freeze(['portal:read','portal:report','portal:schedule','portal:subscription']),
  contractor: Object.freeze(['portal:read','portal:report','portal:schedule'])
});

function normalizeRole(role) {
  return role == null ? '' : String(role).trim();
}
function permissionsForRole(role) {
  return ROLE_PERMISSIONS[normalizeRole(role)] || [];
}
function hasPermission(principal, permission) {
  if (!principal || !permission) return false;
  return permissionsForRole(principal.role).includes(String(permission));
}
function hasAnyRole(principal, roles) {
  if (!principal) return false;
  const actual = normalizeRole(principal.role);
  const requested = Array.isArray(roles) ? roles.map(normalizeRole) : [];
  if (!actual || !requested.length) return requested.length === 0;
  // Preserve the historic field_tech -> technician compatibility without
  // creating a new privilege class.
  return requested.includes(actual) || (actual === 'field_tech' && requested.includes('technician'));
}

/**
 * Authorize a resource:action at tenant/team/any scope only.
 * Does not grant :self — ownership checks belong in the route handler.
 */
function authorize(principal, resource, action) {
  const r = String(resource);
  const a = String(action);
  return hasPermission(principal, `${r}:${a}`)
    || hasPermission(principal, `${r}:${a}:any`)
    || hasPermission(principal, `${r}:${a}:tenant`)
    || hasPermission(principal, `${r}:${a}:team`);
}

/** Explicit self-scope check (still requires handler ownership verification). */
function authorizeSelf(principal, resource, action) {
  return hasPermission(principal, `${String(resource)}:${String(action)}:self`);
}

module.exports = {
  ROLE_PERMISSIONS,
  normalizeRole,
  permissionsForRole,
  hasPermission,
  hasAnyRole,
  authorize,
  authorizeSelf
};
