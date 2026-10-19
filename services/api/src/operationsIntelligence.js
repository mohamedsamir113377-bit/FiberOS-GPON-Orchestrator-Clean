'use strict';

const { withPrincipal } = require('../../../packages/db/src/session');

const PAYMENT_EDGES = Object.freeze({
  submitted: Object.freeze(['approved', 'rejected']),
  approved: Object.freeze(['paid']),
  rejected: Object.freeze([]),
  paid: Object.freeze([])
});

const PAYMENT_AUTHORITY_ROLES = Object.freeze(['cfo','exec','ops_manager','sysadmin']);

function assertPaymentAuthority(principal) {
  const role = principal && typeof principal.role === 'string' ? principal.role.trim() : '';
  if (!PAYMENT_AUTHORITY_ROLES.includes(role)) {
    const e = new Error('PAYMENT_AUTHORITY_FORBIDDEN'); e.statusCode = 403; e.code = 'PAYMENT_AUTHORITY_FORBIDDEN'; throw e;
  }
}

function dbRequired(db) {
  if (!db || !db.configured || !db.pool) {
    const e = new Error('DATABASE_REQUIRED'); e.statusCode = 503; throw e;
  }
}
async function tenant(client) {
  const r = await client.query(
    'select tenant_id from user_preferences where user_id = auth.uid() limit 1'
  );
  if (!r.rows[0]) { const e = new Error('TENANT_CONTEXT_REQUIRED'); e.statusCode = 403; throw e; }
  return r.rows[0].tenant_id;
}
function textRequired(v, name) {
  if (typeof v !== 'string' || !v.trim()) {
    const e = new TypeError(name + ' is required'); e.statusCode = 400; throw e;
  }
  return v.trim();
}
function assertPaymentTransition(from, to) {
  if (!PAYMENT_EDGES[from] || !PAYMENT_EDGES[from].includes(to)) {
    const e = new Error('PAYMENT_TRANSITION_FORBIDDEN'); e.statusCode = 409; throw e;
  }
}

async function startPaymentCycle(db, principal, body) {
  dbRequired(db); assertPaymentAuthority(principal); body = body || {};
  if (!body.invoiceId) { const e = new TypeError('invoiceId is required'); e.statusCode = 400; throw e; }
  return withPrincipal(db, principal, async client => {
    const tid = await tenant(client);
    try {
      // Do not pre-lock here. SELECT ... FOR UPDATE is an UPDATE-class RLS
      // operation and the constrained app role intentionally has no generic
      // invoice UPDATE policy. The database authority function below performs
      // the authoritative tenant-scoped row lock and lifecycle check.
      const inv = await client.query(
        `select id, status from invoices where id=$1::uuid and tenant_id=$2`,
        [body.invoiceId, tid]
      );
      if (!inv.rows[0]) { const e = new Error('INVOICE_NOT_FOUND'); e.statusCode = 404; throw e; }
      return await client.query(
        `select * from fiberos_start_payment_cycle($1::uuid,$2)`,
        [body.invoiceId, body.evidenceReference || null]
      ).then(r => r.rows[0]);
    } catch (e) {
      throw e;
    }
  });
}

async function transitionPaymentCycle(db, principal, cycleId, body) {
  dbRequired(db); assertPaymentAuthority(principal); body = body || {};
  const to = textRequired(body.toState, 'toState');
  if (!PAYMENT_EDGES.submitted.concat('paid').includes(to)) {
    const e = new TypeError('unsupported payment state'); e.statusCode = 400; throw e;
  }
  return withPrincipal(db, principal, async client => {
    const tid = await tenant(client);
    try {
      // The database authority function owns the tenant-scoped row lock,
      // lifecycle transition, and state validation. Do not pre-lock through
      // the constrained app role; it intentionally has no generic table
      // privilege on payment_cycles.
      if (to === 'rejected') textRequired(body.rejectionReason, 'rejectionReason');
      if (to === 'paid') textRequired(body.evidenceReference, 'evidenceReference');
      const result = await client.query(
        `select * from fiberos_transition_payment_cycle($1::uuid,$2,$3,$4)`,
        [cycleId, to, body.rejectionReason || null, body.evidenceReference || null]
      );
      const row = result.rows[0];
      if (!row) { const e = new Error('PAYMENT_TRANSITION_NOT_RETURNED'); e.statusCode = 500; throw e; }
      return {
        id: row.id,
        invoiceId: row.invoice_id,
        fromState: row.from_state,
        toState: row.to_state
      };
    } catch (e) {
      throw e;
    }
  });
}

async function openReworkCase(db, principal, body) {
  dbRequired(db); body = body || {};
  const caseId = textRequired(body.caseId, 'caseId');
  const category = textRequired(body.rootCauseCategory, 'rootCauseCategory');
  const evidence = textRequired(body.evidenceReference, 'evidenceReference');
  return withPrincipal(db, principal, async client => {
    const tid = await tenant(client);
    try {
      const r = await client.query(
        `select * from fiberos_open_rework_case($1,$2::uuid,$3,$4)`,
        [caseId, body.ticketId || null, category, evidence]
      );
      return r.rows[0];
    } catch (e) {
      throw e;
    }
  });
}

async function closeReworkCase(db, principal, caseId, body) {
  dbRequired(db); body = body || {};
  const evidence = textRequired(body.evidenceReference, 'evidenceReference');
  const resolution = textRequired(body.resolutionAction, 'resolutionAction');
  return withPrincipal(db, principal, async client => {
    // The database authority function owns tenant derivation, role
    // authorization, current-state lookup, row locking, and the close.
    // Do not pre-lock rework_cases from the constrained app role.
    let closed;
    try {
      closed = await client.query(
        `select * from fiberos_close_rework_case($1,$2,$3)`,
        [caseId, evidence, resolution]
      );
    } catch (e) {
      if (e && e.code === 'P0002' && /OPEN_REWORK_CASE_NOT_FOUND/i.test(String(e.message || ''))) {
        const err = new Error('OPEN_REWORK_CASE_NOT_FOUND');
        err.code = 'OPEN_REWORK_CASE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      throw e;
    }
    const row = closed.rows[0];
    if (!row) {
      const e = new Error('OPEN_REWORK_CASE_NOT_FOUND');
      e.statusCode = 404;
      e.code = 'OPEN_REWORK_CASE_NOT_FOUND';
      throw e;
    }
    return row;
  });
}

module.exports = { startPaymentCycle, transitionPaymentCycle, openReworkCase, closeReworkCase, PAYMENT_EDGES };
