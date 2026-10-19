'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGrant, canView, revokeGrant, validateGrant } = require('../../src/capabilities/cross-project.cjs');

const NOW = Date.parse('2026-10-15T10:00:00Z');
const base = { fromProject: 'proj-alpha', toProject: 'proj-beta', resource: 'fiber-assets', grantedBy: 'ops-admin' };

test('project A cannot see project B without a grant (default deny)', () => {
  const store = { grants: [] };
  assert.equal(canView(store, 'proj-alpha', 'proj-beta', 'fiber-assets', NOW).allowed, false);
  assert.equal(canView(store, 'proj-alpha', 'proj-alpha', 'fiber-assets', NOW).allowed, true);
});
test('an explicit grant opens exactly the granted resource', () => {
  const store = { grants: [] };
  const g = createGrant(store, base, NOW);
  assert.equal(g.ok, true);
  assert.equal(canView(store, 'proj-alpha', 'proj-beta', 'fiber-assets', NOW).allowed, true);
  assert.equal(canView(store, 'proj-alpha', 'proj-beta', 'billing', NOW).allowed, false);
  assert.equal(canView(store, 'proj-beta', 'proj-alpha', 'fiber-assets', NOW).allowed, false);
});
test('revocation is immediate', () => {
  const store = { grants: [] };
  const g = createGrant(store, base, NOW);
  assert.equal(revokeGrant(store, g.id, 'ops-admin', NOW + 1000).effectiveImmediately, true);
  assert.equal(canView(store, 'proj-alpha', 'proj-beta', 'fiber-assets', NOW + 1001).allowed, false);
  assert.equal(revokeGrant(store, g.id, 'ops-admin', NOW + 2000).code, 'ALREADY_REVOKED');
});
test('self-grant and expired grants are rejected', () => {
  assert.equal(validateGrant({ ...base, toProject: 'proj-alpha' }).valid, false);
  const store = { grants: [] };
  assert.equal(createGrant(store, { ...base, expiresAt: '2020-01-01T00:00:00Z' }, NOW).code, 'INVALID');
});
