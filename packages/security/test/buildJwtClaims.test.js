'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildJwtClaims } = require('../src/buildJwtClaims');
const employee = { employeeId: 'e1', orgId: 'o1', roleKey: 'ops', isActive: true };
const organization = { orgId: 'o1', homeNationIso: 'US', isActive: true };

test('JWT claims require both employee and organization to be explicitly active', () => {
  assert.equal(buildJwtClaims({ employee, organization }).employee_id, 'e1');
  for (const isActive of [undefined, null, false, 1, 'true']) {
    assert.throws(() => buildJwtClaims({ employee: { ...employee, isActive }, organization }), /ERR_EMPLOYEE_INACTIVE/);
    assert.throws(() => buildJwtClaims({ employee, organization: { ...organization, isActive } }), /ERR_ORGANIZATION_INACTIVE/);
  }
});
