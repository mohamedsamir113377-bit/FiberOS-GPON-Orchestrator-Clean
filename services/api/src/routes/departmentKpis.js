'use strict';

const { withPrincipal } = require('../../../../packages/db/src/session');
const { resolveDepartmentKpis, computeDepartmentKpis } = require('../../../../packages/operations-kpi/src');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');

const DEPARTMENT_KPI_SCOPE_CAPABILITY = 'department_kpi:read';

const TECHNICIAN_ROLES_FOR_TRAVEL_KPI = Object.freeze({
  FIELD: Object.freeze(['technician','team_lead','fiber_splicer','welder','cable_worker']),
  NETWORK_OPERATIONS: Object.freeze(['dispatcher','qc'])
});

function technicianRolesForTravelKpi(department) {
  return TECHNICIAN_ROLES_FOR_TRAVEL_KPI[department] || null;
}

async function departmentKpiScopeAllowed(client, department) {
  const result = await client.query(
    `select public.fiberos_enterprise_department_scope_allowed($1, 'department_kpi:read') as allowed`,
    [department]
  );
  return result.rows[0]?.allowed === true;
}
function dbRequired(db) {
  if (!db || !db.configured) {
    const e = new Error('DATABASE_REQUIRED');
    e.statusCode = 503;
    throw e;
  }
}

function sendJson(res, send, status, body) {
  return send(res, status, body);
}

async function tenant(client) {
  const result = await client.query(
    'select tenant_id from user_preferences where user_id=auth.uid() limit 1'
  );
  if (!result.rows[0]) {
    const e = new Error('TENANT_CONTEXT_REQUIRED');
    e.statusCode = 403;
    throw e;
  }
  return result.rows[0].tenant_id;
}

function parseRequest(req) {
  const url = new URL(req.url || '/', 'http://fiberos.local');
  const rawDepartment = String(url.pathname.split('/').pop() || '').trim().toUpperCase();
  const department = rawDepartment;
  const periodHours = Number(url.searchParams.get('periodHours') || 24);

  if (!Number.isInteger(periodHours) || periodHours < 1 || periodHours > 720) {
    const e = new Error('KPI_PERIOD_HOURS_INVALID');
    e.statusCode = 400;
    throw e;
  }

  return { department, periodHours };
}

async function handleDepartmentKpis(req, res, ctx) {
  const { method, path, principal, db, send } = ctx;
  if (method !== 'GET' || !/^\/v1\/operations\/department-kpis\/(NETWORK_OPERATIONS|CONSTRUCTION|FIELD|CALL_CENTER|WAREHOUSE|ENGINEERING)$/.test(path)) {
    return null;
  }

  const verified = requireVerifiedPrincipal(principal, process.env);
  if (!verified.ok) return send(res, verified.status, verified.body);

  const authorized = requireAnyRole(
    principal,
    ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc']
  );
  if (!authorized.ok) return send(res, authorized.status, authorized.body);

  try {
    dbRequired(db);
    const { department, periodHours } = parseRequest(req);
    const resolved = resolveDepartmentKpis(department);
    const movementRoles = technicianRolesForTravelKpi(department);

    return await withPrincipal(db, principal, async (client) => {
      const tid = await tenant(client);
      const tenantWide = requireAnyRole(principal, ['exec','sysadmin']).ok;
      if (!tenantWide && !(await departmentKpiScopeAllowed(client, department))) {
        return sendJson(res, send, 403, { ok: false, error: 'DEPARTMENT_SCOPE_REQUIRED', department });
      }

      // The current KPI source queries are tenant-scoped, not department-partitioned.
      // A department grant alone must never expose tenant-wide aggregates. Keep the
      // authorized non-executive path closed until each KPI source has a verified
      // department attribution/filter contract. Executive/admin tenant-wide access
      // remains explicit above; no query below runs for a merely department-scoped user.
      if (!tenantWide) {
        return sendJson(res, send, 503, {
          ok: false,
          error: 'DEPARTMENT_KPI_DATA_SCOPE_UNAVAILABLE',
          department,
          authority: 'FAIL_CLOSED_UNTIL_DEPARTMENT_ATTRIBUTION_IS_VERIFIED'
        });
      }

      const [
        ticketResult,
        openResult,
        positionResult,
        invoiceResult,
        reelResult,
        splitterResult,
        marginResult
      ] = await Promise.all([
        client.query(
          `select
             status,
             created_at as "createdAt",
             closed_at as "closedAt",
             sla_deadline as "slaDeadline",
             reopen_tracking_observed as "reopenTrackingObserved",
             reopened_at as "reopenedAt"
           from public.tickets
           where tenant_id=$1
             and created_at >= now() - make_interval(hours => $2::int)
           order by created_at asc, id asc`,
          [tid, periodHours]
        ),
        client.query(
          `select count(*)::int as open_backlog
           from public.tickets
           where tenant_id=$1
             and status in ('pending','in_progress','awaiting_evidence','manager_review')`,
          [tid]
        ),
        movementRoles
          ? client.query(
              `select
                 p.technician_id as "technicianId",
                 p.captured_at as "capturedAt",
                 p.speed_mps as "speedMps"
               from public.technician_positions p
               where p.tenant_id=$1
                 and p.captured_at >= now() - make_interval(hours => $2::int)
                 and exists (
                   select 1
                   from public.technician_role_assignments tra
                   where tra.tenant_id=$1
                     and tra.technician_id=p.technician_id
                     and tra.role_code = any($3::text[])
                     and tra.valid_from <= p.captured_at
                     and (tra.valid_until is null or tra.valid_until >= p.captured_at)
                 )
               order by p.technician_id, p.captured_at asc, p.id asc`,
              [tid, periodHours, movementRoles]
            )
          : Promise.resolve({ rows: [] }),
        client.query(
          `select
             ticket_id as "ticketId",
             currency,
             amount_minor as "amountMinor",
             status
           from public.invoices
           where tenant_id=$1
             and ticket_id is not null
             and status in ('issued','paid','partially_paid','overdue')
             and created_at >= now() - make_interval(hours => $2::int)`,
          [tid, periodHours]
        ),
        client.query(
          `select
             reel_id as "reelId",
             sku,
             warehouse_id as "warehouseId",
             delta_millimeters as "deltaMillimeters"
           from public.material_reel_ledger
           where tenant_id=$1
           order by reel_id, created_at asc, id asc`,
          [tid]
        ),
        client.query(
          `select
             count(*) filter (where port_type='splitter_leg' and status='used')::int as used,
             count(*) filter (where port_type='splitter_leg')::int as total,
             count(*) filter (where port_type='splitter_leg' and status='reserved')::int as reserved
           from public.network_ports
           where tenant_id=$1`,
          [tid]
        ),
        client.query(
          `select distinct on (a.service_path_version_id)
             a.service_path_version_id as "servicePathVersionId",
             a.path_bound as "pathBound",
             a.current_rx_dbm as "currentRxDbm",
             a.expected_rx_dbm as "expectedRxDbm",
             om.source
           from public.network_optical_assurance_assessments a
           join public.optical_measurements om
             on om.id=a.current_measurement_id
            and om.tenant_id=a.tenant_id
           where a.tenant_id=$1
             and a.path_bound=true
             and a.service_path_version_id is not null
             and om.source in ('field_reading','nms_poll')
             and a.current_rx_dbm is not null
             and a.expected_rx_dbm is not null
           order by a.service_path_version_id, a.created_at desc, a.id desc`,
          [tid]
        )
      ]);

      const metrics = computeDepartmentKpis({
        periodTickets: ticketResult.rows,
        openBacklog: Number(openResult.rows[0]?.open_backlog || 0),
        positions: positionResult.rows,
        invoices: invoiceResult.rows,
        reelLedger: reelResult.rows,
        splitterLegs: {
          used: Number(splitterResult.rows[0]?.used || 0),
          total: Number(splitterResult.rows[0]?.total || 0),
          reserved: Number(splitterResult.rows[0]?.reserved || 0)
        },
        opticalMargins: marginResult.rows
      });

      const selected = {};
      for (const kpiId of resolved.computable) selected[kpiId] = metrics[kpiId];

      return sendJson(res, send, 200, {
        ok: true,
        schema: 'fiberos.department-kpi.v2',
        department,
        periodHours,
        declared: resolved.declared,
        computable: resolved.computable,
        unavailable: resolved.unavailable,
        deferred: resolved.deferred,
        invented: [],
        kpis: selected,
        evidence: {
          ticketRows: ticketResult.rowCount,
          movementRows: positionResult.rowCount,
          billedInvoiceRows: invoiceResult.rowCount,
          reelLedgerRows: reelResult.rowCount,
          splitterLegCount: Number(splitterResult.rows[0]?.total || 0),
          pathBoundOpticalSamples: marginResult.rowCount
        },
        authority: 'DATABASE_BACKED_DEPARTMENT_KPI_V2',
        scopeAuthority: tenantWide ? 'TENANT_WIDE_EXECUTIVE_ADMIN' : 'ACTIVE_POSITION_ENTERPRISE_GRANT_DESCENDANT_DEPARTMENT',
        syntheticData: false,
        inference: false,
        limitations: [
          'First-Time-Fix uses only tickets whose reopen-tracking state was actually observed after migration 144; older unobserved history is excluded.',
          'Technician travel minutes are persisted GPS-observed moving intervals with a bounded 30-minute sample gap; they are not a reconstruction of unobserved travel.',
          'Revenue remains separated by currency in minor units; no cross-currency conversion is performed.',
          'PON optical margin requires a path-bound assurance row linked to a field_reading or nms_poll measurement.',
          'Reel remainder is the exact sum of immutable millimetre ledger deltas and does not infer nominal cable length.',
          'Technician travel uses role assignments only for FIELD and NETWORK_OPERATIONS; department authority for other KPI families is not inferred from technician roles.'
        ]
      });
    });
  } catch (e) {
    if (e.statusCode) return sendJson(res, send, e.statusCode, { ok: false, error: e.code || e.message });
    return sendJson(res, send, 500, { ok: false, error: 'KPI_DB_ERROR' });
  }
}

module.exports = { handleDepartmentKpis, technicianRolesForTravelKpi, departmentKpiScopeAllowed, DEPARTMENT_KPI_SCOPE_CAPABILITY };
