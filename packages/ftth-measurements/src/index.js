'use strict';

const opticalEngineering = require('./opticalEngineering');

/**
 * FiberOS FTTH / GPON Measurement Authority
 * ==========================================
 * Pure domain module. No I/O. No simulated authority.
 *
 * Standards basis (documented, not invented):
 * - ITU-T G.984.2 (GPON physical media dependent layer) Class B+ receiver:
 *     sensitivity −28 dBm, overload −8 dBm (nominal window used by production
 *     operators for ONT Rx acceptance).
 * - Source binding: every numeric reading MUST carry an explicit source from
 *   the closed set enforced by Postgres CHECK on optical_measurements.source.
 * - ai_simulated / proxy can never authoritatively close a ticket.
 *
 * This module is the server-side counterpart of the EvidenceGate contract
 * formalized in the HTML laboratory reference. Browser demos remain advisory.
 */

const GPON_CLASS_B_PLUS = Object.freeze({
  standard: 'ITU-T G.984.2 Class B+',
  rxMinDbm: -28,
  rxMaxDbm: -8,
  note: 'Nominal acceptance window for ONT continuous-mode receiver Class B+'
});

const MEASUREMENT_TYPES = Object.freeze([
  'rx_power',
  'otdr_trace',
  'insertion_loss'
]);

const AUTHORITATIVE_SOURCES = Object.freeze([
  'field_reading',
  'nms_poll'
]);

const NON_AUTHORITATIVE_SOURCES = Object.freeze([
  'ai_simulated'
]);

const ALL_SOURCES = Object.freeze([
  ...AUTHORITATIVE_SOURCES,
  ...NON_AUTHORITATIVE_SOURCES
]);

const MAX_GEO_DISTANCE_METERS_DEFAULT = 50;

function finiteNumber(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    const err = new TypeError(`${name} must be a finite number`);
    err.code = 'INVALID_NUMERIC';
    throw err;
  }
  return n;
}

function isValidSource(source) {
  return ALL_SOURCES.indexOf(String(source || '')) !== -1;
}

function isAuthoritativeSource(source) {
  return AUTHORITATIVE_SOURCES.indexOf(String(source || '')) !== -1;
}

/**
 * Validate a single optical reading against GPON Class B+ window.
 * Returns a structured result; never throws for range violations.
 */
function validateRxPower(powerDbm, options) {
  options = options || {};
  const min = options.minDbm != null ? Number(options.minDbm) : GPON_CLASS_B_PLUS.rxMinDbm;
  const max = options.maxDbm != null ? Number(options.maxDbm) : GPON_CLASS_B_PLUS.rxMaxDbm;
  if (powerDbm === undefined || powerDbm === null) {
    return {
      ok: false,
      code: 'RX_POWER_MISSING',
      powerDbm: null,
      window: { min, max },
      standard: GPON_CLASS_B_PLUS.standard
    };
  }
  let p;
  try {
    p = finiteNumber(powerDbm, 'powerDbm');
  } catch (e) {
    return {
      ok: false,
      code: 'RX_POWER_NOT_NUMERIC',
      powerDbm: powerDbm,
      window: { min, max },
      standard: GPON_CLASS_B_PLUS.standard
    };
  }
  if (p < min || p > max) {
    return {
      ok: false,
      code: 'RX_POWER_OUT_OF_GPON_RANGE',
      powerDbm: p,
      window: { min, max },
      standard: GPON_CLASS_B_PLUS.standard
    };
  }
  return {
    ok: true,
    code: 'RX_POWER_IN_RANGE',
    powerDbm: p,
    window: { min, max },
    standard: GPON_CLASS_B_PLUS.standard
  };
}

/**
 * Evidence / close gate — pure function.
 * Mirrors the formal INTERFACE_CONTRACTS.EvidenceGate from the HTML lab,
 * but is the only authoritative implementation for production services.
 */
function evaluateCloseGate(input) {
  input = input || {};
  const missing = [];
  const reasons = [];

  const ticketId = input.ticketId != null ? String(input.ticketId) : '';
  if (!ticketId) missing.push('ticketId');

  const source = input.measurementSource || input.source || null;
  if (!source) {
    missing.push('measurementSource');
  } else if (!isValidSource(source)) {
    reasons.push('INVALID_MEASUREMENT_SOURCE');
  } else if (!isAuthoritativeSource(source)) {
    return Object.freeze({
      allow: false,
      finalClose: false,
      status: 'awaiting_evidence',
      reason: 'simulated_or_proxy_cannot_authoritatively_close',
      missing: missing.slice(),
      source,
      authority: 'SERVER_DOMAIN'
    });
  }

  const geoOk = input.gpsOk === true || input.geoVerified === true;
  if (!geoOk) missing.push('geo_verified');

  const hasFieldEvidence =
    input.hasPhoto === true ||
    (Array.isArray(input.evidenceIds) && input.evidenceIds.length > 0) ||
    input.hasFieldEvidence === true;
  if (!hasFieldEvidence) missing.push('field_evidence');

  if (input.powerDbm !== undefined && input.powerDbm !== null) {
    const rx = validateRxPower(input.powerDbm, input.rxWindow);
    if (!rx.ok) {
      missing.push('rx_power_out_of_gpon_range');
      reasons.push(rx.code);
    }
  }

  if (input.geoDistanceMeters !== undefined && input.geoDistanceMeters !== null) {
    const maxM =
      input.maxGeoDistanceMeters != null
        ? Number(input.maxGeoDistanceMeters)
        : MAX_GEO_DISTANCE_METERS_DEFAULT;
    const d = Number(input.geoDistanceMeters);
    if (!Number.isFinite(d) || d > maxM) {
      missing.push('geo_distance_exceeds_reality_gate');
      reasons.push('GEO_DISTANCE_EXCEEDED');
    }
  }

  if (input.requiresSignature === true && !input.signatureRef) {
    return Object.freeze({
      allow: false,
      finalClose: false,
      status: 'pending_signature',
      reason: 'signature_required_fail_closed',
      missing: missing.concat(['signatureRef']),
      source,
      authority: 'SERVER_DOMAIN'
    });
  }

  if (missing.length || reasons.length) {
    return Object.freeze({
      allow: false,
      finalClose: false,
      status: 'awaiting_evidence',
      reason: reasons[0] || 'evidence_incomplete',
      missing: missing.slice(),
      source,
      authority: 'SERVER_DOMAIN'
    });
  }

  return Object.freeze({
    allow: true,
    finalClose: true,
    status: 'completed',
    reason: 'evidence_ok',
    missing: [],
    source,
    authority: 'SERVER_DOMAIN'
  });
}

/**
 * Build a measurement row shape ready for insertion into optical_measurements.
 * Caller remains responsible for DB write + RLS.
 */
function buildMeasurementRecord(input) {
  input = input || {};
  if (!isValidSource(input.source)) {
    const err = new Error('INVALID_OPTICAL_SOURCE');
    err.code = 'INVALID_OPTICAL_SOURCE';
    throw err;
  }
  if (MEASUREMENT_TYPES.indexOf(String(input.measurementType || '')) === -1) {
    const err = new Error('INVALID_MEASUREMENT_TYPE');
    err.code = 'INVALID_MEASUREMENT_TYPE';
    throw err;
  }
  const record = {
    asset_id: input.assetId || null,
    port_id: input.portId || null,
    measurement_type: String(input.measurementType),
    value_numeric:
      input.valueNumeric != null ? finiteNumber(input.valueNumeric, 'valueNumeric') : null,
    unit: input.unit != null ? String(input.unit) : null,
    sor_file_ref: input.sorFileRef != null ? String(input.sorFileRef) : null,
    source: String(input.source),
    measured_by: input.measuredBy || null,
    measured_at: input.measuredAt || new Date().toISOString()
  };
  if (record.measurement_type === 'rx_power' && record.value_numeric != null) {
    const rx = validateRxPower(record.value_numeric);
    record.rx_validation = rx;
  }
  return Object.freeze(record);
}

module.exports = Object.freeze({
  GPON_CLASS_B_PLUS,
  MEASUREMENT_TYPES,
  AUTHORITATIVE_SOURCES,
  NON_AUTHORITATIVE_SOURCES,
  ALL_SOURCES,
  MAX_GEO_DISTANCE_METERS_DEFAULT,
  isValidSource,
  isAuthoritativeSource,
  validateRxPower,
  evaluateCloseGate,
  buildMeasurementRecord,
  opticalEngineering
});
