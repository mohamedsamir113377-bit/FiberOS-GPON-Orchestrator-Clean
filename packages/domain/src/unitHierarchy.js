'use strict';

const EXPECTED_PARENT_TYPE = {
  SECTOR_GROUP: null,
  SECTOR: 'SECTOR_GROUP',
  REGION: 'SECTOR',
  CENTRAL: 'REGION',
  TEAM: 'CENTRAL',
};

const EXPECTED_HEAD_ROLES = {
  SECTOR_GROUP: ['CHIEF_OF_SECTORS'],
  SECTOR: ['SECTOR_HEAD'],
  REGION: ['REGIONAL_GM'],
  CENTRAL: ['CENTRAL_MANAGER', 'NETWORK_MAINTENANCE_MGR'],
  TEAM: ['TEAM_LEADER'],
};

class UnitStructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnitStructureError';
  }
}

/**
 * Mirrors enforce_unit_parent_type(): the nesting chain must be exactly
 * SECTOR_GROUP -> SECTOR -> REGION -> CENTRAL -> TEAM. No skipped levels, no
 * backwards nesting.
 */
function validateUnitNesting(units) {
  const byId = new Map(units.map((u) => [u.unitId, u]));
  for (const unit of units) {
    const expectedParentType = EXPECTED_PARENT_TYPE[unit.unitType];
    if (expectedParentType === undefined) {
      throw new UnitStructureError(`ERR_UNKNOWN_UNIT_TYPE: ${unit.unitType}`);
    }
    if (expectedParentType === null) {
      if (unit.parentUnitId) {
        throw new UnitStructureError(`ERR_TOP_LEVEL_UNIT_CANNOT_HAVE_PARENT: ${unit.unitId}`);
      }
      continue;
    }
    if (!unit.parentUnitId) {
      throw new UnitStructureError(`ERR_MISSING_PARENT: ${unit.unitId} (${unit.unitType}) needs a ${expectedParentType} parent`);
    }
    const parent = byId.get(unit.parentUnitId);
    if (!parent) {
      throw new UnitStructureError(`ERR_PARENT_NOT_FOUND: ${unit.parentUnitId}`);
    }
    if (parent.unitType !== expectedParentType) {
      throw new UnitStructureError(
        `ERR_INVALID_UNIT_NESTING: ${unit.unitId} (${unit.unitType}) has parent type ${parent.unitType}, expected ${expectedParentType}`
      );
    }
  }
  return true;
}

/**
 * Mirrors enforce_unit_head_role(): whoever heads a unit must actually hold
 * the matching role. A vacant seat (headEmployeeId == null) is always valid.
 */
function validateUnitHeads(units, employeesById) {
  for (const unit of units) {
    if (!unit.headEmployeeId) continue;
    const head = employeesById.get(unit.headEmployeeId);
    if (!head) {
      throw new UnitStructureError(`ERR_HEAD_EMPLOYEE_NOT_FOUND: ${unit.headEmployeeId}`);
    }
    const allowedRoles = EXPECTED_HEAD_ROLES[unit.unitType];
    if (!allowedRoles.includes(head.roleKey)) {
      throw new UnitStructureError(
        `ERR_HEAD_ROLE_MISMATCH: a ${unit.unitType} unit cannot be headed by a ${head.roleKey} (unit ${unit.unitId})`
      );
    }
  }
  return true;
}

/**
 * Builds the precise nested tree for display — exactly what "internal department structure" (the internal department structure) means in practice: a
 * queryable, renderable shape, not a description in prose.
 */
function buildUnitTree(units) {
  const byParent = new Map();
  for (const u of units) {
    const key = u.parentUnitId || 'ROOT';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(u);
  }
  function attachChildren(unit) {
    const children = (byParent.get(unit.unitId) || []).map(attachChildren);
    return { ...unit, children };
  }
  return (byParent.get('ROOT') || []).map(attachChildren);
}

module.exports = { EXPECTED_PARENT_TYPE, EXPECTED_HEAD_ROLES, validateUnitNesting, validateUnitHeads, buildUnitTree, UnitStructureError };
