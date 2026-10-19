'use strict';

/**
 * Locked PON/OSS fault taxonomy from FTTH Handbook Ed.9 p.254 (six alarms)
 * plus operational optical classes used in field intake.
 *
 * System classification must not accept free-text types outside this registry.
 */

const HANDBOOK_SIX = Object.freeze([
  Object.freeze({
    code: 'DYING_GASP',
    handbookLabel: 'Dying Gasp',
    layer: 'ONT_POWER',
    detection: 'Last signal before power loss on ONT',
    pageRef: 'FTTH Handbook Ed.9 p.254'
  }),
  Object.freeze({
    code: 'LOS',
    handbookLabel: 'LOS',
    layer: 'OPTICAL',
    detection: 'Loss of signal / fiber cut / open',
    pageRef: 'FTTH Handbook Ed.9 p.254'
  }),
  Object.freeze({
    code: 'LOFI',
    handbookLabel: 'LOFI',
    layer: 'FRAMING',
    detection: 'Loss of frame / sync',
    pageRef: 'FTTH Handbook Ed.9 p.254'
  }),
  Object.freeze({
    code: 'HIGH_BER',
    handbookLabel: 'High BER',
    layer: 'TRANSMISSION',
    detection: 'Bit error rate above threshold',
    pageRef: 'FTTH Handbook Ed.9 p.254'
  }),
  Object.freeze({
    code: 'HIGH_TEMPERATURE',
    handbookLabel: 'High Temperature',
    layer: 'ENVIRONMENT',
    detection: 'Equipment thermal alarm',
    pageRef: 'FTTH Handbook Ed.9 p.254'
  }),
  Object.freeze({
    code: 'ROGUE_ONT',
    handbookLabel: 'Rogue ONT',
    layer: 'PON_MAC',
    detection: 'ONT transmitting outside its timeslot',
    pageRef: 'FTTH Handbook Ed.9 p.254'
  })
]);

/** Field intake types already in fault_jobs — kept for operational continuity. */
const FIELD_INTAKE_TYPES = Object.freeze([
  'OPTICAL_LOSS',
  'NO_SYNC',
  'DROP_DAMAGE',
  'CPE',
  'POWER',
  'INTERMITTENT',
  'UNKNOWN'
]);

const ALL_SYSTEM_CODES = Object.freeze([
  ...HANDBOOK_SIX.map((x) => x.code),
  ...FIELD_INTAKE_TYPES
]);

function normalizeFaultCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function isHandbookSix(code) {
  const c = normalizeFaultCode(code);
  return HANDBOOK_SIX.some((x) => x.code === c);
}

function assertSystemFaultType(code) {
  const c = normalizeFaultCode(code);
  if (!ALL_SYSTEM_CODES.includes(c)) {
    const e = new Error('FAULT_TYPE_NOT_IN_SYSTEM_TAXONOMY');
    e.code = 'FAULT_TYPE_NOT_IN_SYSTEM_TAXONOMY';
    e.statusCode = 400;
    e.allowed = ALL_SYSTEM_CODES.slice();
    throw e;
  }
  return c;
}

function describeFault(code) {
  const c = assertSystemFaultType(code);
  const six = HANDBOOK_SIX.find((x) => x.code === c);
  if (six) return { ...six, category: 'HANDBOOK_SIX' };
  return Object.freeze({
    code: c,
    handbookLabel: c,
    layer: 'FIELD_INTAKE',
    detection: 'Operational field intake classification',
    pageRef: 'sql/migrations/132_fault_workflows.sql',
    category: 'FIELD_INTAKE'
  });
}

function listTaxonomy() {
  return Object.freeze({
    handbookSix: HANDBOOK_SIX,
    fieldIntake: FIELD_INTAKE_TYPES,
    allCodes: ALL_SYSTEM_CODES
  });
}

module.exports = {
  HANDBOOK_SIX,
  FIELD_INTAKE_TYPES,
  ALL_SYSTEM_CODES,
  normalizeFaultCode,
  isHandbookSix,
  assertSystemFaultType,
  describeFault,
  listTaxonomy
};
