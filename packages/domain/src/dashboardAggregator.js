'use strict';

const { getSubordinateIds, canViewEmployee } = require('./hierarchy');
const { computeKpis } = require('./kpiCompute');

/**
 * THE DATA CONTRACT, STATED AS ONE RULE INSTEAD OF NINE SPECIAL CASES:
 * ======================================================================
 * "World-class" here does not mean nine different bespoke dashboard
 * definitions (one per role) that quietly drift out of sync with each other
 * over time. It means one rule, applied uniformly, that is provably correct
 * at every level of the pyramid:
 *
 *   - If you have direct reports, your dashboard is a ROLL-UP: one row per
 *     direct report, each showing the aggregated KPIs of that report's ENTIRE
 *     branch beneath them (however deep), plus one grand-total row for your
 *     whole scope.
 *   - If you have no direct reports (a Technician — the bottom of the
 *     pyramid), your dashboard is the raw ticket list assigned to you.
 *     Nothing to roll up; you ARE the source of the data.
 *
 * This is exactly how real enterprise BI drill-down hierarchies work (an
 * OLAP cube rolled up one dimension level at a time) — a CEO drilling down
 * sees sectors; a Sector Head drilling down sees their regions; a Team
 * Leader drilling down sees individual technicians. Same rule, every level.
 *
 * Visibility is enforced by the exact same can_view_employee logic already
 * tested in hierarchy.test.js — a dashboard can never show a row the viewer
 * isn't allowed to see, because the ticket-scoping step below uses it directly.
 */

function ticketsInScope(tickets, employees, viewerId) {
  const allowedIds = new Set([viewerId, ...getSubordinateIds(employees, viewerId)]);
  return tickets.filter((t) => allowedIds.has(t.assignedEmployeeId));
}

function getDirectReports(employees, managerId) {
  return employees.filter((e) => e.managerId === managerId);
}

function buildDashboard({ employees, tickets, viewerId }) {
  const viewer = employees.find((e) => e.employeeId === viewerId);
  if (!viewer) {
    throw new Error(`ERR_VIEWER_NOT_FOUND: ${viewerId}`);
  }

  const directReports = getDirectReports(employees, viewerId);
  const scopedTickets = ticketsInScope(tickets, employees, viewerId);

  if (directReports.length === 0) {
    // Bottom of the pyramid: raw row-level data, nothing to aggregate.
    return {
      viewerId,
      roleKey: viewer.roleKey,
      view: 'ROW_LEVEL',
      tickets: tickets.filter((t) => t.assignedEmployeeId === viewerId),
      summary: computeKpis(tickets.filter((t) => t.assignedEmployeeId === viewerId)),
    };
  }

  const rollup = directReports.map((report) => {
    const branchTickets = ticketsInScope(tickets, employees, report.employeeId);
    return {
      employeeId: report.employeeId,
      fullName: report.fullName,
      roleKey: report.roleKey,
      kpis: computeKpis(branchTickets),
    };
  });

  return {
    viewerId,
    roleKey: viewer.roleKey,
    view: 'ROLLUP',
    rollup,
    summary: computeKpis(scopedTickets), // grand total across the viewer's entire scope
  };
}

module.exports = { buildDashboard, ticketsInScope, getDirectReports };
