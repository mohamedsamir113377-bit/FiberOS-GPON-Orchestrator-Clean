'use strict';

/**
 * Structured OTDR policy — bidirectional splice loss, maintenance wavelengths.
 * Sources: ITU-T Manual 2009 (splice MFD asymmetry); FTTH Handbook Ed.9 Ch.11.
 */

const MAINTENANCE_WAVELENGTHS_NM = Object.freeze([1625, 1650]);
const ACTIVE_WAVELENGTHS_NM = Object.freeze([1310, 1490, 1550]);
const MAX_PRACTICAL_SPLICE_LOSS_DB = 0.1;
const MAX_CORE_ALIGNED_FUSION_DB = 0.03;
const MAX_CLADDING_ALIGNED_FUSION_DB = 0.05;
const MAX_MECHANICAL_SPLICE_DB = 0.5;

function finite(x, name) {
  const n = Number(x);
  if (!Number.isFinite(n)) {
    const e = new Error('OTDR_' + name.toUpperCase() + '_INVALID');
    e.code = 'OTDR_' + name.toUpperCase() + '_INVALID';
    throw e;
  }
  return n;
}

function nonNeg(x, name) {
  const n = finite(x, name);
  if (n < 0) {
    const e = new Error('OTDR_' + name.toUpperCase() + '_NEGATIVE');
    e.code = 'OTDR_' + name.toUpperCase() + '_NEGATIVE';
    throw e;
  }
  return n;
}

/**
 * Validate a single direction OTDR acquisition metadata (not the SOR binary).
 */
function validateOtdrAcquisition(meta = {}) {
  const wavelengthNm = finite(meta.wavelengthNm, 'wavelengthNm');
  const pulseWidthNs = nonNeg(meta.pulseWidthNs == null ? 0 : meta.pulseWidthNs, 'pulseWidthNs');
  const ior = finite(meta.ior == null ? 1.468 : meta.ior, 'ior');
  if (ior < 1.4 || ior > 1.5) {
    const e = new Error('OTDR_IOR_OUT_OF_RANGE');
    e.code = 'OTDR_IOR_OUT_OF_RANGE';
    throw e;
  }
  const direction = String(meta.direction || '').trim().toUpperCase();
  if (!['A_TO_B', 'B_TO_A', 'UNKNOWN'].includes(direction)) {
    const e = new Error('OTDR_DIRECTION_INVALID');
    e.code = 'OTDR_DIRECTION_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const isMaintenanceBand = MAINTENANCE_WAVELENGTHS_NM.includes(Math.round(wavelengthNm));
  return Object.freeze({
    wavelengthNm,
    pulseWidthNs,
    ior,
    direction,
    isMaintenanceBand,
    // Wavelength alone is NOT proof of live-network safety.
    liveTrafficSafety: Object.freeze({
      status: isMaintenanceBand ? 'CANDIDATE_ONLY' : 'NOT_CANDIDATE',
      liveTrafficSafe: false,
      reason: isMaintenanceBand
        ? 'MAINTENANCE_WAVELENGTH_ONLY_CANDIDATE; REQUIRES_PON_PROFILE_FILTERS_WDM_VENDOR_PROCEDURE'
        : 'ACTIVE_BAND_OR_UNKNOWN_NOT_SAFE_BY_DEFAULT'
    }),
    // Deprecated boolean kept false always to avoid over-claim.
    liveTrafficSafe: false,
    truthBoundary: 'METADATA_VALIDATED; SOR_FILE_PARSE_AND_INSTRUMENT_CONNECTIVITY_UNVERIFIED'
  });
}

/**
 * Splice loss from a single direction is rejected for acceptance decisions
 * because MFD mismatch biases unidirectional OTDR (Manual p.98; Handbook p.288-289).
 */
function evaluateSpliceLossFromOtdr({
  forwardLossDb,
  reverseLossDb,
  method = 'FUSION_CORE'
} = {}) {
  if (forwardLossDb == null || reverseLossDb == null) {
    return Object.freeze({
      status: 'REJECTED_BIDIRECTIONAL_REQUIRED',
      accepted: false,
      reason: 'UNIDIRECTIONAL_SPLICE_LOSS_NOT_ADMISSIBLE',
      bidirectionalAverageDb: null,
      limitDb: MAX_PRACTICAL_SPLICE_LOSS_DB,
      truthBoundary: 'Bidirectional pair required before splice loss may be accepted into as-built'
    });
  }
  const fwd = nonNeg(forwardLossDb, 'forwardLossDb');
  const rev = nonNeg(reverseLossDb, 'reverseLossDb');
  const avg = (fwd + rev) / 2;
  const methodKey = String(method || '').trim().toUpperCase() || 'FUSION_CORE';
  const METHOD_LIMITS = Object.freeze({
    FUSION_CORE: MAX_CORE_ALIGNED_FUSION_DB,
    FUSION_CLADDING: MAX_CLADDING_ALIGNED_FUSION_DB,
    MECHANICAL: MAX_MECHANICAL_SPLICE_DB,
    PRACTICAL: MAX_PRACTICAL_SPLICE_LOSS_DB
  });
  if (!Object.prototype.hasOwnProperty.call(METHOD_LIMITS, methodKey)) {
    return Object.freeze({
      status: 'REJECTED_METHOD_UNKNOWN',
      accepted: false,
      reason: 'SPLICE_METHOD_MUST_BE_DECLARED',
      method: methodKey,
      allowedMethods: Object.keys(METHOD_LIMITS),
      bidirectionalAverageDb: avg,
      limitDb: null,
      truthBoundary: 'Unknown method must not receive a generic acceptance limit'
    });
  }
  const limit = METHOD_LIMITS[methodKey];

  const accepted = avg <= limit;
  return Object.freeze({
    status: accepted ? 'ACCEPTED' : 'REJECTED_OVER_LIMIT',
    accepted,
    bidirectionalAverageDb: avg,
    forwardLossDb: fwd,
    reverseLossDb: rev,
    method: methodKey,
    limitDb: limit,
    truthBoundary: 'POLICY_EVALUATION_ONLY; FIELD_INSTRUMENT_READING_NOT_PROVEN'
  });
}

function selectMaintenanceWavelength({ activeDownstreamNm, activeUpstreamNm } = {}) {
  const down = activeDownstreamNm == null ? null : Math.round(Number(activeDownstreamNm));
  const up = activeUpstreamNm == null ? null : Math.round(Number(activeUpstreamNm));
  // Manual table 10-4 p.275
  if ((down === 1310 || up === 1310) && (down === 1550 || up === 1550)) {
    return Object.freeze({ wavelengthNm: 1650, band: 'U', reason: 'BOTH_1310_AND_1550_ACTIVE' });
  }
  if (down === 1310 || up === 1310) {
    return Object.freeze({ wavelengthNm: 1625, band: 'L_EXTENDED', reason: '1310_ACTIVE' });
  }
  if (down === 1550 || up === 1550) {
    return Object.freeze({ wavelengthNm: 1625, band: 'L_EXTENDED', reason: '1550_ACTIVE' });
  }
  return Object.freeze({ wavelengthNm: 1625, band: 'L_EXTENDED', reason: 'DEFAULT_MAINTENANCE' });
}

module.exports = {
  MAINTENANCE_WAVELENGTHS_NM,
  ACTIVE_WAVELENGTHS_NM,
  MAX_PRACTICAL_SPLICE_LOSS_DB,
  MAX_CORE_ALIGNED_FUSION_DB,
  MAX_CLADDING_ALIGNED_FUSION_DB,
  MAX_MECHANICAL_SPLICE_DB,
  validateOtdrAcquisition,
  evaluateSpliceLossFromOtdr,
  selectMaintenanceWavelength
};
