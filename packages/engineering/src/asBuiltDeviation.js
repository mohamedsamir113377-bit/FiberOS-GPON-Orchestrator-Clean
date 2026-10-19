'use strict';

/**
 * As-built vs design deviation registry — FTTH Handbook Ed.9 design/build/operate
 * and gap report P1.12. Records structured deltas only; does not invent geometry.
 */

const DEVIATION_KINDS = Object.freeze([
  'ROUTE_GEOMETRY',
  'LENGTH_M',
  'SPLICE_COUNT',
  'SPLITTER_RATIO',
  'FIBER_STANDARD',
  'CONNECTOR_COUNT',
  'CABLE_TYPE',
  'PORT_ASSIGNMENT',
  'LABEL_CODE',
  'OTHER'
]);

const SEVERITIES = Object.freeze(['INFO', 'MINOR', 'MAJOR', 'CRITICAL']);

function assertKind(kind) {
  const k = String(kind || '').trim().toUpperCase();
  if (!DEVIATION_KINDS.includes(k)) {
    const e = new Error('AS_BUILT_DEVIATION_KIND_UNKNOWN');
    e.code = 'AS_BUILT_DEVIATION_KIND_UNKNOWN';
    e.statusCode = 400;
    e.allowed = DEVIATION_KINDS.slice();
    throw e;
  }
  return k;
}

function assertSeverity(sev) {
  const s = String(sev || 'MINOR').trim().toUpperCase();
  if (!SEVERITIES.includes(s)) {
    const e = new Error('AS_BUILT_SEVERITY_INVALID');
    e.code = 'AS_BUILT_SEVERITY_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return s;
}

/**
 * Build a freeze-safe deviation record from design vs as-built values.
 */
function buildAsBuiltDeviation({
  designRef,
  asBuiltRef,
  kind,
  designValue,
  asBuiltValue,
  reason,
  severity = 'MINOR',
  affectsService = false
} = {}) {
  const k = assertKind(kind);
  const sev = assertSeverity(severity);
  const dRef = String(designRef || '').trim();
  const aRef = String(asBuiltRef || '').trim();
  if (!dRef || dRef.length > 160) {
    const e = new Error('AS_BUILT_DESIGN_REF_REQUIRED');
    e.code = 'AS_BUILT_DESIGN_REF_REQUIRED';
    e.statusCode = 400;
    throw e;
  }
  if (!aRef || aRef.length > 160) {
    const e = new Error('AS_BUILT_REF_REQUIRED');
    e.code = 'AS_BUILT_REF_REQUIRED';
    e.statusCode = 400;
    throw e;
  }
  const matched =
    designValue == null || asBuiltValue == null
      ? false
      : String(designValue) === String(asBuiltValue);
  return Object.freeze({
    designRef: dRef,
    asBuiltRef: aRef,
    kind: k,
    designValue: designValue == null ? null : designValue,
    asBuiltValue: asBuiltValue == null ? null : asBuiltValue,
    matched,
    reason: reason ? String(reason).slice(0, 500) : null,
    severity: sev,
    affectsService: Boolean(affectsService),
    truthBoundary: 'DEVIATION_RECORD_ONLY; GIS_AND_FIELD_VERIFICATION_REMAIN_RUNTIME',
    syntheticData: false
  });
}

function summarizeDeviations(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const unmatched = list.filter((r) => r && r.matched === false);
  const critical = unmatched.filter((r) => r.severity === 'CRITICAL' || r.affectsService);
  return Object.freeze({
    total: list.length,
    matched: list.length - unmatched.length,
    unmatched: unmatched.length,
    serviceAffecting: critical.length,
    status: critical.length ? 'AS_BUILT_SERVICE_RISK' : unmatched.length ? 'AS_BUILT_HAS_DEVIATIONS' : 'AS_BUILT_ALIGNED'
  });
}

module.exports = {
  DEVIATION_KINDS,
  SEVERITIES,
  buildAsBuiltDeviation,
  summarizeDeviations
};
