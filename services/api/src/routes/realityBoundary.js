'use strict';

/**
 * Pure advisory/boundary surfaces for Network Reality Kernel optical path binding
 * and PON telemetry normalization. No vendor connectivity and no live topology mutation.
 */

const Reality = require('../../../../packages/network-reality-kernel/src');
const { publicError } = require('../../../../packages/security/src/errorBoundary');

// southbound-contract is ESM — load via dynamic import cached once
let ponBoundaryPromise = null;
function loadPonBoundary() {
  if (!ponBoundaryPromise) {
    ponBoundaryPromise = import('../../../../packages/southbound-contract/src/ponTelemetryBoundary.js');
  }
  return ponBoundaryPromise;
}

function run(fn, body) {
  try {
    return { status: 200, body: { ok: true, authority: 'BOUNDARY_ADVISORY', result: fn(body || {}) } };
  } catch (e) {
    const client = e instanceof TypeError || e instanceof RangeError || (e && /REQUIRED|INVALID|FORBIDDEN|UNSUPPORTED/.test(String(e.message || '')));
    return publicError(Object.assign(e instanceof Error ? e : new Error(String(e)), { statusCode: client ? 400 : 500 }), client ? 'INVALID_BOUNDARY_INPUT' : 'BOUNDARY_COMPUTATION_FAILED');
  }
}

async function handleRealityBoundary(path, body) {
  const key = String(path || '').replace(/^\/v1\/reality-boundary\//, '').replace(/-/g, '');

  if (key === 'opticalassurance') {
    return run(Reality.assessOpticalAssurance, body);
  }
  if (key === 'opticalassuranceledger') {
    return run(Reality.compileOpticalAssuranceLedgerRecord, body);
  }
  if (key === 'validateopticalevidence') {
    return run(Reality.validateOpticalEvidence, body);
  }

  // PON telemetry boundary (ESM)
  const pon = await loadPonBoundary();
  if (key === 'ponadapterdeclaration') {
    return run(pon.validatePonAdapterDeclaration, body);
  }
  if (key === 'pontelemetrysample') {
    return run((b) => pon.normalizePonTelemetrySample(b, { adapterId: b && b.adapterId }), body);
  }
  if (key === 'pontelemetrybatch') {
    return run((b) => pon.normalizePonTelemetryBatch(Array.isArray(b) ? b : (b && b.samples) || [], { adapterId: b && b.adapterId }), body);
  }
  if (key === 'poncorrelationkeys') {
    return run((b) => {
      const obs = b && b.schema === 'fiberos.pon-telemetry-observation.v1'
        ? b
        : pon.normalizePonTelemetrySample(b || {});
      return pon.correlationKeysFromObservation(obs);
    }, body);
  }

  return { status: 404, body: { ok: false, error: 'REALITY_BOUNDARY_ENDPOINT_NOT_FOUND' } };
}

module.exports = { handleRealityBoundary };
