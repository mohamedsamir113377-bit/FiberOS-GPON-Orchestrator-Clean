'use strict';

const HIERARCHY_LEVELS = {
  CEO: 0,
  DEPUTY_CEO: 1,
  CHIEF_OF_SECTORS: 2,
  SECTOR_HEAD: 3,
  REGIONAL_GM: 4,
  CENTRAL_MANAGER: 5,
  NETWORK_MAINTENANCE_MGR: 5,
  ENGINEER: 6,
  TEAM_LEADER: 7,
  TECHNICIAN: 8,
};

/**
 * Mirrors 0003_identity_and_roles.sql's enforce_manager_is_more_senior()
 * trigger: an inverted org chart must be rejected at build time, not
 * discovered later when a report doesn't make sense.
 */
function validateOrgChart(employees) {
  const byId = new Map(employees.map((e) => [e.employeeId, e]));
  for (const e of employees) {
    if (e.roleKey === 'CEO') {
      if (e.managerId) throw new Error(`ERR_CEO_HAS_MANAGER: ${e.employeeId}`);
      continue;
    }
    if (!e.managerId) throw new Error(`ERR_NON_CEO_MISSING_MANAGER: ${e.employeeId}`);
    const manager = byId.get(e.managerId);
    if (!manager) throw new Error(`ERR_MANAGER_NOT_FOUND: ${e.managerId}`);
    if (HIERARCHY_LEVELS[manager.roleKey] >= HIERARCHY_LEVELS[e.roleKey]) {
      throw new Error(
        `ERR_INVERTED_HIERARCHY: ${e.employeeId} (${e.roleKey}) reports to ${manager.employeeId} (${manager.roleKey}), which is not more senior`
      );
    }
  }
  return true;
}

/**
 * Mirrors get_subordinate_ids(): every descendant, computed by walking the
 * tree — not a cached/denormalized list that can go stale.
 */
function getSubordinateIds(employees, managerId) {
  const children = new Map();
  for (const e of employees) {
    if (!e.managerId) continue;
    if (!children.has(e.managerId)) children.set(e.managerId, []);
    children.get(e.managerId).push(e.employeeId);
  }
  const result = [];
  const stack = [...(children.get(managerId) || [])];
  while (stack.length) {
    const id = stack.pop();
    result.push(id);
    stack.push(...(children.get(id) || []));
  }
  return result;
}

/**
 * Mirrors can_view_employee(): a person can see their own record and every
 * descendant's — nothing in a sibling branch, no matter how senior.
 */
function canViewEmployee(employees, viewerId, targetId) {
  if (viewerId === targetId) return true;
  return getSubordinateIds(employees, viewerId).includes(targetId);
}

module.exports = { HIERARCHY_LEVELS, validateOrgChart, getSubordinateIds, canViewEmployee };
