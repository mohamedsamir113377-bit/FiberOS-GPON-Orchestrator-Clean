'use strict';

/**
 * Compatibility validator for the R8 matrix-evidence contract.
 *
 * This module is deliberately NOT a production-readiness authority in Sales Core.
 * The current authoritative release path is productionHold.js + the buyer-owned
 * production-readiness attestation. This validator exists so historical/non-prod
 * matrix evidence can still be checked fail-closed without becoming proof itself.
 */

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_CHECKS = Object.freeze([
  'roleMatrix',
  'auditAppendOnly',
  'illegalTransitionRejected',
  'fieldCannotComplete'
]);

const PLACEHOLDER_MARKERS = Object.freeze([
  'YOUR_SUPABASE_REF',
  'YOUR_NAME',
  'REPLACE',
  'SECURITY_REVIEW_MARKER',
  'EXAMPLE'
]);

function isPlaceholderString(value) {
  const text = String(value || '');
  if (!text.trim()) return true;
  const upper = text.toUpperCase();
  return PLACEHOLDER_MARKERS.some((marker) => upper.includes(marker));
}

function validateMatrixEvidenceObject(evidence) {
  const failures = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { ok: false, reason: 'EVIDENCE_NOT_OBJECT', failures: ['not_object'] };
  }
  if (isPlaceholderString(evidence.projectRef)) failures.push('projectRef_placeholder_or_empty');
  if (isPlaceholderString(evidence.operator)) failures.push('operator_placeholder_or_empty');
  if (!evidence.ranAt || Number.isNaN(Date.parse(evidence.ranAt))) failures.push('ranAt_invalid');

  if (!evidence.checks || typeof evidence.checks !== 'object' || Array.isArray(evidence.checks)) {
    failures.push('checks_missing');
  } else {
    for (const key of REQUIRED_CHECKS) {
      if (evidence.checks[key] === undefined || evidence.checks[key] === null) failures.push(`check_missing:${key}`);
    }
    const roleMatrix = evidence.checks.roleMatrix;
    if (roleMatrix !== '14/14' && roleMatrix !== 'PASS' && roleMatrix !== true) failures.push('roleMatrix_not_pass');
    if (evidence.checks.auditAppendOnly !== true) failures.push('auditAppendOnly_not_true');
    if (evidence.checks.illegalTransitionRejected !== true) failures.push('illegalTransitionRejected_not_true');
    if (evidence.checks.fieldCannotComplete !== true) failures.push('fieldCannotComplete_not_true');
  }

  if (evidence.ranAt && !Number.isNaN(Date.parse(evidence.ranAt))) {
    const ageMs = Date.now() - Date.parse(evidence.ranAt);
    if (ageMs > 90 * 24 * 60 * 60 * 1000) failures.push('evidence_stale_gt_90d');
    if (ageMs < -60 * 60 * 1000) failures.push('ranAt_in_future');
  }

  return {
    ok: failures.length === 0,
    reason: failures.length ? 'EVIDENCE_VALIDATION_FAILED' : 'EVIDENCE_STRUCTURE_OK',
    failures,
    note: 'Structure validation does not prove that a cloud matrix was executed.'
  };
}

function validateMatrixEvidenceFile(filePath) {
  const candidate = filePath || path.join(process.cwd(), 'config', 'matrix-evidence.json');
  if (!fs.existsSync(candidate)) return { ok: false, reason: 'EVIDENCE_FILE_MISSING', path: candidate, failures: ['file_missing'] };
  if (path.basename(candidate) === 'matrix-evidence.example.json') {
    return { ok: false, reason: 'EXAMPLE_FILE_NOT_ALLOWED_AS_EVIDENCE', path: candidate, failures: ['example_file'] };
  }
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch (error) {
    return { ok: false, reason: 'EVIDENCE_PARSE_ERROR', path: candidate, failures: [String(error.message || error)] };
  }
  return Object.assign({ path: candidate }, validateMatrixEvidenceObject(evidence), { evidence });
}

module.exports = { REQUIRED_CHECKS, validateMatrixEvidenceObject, validateMatrixEvidenceFile, isPlaceholderString };
