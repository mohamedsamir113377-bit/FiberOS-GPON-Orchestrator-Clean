'use strict';
const { rejectClientTenantAuthority, assertPrincipalForWrite } = require('../tenantBoundary');
const { step, validatePath, validateCanonicalHappyPath, illegalSamples } =
  require('../../../../packages/domain/src/ticketLifecycle');
const { normalizeStatus } = require('../../../../packages/domain/src/ticketStateMachine');
const { withPrincipal } = require('../../../../packages/db/src/session');

/**
 * State-Authority Trust Boundary (Alpha 43).
 *
 * Previously: the server trusted `body.from` as the starting state, ran the
 * state-machine check against it, and only used a WHERE status = clientFrom
 * clause as a race-condition guard on the write. That guard stops a client
 * from writing on top of a state it *guessed wrong*, but it never made the
 * client-declared `from` an authoritative input — a caller who correctly
 * guessed/observed the real current state could still submit whatever `from`
 * they wanted for the *legality* check itself.
 *
 * Now: for any request with a ticketId, `from` is never taken from the
 * client. The database authority function owns current-state lookup, tenant
 * scope, role authorization, row locking, and compare-and-update. The client
 * may only request a `to`. Any client-sent `from`/`fromStatus` is accepted
 * for anomaly logging only and never influences authorization.
 *
 * Dry-run (no ticketId) has no real ticket to anchor against, so it remains
 * an advisory, non-authoritative validation helper — clearly labeled as such
 * in the response so it can't be mistaken for a persisted decision.
 */
async function handleLifecycleStep(body, principal, db) {
  body = body || {};
  const tenantGate = rejectClientTenantAuthority(body);
  if (!tenantGate.ok) return tenantGate;
  const prinGate = assertPrincipalForWrite(principal);
  if (!prinGate.ok) return prinGate;
  const ticketId = body.ticketId || body.id;
  const to = body.to || body.toStatus;
  const clientDeclaredFrom = body.from || body.fromStatus || null;

  if (!to) {
    return { status: 400, body: { ok: false, error: 'TO_REQUIRED' } };
  }

  if (!ticketId) {
    // No real ticket to anchor to — advisory-only, explicitly non-authoritative.
    if (!clientDeclaredFrom) {
      return { status: 400, body: { ok: false, error: 'FROM_TO_REQUIRED_FOR_DRY_RUN' } };
    }
    const checked = step(clientDeclaredFrom, to, { role: principal && principal.role });
    return {
      status: 200,
      body: {
        ok: checked.ok,
        dryRun: true,
        authority: 'ADVISORY_ONLY_NOT_PERSISTED',
        step: checked,
        note: 'No ticketId — this validates a hypothetical transition only. It is not a decision about any real ticket and carries no authorization weight.'
      }
    };
  }

  if (!db || !db.configured) {
    // No database attached at all: we cannot fetch the real current state.
    // We refuse to silently treat the client's claim as truth.
    if (!clientDeclaredFrom) {
      return { status: 409, body: { ok: false, error: 'DATABASE_REQUIRED_FOR_AUTHORITATIVE_STATE' } };
    }
    const checked = step(clientDeclaredFrom, to, { role: principal && principal.role });
    return {
      status: 202,
      body: {
        ok: checked.ok,
        accepted: false,
        persisted: false,
        authority: 'CLIENT_DECLARED_UNVERIFIED_NO_DB',
        step: checked,
        note: 'Validated against a CLIENT-DECLARED fromStatus because no database is configured. Set DATABASE_URL to enforce DB-authoritative state before treating this as a real decision.'
      }
    };
  }

  try {
    const result = await withPrincipal(db, principal, async function (client) {
      const transitioned = await client.query(
        `select fiberos_transition_ticket($1::uuid, $2::text) as transition`,
        [ticketId, normalizeStatus(to)]
      );
      const transition = transitioned.rows[0] && transitioned.rows[0].transition;
      if (!transition) {
        const err = new Error('TICKET_TRANSITION_EMPTY');
        err.code = 'TICKET_TRANSITION_EMPTY';
        throw err;
      }
      return { ticket: { id: ticketId, status: transition.to }, transition: transition };
    });

    const clientFromMismatch =
      clientDeclaredFrom && normalizeStatus(clientDeclaredFrom) !== result.transition.from
        ? { declared: normalizeStatus(clientDeclaredFrom), actual: result.transition.from }
        : null;

    return {
      status: 200,
      body: {
        ok: true,
        persisted: true,
        authority: 'DB_AUTHORITATIVE',
        ticket: result.ticket,
        step: Object.assign({ ok: true, authority: 'DB_AUTHORITATIVE' }, result.transition),
        transition: result.transition,
        clientFromIgnored: clientFromMismatch || undefined
      }
    };
  } catch (e) {
    if (e.code === 'TICKET_NOT_FOUND') {
      return { status: 404, body: { ok: false, error: 'TICKET_NOT_FOUND' } };
    }
    if (e.code === 'TICKET_NOT_UPDATED') {
      return { status: 409, body: { ok: false, error: 'TICKET_NOT_UPDATED', hint: 'concurrent update — retry' } };
    }
    const dbError = String(e.message || e);
    if (dbError === 'TRANSITION_REJECTED') return { status: 409, body: { ok: false, error: 'TRANSITION_REJECTED' } };
    if (dbError === 'TRANSITION_INPUT_REQUIRED') return { status: 400, body: { ok: false, error: 'TRANSITION_INPUT_REQUIRED' } };
    if (dbError === 'TENANT_CONTEXT_REQUIRED') return { status: 403, body: { ok: false, error: 'TENANT_CONTEXT_REQUIRED' } };
    if (dbError === 'ROLE_REQUIRED_FOR_TRANSITION') return { status: 403, body: { ok: false, error: 'ROLE_REQUIRED_FOR_TRANSITION' } };
    return { status: 500, body: { ok: false, error: 'DB_ERROR' } };
  }
}

function handleLifecycleSelfTest() {
  const happy = validateCanonicalHappyPath({ role: 'ops_manager' });
  const illegal = illegalSamples();
  const allIllegalFail = illegal.every(function (x) { return !x.ok; });
  return {
    status: 200,
    body: {
      ok: happy.ok && allIllegalFail,
      happyPath: happy,
      illegalAllRejected: allIllegalFail,
      illegal: illegal
    }
  };
}

module.exports = { handleLifecycleStep, handleLifecycleSelfTest, validatePath };
