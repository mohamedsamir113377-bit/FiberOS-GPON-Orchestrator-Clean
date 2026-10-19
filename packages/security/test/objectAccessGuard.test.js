'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rejectClientAuthorityFields,
  assertTenantOwnsRow,
  pickAllowedProperties,
  redactProperties
} = require('../src/objectAccessGuard');

test('rejects client tenant and role fields', () => {
  assert.throws(() => rejectClientAuthorityFields({ tenantId: 'x', name: 'a' }), /CLIENT_AUTHORITY_FIELDS_FORBIDDEN/);
});

test('assertTenantOwnsRow returns 404 on mismatch', () => {
  assert.throws(
    () => assertTenantOwnsRow({ id: 1, tenant_id: 'a' }, 'b'),
    (e) => e.statusCode === 404
  );
  const row = assertTenantOwnsRow({ id: 1, tenant_id: 'a' }, 'a');
  assert.equal(row.id, 1);
});

test('property allowlist drops unknown keys', () => {
  const { patch, rejected } = pickAllowedProperties(
    { name: 'x', isAdmin: true, notes: 'n' },
    ['name', 'notes']
  );
  assert.deepEqual(patch, { name: 'x', notes: 'n' });
  assert.ok(rejected.includes('isAdmin'));
});

test('redact strips deny list', () => {
  const out = redactProperties({ id: 1, secret: 's', name: 'n' }, ['secret']);
  assert.equal(out.secret, undefined);
  assert.equal(out.name, 'n');
});
