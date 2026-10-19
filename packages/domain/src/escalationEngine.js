'use strict';

const WARNING_RATIO = 0.8; // 80% of the SLA window elapsed with no completion

class EscalationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EscalationError';
  }
}

/**
 * Walks up `hops` managers from startEmployeeId, using the same manager_id
 * tree as server/hierarchy.js. Stops early (never throws) if the chain runs
 * out before `hops` is reached — e.g. escalating 2 levels from someone whose
 * manager is already the CEO correctly lands on the CEO, not an error.
 */
function walkUpManagerChain(employees, startEmployeeId, hops) {
  const byId = new Map(employees.map((e) => [e.employeeId, e]));
  let currentId = startEmployeeId;
  let hopsWalked = 0;
  for (let i = 0; i < hops; i++) {
    const current = byId.get(currentId);
    if (!current || !current.managerId) break; // reached the top (CEO) or an unknown employee
    currentId = current.managerId;
    hopsWalked++;
  }
  return { employeeId: currentId, hopsWalked };
}

/**
 * @param {object} ticket    { ticketStatus, createdAt, slaDeadline, assignedEmployeeId } — epoch ms
 * @param {Array}  employees — same shape as hierarchy.js expects
 * @param {number} nowMs
 *
 * Real rules:
 *  - Closed tickets (COMPLETED/FAILED) never escalate — there's nothing left to chase.
 *  - Below 80% of the SLA window elapsed: normal, no escalation.
 *  - 80%–100% elapsed: WARNING, escalate one level up the assignee's manager chain.
 *  - >=100% elapsed (actual breach): BREACHED, escalate two levels up — a real
 *    breach gets skip-level visibility, not just the immediate manager who may
 *    already know and be stuck.
 *  - An at-risk ticket with no assigned employee yet has nobody to walk a
 *    chain from — this is reported explicitly rather than silently skipped
 *    or guessed at, because it's actually a MORE urgent situation (dispatch
 *    itself failed), not a lesser one.
 */
function evaluateEscalation({ ticket, employees, nowMs }) {
  if (ticket.ticketStatus === 'COMPLETED' || ticket.ticketStatus === 'FAILED') {
    return { escalate: false, level: 'CLOSED', reason: 'TICKET_ALREADY_CLOSED' };
  }

  const totalWindowMs = ticket.slaDeadline - ticket.createdAt;
  if (!(totalWindowMs > 0)) {
    throw new EscalationError('ERR_INVALID_SLA_WINDOW: slaDeadline must be after createdAt');
  }

  const elapsedMs = nowMs - ticket.createdAt;
  const elapsedRatio = elapsedMs / totalWindowMs;

  if (elapsedRatio < WARNING_RATIO) {
    return { escalate: false, level: 'NORMAL', reason: 'WITHIN_SLA_WINDOW', elapsedRatio };
  }

  const level = elapsedRatio >= 1 ? 'BREACHED' : 'WARNING';
  const hops = level === 'BREACHED' ? 2 : 1;

  if (!ticket.assignedEmployeeId) {
    return {
      escalate: true,
      level,
      elapsedRatio,
      escalateToEmployeeId: null,
      reason: 'NO_ASSIGNED_EMPLOYEE_TO_ESCALATE_FROM',
    };
  }

  const { employeeId, hopsWalked } = walkUpManagerChain(employees, ticket.assignedEmployeeId, hops);
  return {
    escalate: true,
    level,
    elapsedRatio,
    escalateToEmployeeId: employeeId,
    hopsRequested: hops,
    hopsWalked,
    reason: hopsWalked < hops ? 'CAPPED_AT_TOP_OF_HIERARCHY' : 'NORMAL_ESCALATION',
  };
}

module.exports = { evaluateEscalation, walkUpManagerChain, EscalationError, WARNING_RATIO };
