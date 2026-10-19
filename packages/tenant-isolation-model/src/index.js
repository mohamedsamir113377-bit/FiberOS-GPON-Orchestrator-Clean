'use strict';

/**
 * Multi-tenant isolation model (silo / bridge / pool) with noisy-neighbour
 * budgets and per-tenant key derivation. Concept source (public): enterprise
 * multi-tenancy architecture & security literature (isolation tiers, shared
 * responsibility, tenant-scoped keys). Deterministic; no secret is stored.
 */

const crypto = require('node:crypto');

const ISOLATION_TIERS = Object.freeze(['SILO', 'BRIDGE', 'POOL']);
const DATA_SENSITIVITY = Object.freeze(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
const COMPLIANCE_TIERS = Object.freeze(['STANDARD', 'REGULATED', 'SOVEREIGN']);

function decideIsolation({ complianceTier, dataSensitivity, tenantCount, noisyNeighborTolerance }) {
  const comp = String(complianceTier || 'STANDARD').toUpperCase();
  const sens = String(dataSensitivity || 'INTERNAL').toUpperCase();
  const tol = String(noisyNeighborTolerance || 'MEDIUM').toUpperCase();
  if (!COMPLIANCE_TIERS.includes(comp)) throw new Error('TIM_COMPLIANCE_TIER_INVALID');
  if (!DATA_SENSITIVITY.includes(sens)) throw new Error('TIM_SENSITIVITY_INVALID');
  const count = Number(tenantCount);
  if (!Number.isFinite(count) || count < 0) throw new Error('TIM_TENANT_COUNT_INVALID');

  let tier;
  if (comp === 'SOVEREIGN' || sens === 'RESTRICTED') tier = 'SILO';
  else if (comp === 'REGULATED' || sens === 'CONFIDENTIAL' || tol === 'LOW') tier = 'BRIDGE';
  else tier = count > 50 ? 'POOL' : 'BRIDGE';

  return Object.freeze({
    tier,
    dedicatedSchema: tier === 'SILO',
    dedicatedDatabase: tier === 'SILO',
    rowLevelSecurityRequired: tier !== 'SILO' || true,
    keyScope: tier === 'SILO' ? 'PER_TENANT_KEY' : tier === 'BRIDGE' ? 'PER_TENANT_KEY' : 'SHARED_KEY_DERIVED',
    rationale: { complianceTier: comp, dataSensitivity: sens, tenantCount: count, noisyNeighborTolerance: tol }
  });
}

function noisyNeighborBudget({ totalCapacityRps, tenantCount, headroomPct = 0.2 }) {
  const cap = Number(totalCapacityRps);
  const n = Math.trunc(tenantCount);
  const h = Number(headroomPct);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('TIM_CAPACITY_INVALID');
  if (!Number.isInteger(n) || n < 1) throw new Error('TIM_TENANT_COUNT_INVALID');
  if (!Number.isFinite(h) || h < 0 || h >= 1) throw new Error('TIM_HEADROOM_INVALID');
  const usable = cap * (1 - h);
  return Object.freeze({
    usableCapacityRps: Number(usable.toFixed(4)),
    perTenantFairShareRps: Number((usable / n).toFixed(4)),
    burstCeilingRps: Number((cap * 0.5).toFixed(4)),
    headroomPct: h
  });
}

function deriveTenantKey({ tenantId, masterSecretRef, salt = 'fiberos.v1' }) {
  if (!tenantId) throw new Error('TIM_TENANT_REQUIRED');
  if (!masterSecretRef) throw new Error('TIM_MASTER_SECRET_REF_REQUIRED');
  // The master secret is never materialised here: only a reference is accepted.
  const material = crypto.createHmac('sha256', String(masterSecretRef)).update(String(salt) + '|' + String(tenantId)).digest('hex');
  return Object.freeze({ tenantId: String(tenantId), keyFingerprint: material.slice(0, 16), algorithm: 'HMAC-SHA256', secretStored: false });
}

function rlsRequirement(tier) {
  const t = String(tier).toUpperCase();
  if (!ISOLATION_TIERS.includes(t)) throw new Error('TIM_TIER_INVALID');
  return Object.freeze({
    tier: t,
    forceRowLevelSecurity: true,
    tenantPredicateRequired: true,
    crossTenantJoinForbidden: true,
    sharedPoolAllowed: t === 'POOL'
  });
}

module.exports = { ISOLATION_TIERS, DATA_SENSITIVITY, COMPLIANCE_TIERS, decideIsolation, noisyNeighborBudget, deriveTenantKey, rlsRequirement };
