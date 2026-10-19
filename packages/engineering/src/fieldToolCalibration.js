'use strict';

/**
 * Field test tool calibration gate — OTDR / power meter / VFL.
 * FTTH Handbook Ed.9 Ch.11: uncalibrated instruments must not admit test campaigns.
 */

const TOOL_KINDS = Object.freeze(['OTDR', 'POWER_METER', 'VFL', 'INSPECTION_SCOPE', 'OLTS']);
const MAX_CALIBRATION_VALIDITY_MS = 5 * 366 * 24 * 60 * 60 * 1000;

function parseDate(value, code) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    const e = new Error(code || 'CALIBRATION_DATE_INVALID');
    e.code = code || 'CALIBRATION_DATE_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return d;
}

function normalizeKind(kind) {
  const k = String(kind || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!TOOL_KINDS.includes(k)) {
    const e = new Error('FIELD_TOOL_KIND_UNKNOWN');
    e.code = 'FIELD_TOOL_KIND_UNKNOWN';
    e.statusCode = 400;
    throw e;
  }
  return k;
}

/**
 * Evaluate whether a tool may run a measurement campaign at asOf.
 */
function evaluateToolCalibration({
  toolKind,
  serialNumber,
  calibrationCertificateId,
  calibratedAt,
  validUntil,
  asOf = new Date(),
  traceableReference
} = {}) {
  const kind = normalizeKind(toolKind);
  const serial = String(serialNumber || '').trim();
  if (serial.length < 2 || serial.length > 120) {
    const e = new Error('FIELD_TOOL_SERIAL_INVALID');
    e.code = 'FIELD_TOOL_SERIAL_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const certId = String(calibrationCertificateId || '').trim();
  if (!certId) {
    return Object.freeze({
      status: 'REJECTED_NO_CERTIFICATE',
      accepted: false,
      toolKind: kind,
      serialNumber: serial,
      reason: 'CALIBRATION_CERTIFICATE_REQUIRED'
    });
  }
  const until = parseDate(validUntil, 'CALIBRATION_VALID_UNTIL_INVALID');
  if (!until) {
    return Object.freeze({
      status: 'REJECTED_NO_VALIDITY',
      accepted: false,
      toolKind: kind,
      serialNumber: serial,
      reason: 'CALIBRATION_VALID_UNTIL_REQUIRED'
    });
  }
  const now = parseDate(asOf, 'CALIBRATION_AS_OF_INVALID') || new Date();
  const calibrated = parseDate(calibratedAt, 'CALIBRATED_AT_INVALID');
  if (!calibrated) {
    return Object.freeze({
      status: 'REJECTED_NO_CALIBRATION_DATE',
      accepted: false,
      toolKind: kind,
      serialNumber: serial,
      calibrationCertificateId: certId,
      validUntil: until.toISOString(),
      asOf: now.toISOString(),
      reason: 'CALIBRATION_CALIBRATED_AT_REQUIRED'
    });
  }
  if (calibrated.getTime() > now.getTime()) {
    const e = new Error('CALIBRATION_DATE_IN_FUTURE');
    e.code = 'CALIBRATION_DATE_IN_FUTURE';
    e.statusCode = 400;
    throw e;
  }
  if (calibrated.getTime() > until.getTime()) {
    const e = new Error('CALIBRATION_VALIDITY_INCONSISTENT');
    e.code = 'CALIBRATION_VALIDITY_INCONSISTENT';
    e.statusCode = 400;
    throw e;
  }
  if (until.getTime() - calibrated.getTime() > MAX_CALIBRATION_VALIDITY_MS) {
    const e = new Error('CALIBRATION_VALIDITY_IMPLAUSIBLE');
    e.code = 'CALIBRATION_VALIDITY_IMPLAUSIBLE';
    e.statusCode = 400;
    throw e;
  }
  if (now.getTime() > until.getTime()) {
    return Object.freeze({
      status: 'REJECTED_EXPIRED',
      accepted: false,
      toolKind: kind,
      serialNumber: serial,
      calibrationCertificateId: certId,
      validUntil: until.toISOString(),
      asOf: now.toISOString(),
      reason: 'CALIBRATION_EXPIRED'
    });
  }
  return Object.freeze({
    status: 'ACCEPTED',
    accepted: true,
    toolKind: kind,
    serialNumber: serial,
    calibrationCertificateId: certId,
    calibratedAt: calibrated ? calibrated.toISOString() : null,
    validUntil: until.toISOString(),
    asOf: now.toISOString(),
    traceableReference: traceableReference ? String(traceableReference).slice(0, 240) : null,
    truthBoundary: 'CERTIFICATE_METADATA_GATE_ONLY; PHYSICAL_LAB_TRACEABILITY_NOT_VERIFIED_HERE'
  });
}

/**
 * Gate a whole campaign: every required tool must be accepted.
 */
function authorizeMeasurementCampaign({ tools = [], asOf = new Date() } = {}) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return Object.freeze({
      status: 'REJECTED_NO_TOOLS',
      accepted: false,
      evaluations: Object.freeze([])
    });
  }
  const evaluations = tools.map((t) => evaluateToolCalibration({ ...t, asOf }));
  const rejected = evaluations.filter((e) => !e.accepted);
  return Object.freeze({
    status: rejected.length ? 'REJECTED_UNCALIBRATED_TOOL' : 'ACCEPTED',
    accepted: rejected.length === 0,
    evaluations: Object.freeze(evaluations),
    rejectedCount: rejected.length
  });
}

module.exports = {
  TOOL_KINDS,
  evaluateToolCalibration,
  authorizeMeasurementCampaign
};
