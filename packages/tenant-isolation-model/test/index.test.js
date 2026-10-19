'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/index');

test('decideIsolation forces SILO for sovereign/restricted', () => {
  assert.equal(t.decideIsolation({ complianceTier: 'SOVEREIGN', dataSensitivity: 'INTERNAL', tenantCount: 5 }).tier, 'SILO');
  assert.equal(t.decideIsolation({ complianceTier: 'STANDARD', dataSensitivity: 'RESTRICTED', tenantCount: 5 }).tier, 'SILO');
  assert.equal(t.decideIsolation({ complianceTier: 'STANDARD', dataSensitivity: 'INTERNAL', tenantCount: 200 }).tier, 'POOL');
});

test('noisyNeighborBudget splits capacity with headroom', () => {
  const r = t.noisyNeighborBudget({ totalCapacityRps: 1000, tenantCount: 10, headroomPct: 0.2 });
  assert.equal(r.usableCapacityRps, 800);
  assert.equal(r.perTenantFairShareRps, 80);
});

test('deriveTenantKey never stores the secret and is deterministic', () => {
  const a = t.deriveTenantKey({ tenantId: 'T1', masterSecretRef: 'kms://ref-1' });
  const b = t.deriveTenantKey({ tenantId: 'T1', masterSecretRef: 'kms://ref-1' });
  const c = t.deriveTenantKey({ tenantId: 'T2', masterSecretRef: 'kms://ref-1' });
  assert.equal(a.keyFingerprint, b.keyFingerprint);
  assert.notEqual(a.keyFingerprint, c.keyFingerprint);
  assert.equal(a.secretStored, false);
});

test('rlsRequirement mandates forced RLS for every tier', () => {
  for (const tier of t.ISOLATION_TIERS) {
    const r = t.rlsRequirement(tier);
    assert.equal(r.forceRowLevelSecurity, true);
    assert.equal(r.crossTenantJoinForbidden, true);
  }
  assert.throws(() => t.rlsRequirement('NOPE'));
});
