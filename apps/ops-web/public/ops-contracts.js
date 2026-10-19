(function attachOpsContracts(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FiberOSOpsContracts = api;
})(typeof window === 'undefined' ? null : window, function createOpsContracts() {
  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function list(value) { return Array.isArray(value) ? value : []; }
  function metric(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
  }
  function integer(value) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  function text(value) { return typeof value === 'string' ? value : ''; }

  function crisisResponse(value) {
    const body = object(value);
    return Object.freeze({
      mode: metric(body.mode),
      affectedCustomers: metric(body.affectedCustomers),
      incidents: list(body.incidents).filter((row) => row && typeof row === 'object' && !Array.isArray(row)).map((row) => Object.freeze({
        severity: text(row.severity),
        title: text(row.title),
        state: text(row.state),
        affected_customers: metric(row.affected_customers)
      }))
    });
  }

  function executiveResponse(value) {
    const body = object(value);
    const financial = object(body.financial);
    const operations = object(body.operations);
    return Object.freeze({
      issuedAmountMinor: integer(financial.issuedAmountMinor),
      openTickets: integer(operations.openTickets)
    });
  }

  function assuranceResponse(value) {
    const body = object(value);
    const summary = object(body.summary);
    const counts = object(summary.counts);
    const capabilities = list(body.capabilities).filter((row) => row && typeof row === 'object' && !Array.isArray(row)).map((row) => Object.freeze({
      id: text(row.id),
      name: text(row.name),
      notes: text(row.notes),
      status: text(row.status),
      serverSurfaces: list(row.serverSurfaces).filter((item) => typeof item === 'string')
    }));
    return Object.freeze({
      summary: Object.freeze({ total: integer(summary.total), counts: Object.freeze({ REAL: integer(counts.REAL) }) }),
      capabilities: Object.freeze(capabilities)
    });
  }

  function fleetRows(value) {
    return list(object(value).fleet).filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }

  function snapshotTickets(value) {
    const body = object(value);
    const snapshot = object(body.snapshot);
    const tickets = Array.isArray(snapshot.tickets) ? snapshot.tickets : body.tickets;
    return list(tickets).filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }

  return Object.freeze({ crisisResponse, executiveResponse, assuranceResponse, fleetRows, snapshotTickets });
});
