'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_PERMISSIONS } = require('../src/authorization');

describe('customer portal authorization roles', () => {
  it('keeps customer and contractor permissions read/report scoped', () => {
    assert.deepEqual(ROLE_PERMISSIONS.customer, [
      'portal:read',
      'portal:report',
      'portal:schedule',
      'portal:subscription'
    ]);
    assert.deepEqual(ROLE_PERMISSIONS.contractor, [
      'portal:read',
      'portal:report',
      'portal:schedule'
    ]);
  });

  it('does not grant tenant mutation privileges through those role definitions', () => {
    assert.equal(ROLE_PERMISSIONS.customer.includes('system:admin'), false);
    assert.equal(ROLE_PERMISSIONS.contractor.includes('billing:write'), false);
  });
});
