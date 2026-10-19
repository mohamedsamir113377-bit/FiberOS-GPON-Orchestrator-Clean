'use strict';

/**
 * Pure computation over a flat array of tickets. Same shape whether it's fed
 * 3 tickets (a technician's own) or 30,000 (the CEO's company-wide scope) —
 * the aggregation function below decides WHICH tickets get handed in here.
 *
 * Ticket shape expected: { ticketStatus, createdAt, closedAt, slaDeadline } —
 * all as epoch-ms numbers for pure-function simplicity here; the real SQL
 * view (0004_dashboard_views.sql) does the same math in Postgres directly on
 * TIMESTAMPTZ columns.
 */
function computeKpis(tickets) {
  const total = tickets.length;
  const completed = tickets.filter((t) => t.ticketStatus === 'COMPLETED');
  const failed = tickets.filter((t) => t.ticketStatus === 'FAILED');
  const backlog = tickets.filter((t) => t.ticketStatus === 'PENDING' || t.ticketStatus === 'ASSIGNED');
  const closed = completed.length + failed.length;

  const onTime = completed.filter((t) => t.closedAt <= t.slaDeadline);
  const slaComplianceRate = completed.length > 0 ? onTime.length / completed.length : null;

  const resolutionMinutesList = completed
    .filter((t) => typeof t.closedAt === 'number' && typeof t.createdAt === 'number')
    .map((t) => (t.closedAt - t.createdAt) / 60000);
  const avgResolutionMinutes =
    resolutionMinutesList.length > 0
      ? resolutionMinutesList.reduce((a, b) => a + b, 0) / resolutionMinutesList.length
      : null;

  const failureRate = closed > 0 ? failed.length / closed : null;

  return {
    ticketVolume: total,
    slaComplianceRate,
    avgResolutionMinutes,
    openBacklog: backlog.length,
    failureRate,
    statusBreakdown: {
      PENDING: tickets.filter((t) => t.ticketStatus === 'PENDING').length,
      ASSIGNED: tickets.filter((t) => t.ticketStatus === 'ASSIGNED').length,
      COMPLETED: completed.length,
      FAILED: failed.length,
    },
  };
}

module.exports = { computeKpis };
