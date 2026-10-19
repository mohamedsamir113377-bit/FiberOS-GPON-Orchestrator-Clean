'use strict';

/**
 * Exception-first board signals (Feature F)
 *
 * Truth boundary:
 * - Pure aggregation of caller-supplied facts.
 * - Uses the same reason-code style as skillsEligibility / decisionSafety.
 * - Does not query the database or auto-assign.
 */

/**
 * @param {object} ticket
 * @param {object} [ctx]
 * @returns {{ needsAttention: boolean, reasons: string[], severity: string }}
 */
function assessTicketExceptions(ticket, ctx) {
  ticket = ticket || {};
  ctx = ctx || {};
  const reasons = [];
  let severity = 'NONE';

  if (ticket.openConflict === true || (Array.isArray(ticket.conflicts) && ticket.conflicts.some(c => c.status === 'OPEN'))) {
    reasons.push('OPEN_CONFLICT');
    severity = 'HIGH';
  }
  if (ticket.evidenceStale === true) {
    reasons.push('EVIDENCE_STALE');
    if (severity !== 'HIGH') severity = 'MEDIUM';
  }
  if (ticket.slaBreached === true) {
    reasons.push('SLA_BREACHED');
    severity = 'HIGH';
  }
  if (ticket.missingSkills === true || (Array.isArray(ticket.missingSkillCodes) && ticket.missingSkillCodes.length)) {
    reasons.push('MISSING_SKILLS');
    if (severity === 'NONE') severity = 'MEDIUM';
  }
  if (ticket.simulatedEvidenceOnly === true) {
    reasons.push('SIMULATED_EVIDENCE_ONLY');
    severity = 'HIGH';
  }
  if (ticket.geoOutOfRange === true) {
    reasons.push('GEO_OUT_OF_RANGE');
    if (severity === 'NONE') severity = 'MEDIUM';
  }

  // Live snapshot: status only — never invents SLA/conflict facts
  const st = String(ticket.status || ticket.ticketStatus || '').toLowerCase();
  if (st && !['completed', 'cancelled', 'rejected', 'closed'].includes(st)) {
    if (reasons.length === 0) {
      reasons.push('OPEN_ACTIVE_STATUS');
      severity = 'LOW';
    }
  }

  return Object.freeze({
    needsAttention: reasons.length > 0,
    reasons: Object.freeze(reasons.slice()),
    severity,
    ticketId: ticket.ticketId || ticket.id || null,
    status: st || null
  });
}

/**
 * Rank a list of tickets by severity then reason count.
 */
function rankExceptionBoard(tickets, ctx) {
  const list = Array.isArray(tickets) ? tickets : [];
  const scored = list.map(t => {
    const assessment = assessTicketExceptions(t, ctx);
    const severityScore = assessment.severity === 'HIGH' ? 300 : assessment.severity === 'MEDIUM' ? 100 : assessment.severity === 'LOW' ? 10 : 0;
    return Object.freeze({
      ...assessment,
      score: severityScore + assessment.reasons.length
    });
  });
  return scored
    .filter(x => x.needsAttention)
    .sort((a, b) => b.score - a.score || String(a.ticketId || '').localeCompare(String(b.ticketId || '')));
}

module.exports = { assessTicketExceptions, rankExceptionBoard };
