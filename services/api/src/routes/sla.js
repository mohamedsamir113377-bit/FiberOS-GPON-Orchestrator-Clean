'use strict';
const { withPrincipal } = require('../../../../packages/db/src/session');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');

function auth(principal) {
  const a = requireVerifiedPrincipal(principal, process.env);
  if (!a.ok) return a;
  return requireAnyRole(principal, ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','call_center','technician']);
}
function dbRequired(db) {
  if (!db || !db.configured) {
    const e = new Error('DATABASE_REQUIRED'); e.statusCode = 503; throw e;
  }
}
function json(res, status, body, send) { return send(res, status, body); }

async function tenant(client) {
  const r = await client.query('select tenant_id from user_preferences where user_id=auth.uid() limit 1');
  if (!r.rows[0]) { const e = new Error('TENANT_CONTEXT_REQUIRED'); e.statusCode = 403; throw e; }
  return r.rows[0].tenant_id;
}

async function handleSla(req, res, ctx) {
  const { method, path, principal, db, send } = ctx;
  if (method !== 'GET' || path !== '/v1/operations/sla-command') return null;
  const a = auth(principal); if (!a.ok) return send(res, a.status, a.body);
  try {
    dbRequired(db);
    return await withPrincipal(db, principal, async client => {
      const tid = await tenant(client);
      const summary = await client.query(`
        select
          count(*) filter (where sla_deadline is not null and status not in ('completed','cancelled','rejected','faulty'))::int as open_with_sla,
          count(*) filter (where sla_deadline is not null and status not in ('completed','cancelled','rejected','faulty') and sla_deadline < now())::int as breached_open,
          count(*) filter (where sla_deadline is not null and status not in ('completed','cancelled','rejected','faulty') and sla_deadline >= now() and sla_deadline <= now() + interval '2 hours')::int as due_within_2h,
          count(*) filter (where sla_deadline is not null and closed_at is not null and closed_at <= sla_deadline)::int as completed_within_sla,
          count(*) filter (where sla_deadline is not null and closed_at is not null)::int as completed_with_sla_evidence
        from tickets where tenant_id=$1`, [tid]);
      const buckets = await client.query(`
        select status, count(*)::int as count
        from tickets
        where tenant_id=$1 and sla_deadline is not null and status not in ('completed','cancelled','rejected','faulty')
        group by status order by count desc, status`, [tid]);
      const r = summary.rows[0];
      const denominator = Number(r.completed_with_sla_evidence || 0);
      const compliance = denominator ? (Number(r.completed_within_sla || 0) / denominator) * 100 : null;
      return json(res, 200, {
        ok: true,
        authority: 'DATABASE_BACKED_READ_ONLY',
        syntheticData: false,
        slaPolicy: 'PERSISTED_DEADLINE_ONLY',
        metrics: {
          openWithSla: Number(r.open_with_sla || 0),
          breachedOpen: Number(r.breached_open || 0),
          dueWithin2Hours: Number(r.due_within_2h || 0),
          completedWithSlaEvidence: denominator,
          completedWithinSla: Number(r.completed_within_sla || 0),
          compliancePercent: compliance === null ? null : Number(compliance.toFixed(2))
        },
        openByStatus: buckets.rows,
        limitations: [
          'Tickets without an explicitly persisted sla_deadline are excluded from SLA metrics.',
          'No deadline is inferred from ticket type, customer, or UI defaults.',
          'This endpoint does not autonomously escalate, reassign, or close tickets.'
        ]
      }, send);
    });
  } catch (e) {
    if (e.statusCode) return json(res, e.statusCode, { ok: false, error: e.code || 'REQUEST_REJECTED' }, send);
    return json(res, 500, { ok: false, error: 'DB_ERROR' }, send);
  }
}
module.exports = { handleSla };
