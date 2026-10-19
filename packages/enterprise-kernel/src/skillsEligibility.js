'use strict';

/**
 * Pure deterministic skills & certification eligibility filter.
 * HV-03 / W8 — advisory only. Never auto-assigns.
 *
 * Truth boundary:
 * - Eligibility is a pure function of recorded skills, certifications and load.
 * - Expired certifications exclude the candidate.
 * - Missing required skills produce explicit reason codes.
 * - No predictive ranking or autonomous assignment.
 */

function isExpired(cert, now) {
  if (!cert || !cert.expiresAt) return false;
  const exp = new Date(cert.expiresAt).getTime();
  const n = new Date(now || Date.now()).getTime();
  if (!Number.isFinite(exp) || !Number.isFinite(n)) return true; // fail-closed on bad dates
  return exp <= n;
}

/**
 * @param {object} technician
 * @param {string[]} requiredSkills - skill codes required by the work type
 * @param {object} [opts]
 * @param {Date|string|number} [opts.now]
 * @returns {{ eligible: boolean, reasons: string[], matchedSkills: string[], missingSkills: string[], expiredCerts: string[] }}
 */
function evaluateEligibility(technician, requiredSkills, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const required = Array.isArray(requiredSkills) ? requiredSkills.map(String) : [];
  const techSkills = Array.isArray(technician && technician.skills)
    ? technician.skills.map(s => (typeof s === 'string' ? s : String(s && s.code || s && s.id || ''))).filter(Boolean)
    : [];
  const certs = Array.isArray(technician && technician.certifications) ? technician.certifications : [];

  const matchedSkills = required.filter(r => techSkills.includes(r));
  const missingSkills = required.filter(r => !techSkills.includes(r));
  const expiredCerts = certs
    .filter(c => isExpired(c, now))
    .map(c => String(c.code || c.id || c.name || 'UNKNOWN_CERT'));

  const reasons = [];
  if (missingSkills.length) {
    reasons.push(`MISSING_SKILL:${missingSkills.join(',')}`);
  }
  if (expiredCerts.length) {
    reasons.push(`CERT_EXPIRED:${expiredCerts.join(',')}`);
  }
  if (technician && technician.available === false) {
    reasons.push('UNAVAILABLE');
  }
  if (technician && Number(technician.activeWorkload) > Number(opts.maxWorkload || Infinity)) {
    reasons.push('WORKLOAD_EXCEEDED');
  }

  const eligible = reasons.length === 0 && (required.length === 0 || matchedSkills.length === required.length);

  return Object.freeze({
    eligible,
    reasons: Object.freeze(reasons.slice()),
    matchedSkills: Object.freeze(matchedSkills.slice()),
    missingSkills: Object.freeze(missingSkills.slice()),
    expiredCerts: Object.freeze(expiredCerts.slice())
  });
}

/**
 * Filter and annotate a list of candidates.
 * Returns only eligible ones by default; set includeIneligible=true to keep all with reasons.
 */
function filterEligibleCandidates(candidates, requiredSkills, opts) {
  opts = opts || {};
  const list = Array.isArray(candidates) ? candidates : [];
  return list.map(c => {
    const result = evaluateEligibility(c, requiredSkills, opts);
    return Object.freeze({
      ...c,
      eligibility: result,
      eligible: result.eligible,
      reasonCodes: result.reasons
    });
  }).filter(c => opts.includeIneligible === true || c.eligible);
}

module.exports = {
  evaluateEligibility,
  filterEligibleCandidates,
  isExpired
};
