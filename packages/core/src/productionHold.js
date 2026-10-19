/**
 * FiberOS commercial distribution: production hold boundary.
 *
 * This module intentionally does NOT claim that a deployment is production-ready.
 * The hold remains active by default. A deployment may only report a lifted hold
 * when BOTH explicit controls are present and a buyer-owned live verification
 * attestation file declares all required runtime proofs successful.
 *
 * The attestation is an input to the gate, not proof that this source package has
 * performed those checks. The buyer remains responsible for generating truthful
 * evidence in the deployed environment.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_CHECKS = Object.freeze([
  'databaseConnectivity',
  'rlsTenantIsolation',
  'identityOidcJwks',
  'tlsIngress',
  'secretsBoundary',
  'backupRestore',
  'rateLimitBoundary',
  'externalAdapters'
]);

function isHoldActive(env) {
  env = env || process.env;
  return String(env.PRODUCTION_HOLD || 'true').toLowerCase() !== 'false';
}

function attestationPath(env) {
  env = env || process.env;
  return path.resolve(
    env.FIBEROS_PRODUCTION_ATTESTATION_FILE ||
      path.join(process.cwd(), 'config', 'production-readiness-attestation.json')
  );
}

function readAttestation(env) {
  const file = attestationPath(env);
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'PRODUCTION_ATTESTATION_MISSING', file };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || data.schema !== 'fiberos.production-readiness-attestation.v1') {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_SCHEMA_INVALID', file };
    }
    if (data.productionReady !== true) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_NOT_READY', file };
    }
    const checks = data.checks || {};
    const missing = REQUIRED_CHECKS.filter((name) => checks[name] !== true);
    if (missing.length) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_CHECKS_INCOMPLETE', missing, file };
    }
    if (data.evidenceMode !== 'live') {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_LIVE_EVIDENCE_REQUIRED', file };
    }
    if (!data.verifiedAt || !data.verifiedBy) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_PROVENANCE_MISSING', file };
    }
    const verifiedMs = new Date(data.verifiedAt).getTime();
    if (!Number.isFinite(verifiedMs)) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_VERIFIED_AT_INVALID', file };
    }
    const configuredMaxAge = Number(env.FIBEROS_PRODUCTION_ATTESTATION_MAX_AGE_MS || 86_400_000);
    if (!Number.isFinite(configuredMaxAge) || configuredMaxAge < 60_000) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_MAX_AGE_INVALID', file };
    }
    const maxAgeMs = configuredMaxAge;
    const futureSkewMs = Number(env.FIBEROS_PRODUCTION_ATTESTATION_FUTURE_SKEW_MS || 5 * 60_000);
    if (!Number.isFinite(futureSkewMs) || futureSkewMs < 0 || futureSkewMs > 86_400_000) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_FUTURE_SKEW_INVALID', file };
    }
    if (verifiedMs - Date.now() > futureSkewMs) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_VERIFIED_AT_IN_FUTURE', file };
    }
    if (Date.now() - verifiedMs > maxAgeMs) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_STALE', file };
    }
    if (data.expiresAt != null) {
      const expiresMs = new Date(data.expiresAt).getTime();
      if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
        return { ok: false, reason: 'PRODUCTION_ATTESTATION_EXPIRED', file };
      }
    }
    const expectedDeployment = String(env.FIBEROS_DEPLOYMENT_ID || '').trim();
    if (expectedDeployment && String(data.deploymentId || '').trim() !== expectedDeployment) {
      return { ok: false, reason: 'PRODUCTION_ATTESTATION_DEPLOYMENT_MISMATCH', file };
    }
    return { ok: true, attestation: data, file };
  } catch (_err) {
    return { ok: false, reason: 'PRODUCTION_ATTESTATION_PARSE_ERROR', file };
  }
}

function canClaimProductionReady(env) {
  env = env || process.env;
  if (isHoldActive(env)) {
    return {
      ok: false,
      productionReady: false,
      reason: 'PRODUCTION_HOLD_ACTIVE',
      required: REQUIRED_CHECKS.slice(),
      note: 'The production hold is fail-closed and must remain active until the buyer proves the live runtime controls.'
    };
  }

  if (String(env.FIBEROS_PRODUCTION_VERIFIED || '').toLowerCase() !== 'true') {
    return {
      ok: false,
      productionReady: false,
      reason: 'PRODUCTION_VERIFICATION_FLAG_MISSING',
      note: 'PRODUCTION_HOLD=false is not sufficient by itself; FIBEROS_PRODUCTION_VERIFIED=true is also required.'
    };
  }

  const attestation = readAttestation(env);
  if (!attestation.ok) {
    return {
      ok: false,
      productionReady: false,
      reason: attestation.reason,
      missing: attestation.missing || undefined,
      note: 'A buyer-owned live verification attestation is required. This package never fabricates that evidence.'
    };
  }

  return {
    ok: true,
    productionReady: true,
    reason: 'PRODUCTION_HOLD_LIFTED_WITH_BUYER_ATTESTATION',
    attestationFile: attestation.file
  };
}

function statusPayload(env) {
  env = env || process.env;
  const claim = canClaimProductionReady(env);
  return {
    productionHold: isHoldActive(env),
    productionReady: claim.productionReady,
    reason: claim.reason,
    required: claim.required,
    note: claim.note
  };
}

module.exports = {
  REQUIRED_CHECKS,
  isHoldActive,
  readAttestation,
  canClaimProductionReady,
  statusPayload
};
