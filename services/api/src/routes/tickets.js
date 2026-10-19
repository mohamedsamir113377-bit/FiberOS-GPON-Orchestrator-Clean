'use strict';
const { withPrincipal } = require('../../../../packages/db/src/session');
const { loadImmutablePermissionContext, assertTechnicianMutationAllowed } = require('../../../../packages/security/src/permissionContext');

/**
 * Ticket transition service logic.
 * The database authority function owns current-state lookup, tenant scope,
 * role authorization, row locking, and compare-and-update concurrency.
 * The API must not duplicate lifecycle decisions against a stale row.
 */
async function handleTicketTransition(body, principal, db) {
  body = body || {};
  const ticketId = body.ticketId || body.id;
  const requestedTo = body.to || body.toStatus;
  const clientDeclaredFrom = body.from || body.fromStatus || null;

  if (!ticketId) return { status: 400, body: { ok: false, error: 'TICKET_ID_REQUIRED' } };
  if (!requestedTo) return { status: 400, body: { ok: false, error: 'TO_REQUIRED' } };

  if (!db || !db.configured) {
    return {
      status: 503,
      body: {
        ok: false,
        error: 'DATABASE_REQUIRED_FOR_AUTHORITATIVE_TRANSITION',
        authority: 'NO_DB_NO_DECISION',
        note: 'A persisted ticket transition requires DB-authoritative state and role authorization.'
      }
    };
  }

  try {
    const result = await withPrincipal(db, principal, async function (client) {
      const context = await loadImmutablePermissionContext(client, principal);
      const ticket = await client.query(`select tenant_id, technician_id from tickets where id=$1::uuid`, [ticketId]);
      if (!ticket.rows[0]) throw Object.assign(new Error('TICKET_NOT_FOUND'), { code: 'TICKET_NOT_FOUND' });
      const scope = assertTechnicianMutationAllowed(context, { tenantId: ticket.rows[0].tenant_id, ticketTechnicianId: ticket.rows[0].technician_id });
      if (!scope.ok) throw Object.assign(new Error(scope.error), { code: scope.error });
      const transitioned = await client.query(
        `select fiberos_transition_ticket($1::uuid, $2::text) as transition`,
        [ticketId, requestedTo]
      );
      const transition = transitioned.rows[0] && transitioned.rows[0].transition;
      if (!transition) {
        const err = new Error('TICKET_TRANSITION_EMPTY');
        err.code = 'TICKET_TRANSITION_EMPTY';
        throw err;
      }
      return transition;
    });

    const mismatch = clientDeclaredFrom && String(clientDeclaredFrom).toLowerCase() !== String(result.from).toLowerCase()
      ? { declared: clientDeclaredFrom, actual: result.from } : undefined;

    return {
      status: 200,
      body: {
        ok: true,
        persisted: true,
        authority: 'DB_AUTHORITATIVE',
        ticket: { id: ticketId, status: result.to },
        transition: result,
        clientFromIgnored: mismatch
      }
    };
  } catch (e) {
    if (e.code === 'VERIFIED_PRINCIPAL_REQUIRED' || e.message === 'VERIFIED_PRINCIPAL_REQUIRED') {
      return { status: 401, body: { ok: false, error: 'VERIFIED_PRINCIPAL_REQUIRED' } };
    }
    if (e.code === 'TICKET_NOT_FOUND') return { status: 404, body: { ok: false, error: 'TICKET_NOT_FOUND' } };
    if (e.code === 'TRANSITION_REJECTED') return { status: 409, body: { ok: false, error: 'TRANSITION_REJECTED' } };
    if (e.code === 'TICKET_NOT_UPDATED') return { status: 409, body: { ok: false, error: 'TICKET_NOT_UPDATED' } };
    if (/TECHNICIAN_MUTATION_SCOPE_REQUIRED|SUPERVISOR_TECHNICIAN_SCOPE_REQUIRED|TENANT_SCOPE_REQUIRED/.test(String(e.code || ''))) return { status: 403, body: { ok: false, error: e.code } };
    const dbError = String(e.message || e);
    if (dbError === 'TRANSITION_REJECTED') return { status: 409, body: { ok: false, error: 'TRANSITION_REJECTED' } };
    if (dbError === 'TENANT_CONTEXT_REQUIRED') return { status: 403, body: { ok: false, error: 'TENANT_CONTEXT_REQUIRED' } };
    if (dbError === 'ROLE_REQUIRED_FOR_TRANSITION') return { status: 403, body: { ok: false, error: 'ROLE_REQUIRED_FOR_TRANSITION' } };
    if (dbError === 'TRANSITION_INPUT_REQUIRED') return { status: 400, body: { ok: false, error: 'TRANSITION_INPUT_REQUIRED' } };
    return { status: 500, body: { ok: false, error: 'DB_ERROR' } };
  }
}

module.exports = { handleTicketTransition };
