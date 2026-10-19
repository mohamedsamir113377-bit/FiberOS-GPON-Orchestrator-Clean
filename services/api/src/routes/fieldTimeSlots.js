'use strict';

/**
 * Field visit time-slot API — pure validation + DB exclusion constraint.
 * Overlap conflicts surface as 409 CONFLICT.
 */

const { withPrincipal } = require('../../../../packages/db/src/session');
const { rejectClientTenantAuthority, assertPrincipalForWrite } = require('../tenantBoundary');
const {
  validateReservationRequest,
  SLOT_TYPES
} = require('../../../../packages/engineering/src/timeSlotReservation');
const { assertRequestConsumption } = require('../../../../packages/security/src/requestConsumptionGuard');
const {
  rejectClientAuthorityFields,
  assertUuidParam,
  assertTenantOwnsRow
} = require('../../../../packages/security/src/objectAccessGuard');

const ROLES = Object.freeze([
  'dispatcher',
  'ops_manager',
  'area_supervisor',
  'sysadmin',
  'exec',
  'call_center',
  'team_lead'
]);

async function handleFieldTimeSlots(req, res, ctx) {
  const { method, path, principal, db, send, body } = ctx;
  if (!path.startsWith('/v1/field-slots')) return null;

  try {
    const gate = assertPrincipalForWrite(principal);
    if (!gate.ok) return send(res, gate.status || 401, gate.body || { ok: false, error: gate.error });
    const role = principal && principal.role ? String(principal.role) : '';
    if (!ROLES.includes(role)) {
      return send(res, 403, { ok: false, error: 'FORBIDDEN_ROLE' });
    }

    if (method === 'GET' && path === '/v1/field-slots/types') {
      return send(res, 200, { ok: true, slotTypes: SLOT_TYPES.slice() });
    }

    if (method === 'POST' && path === '/v1/field-slots/validate') {
      assertRequestConsumption(body || {});
      const reservation = validateReservationRequest(body || {});
      return send(res, 200, { ok: true, reservation, authority: 'SOURCE_TIME_SLOT_POLICY' });
    }

    if (method === 'POST' && path === '/v1/field-slots/reserve') {
      assertRequestConsumption(body || {});
      const tenantGate = rejectClientTenantAuthority(body || {});
      if (!tenantGate.ok) return send(res, tenantGate.status || 400, tenantGate);
      try { rejectClientAuthorityFields(body || {}, ['installation_job_tenant']); } catch (e) {
        return send(res, e.statusCode || 400, { ok: false, error: e.code, fields: e.fields });
      }
      const reservation = validateReservationRequest(body || {});
      let installationJobId = null;
      if (body && body.installationJobId) {
        try { installationJobId = assertUuidParam(body.installationJobId, 'installationJobId'); }
        catch (e) { return send(res, 400, { ok: false, error: e.code }); }
      }
      if (!db || !db.configured) {
        return send(res, 503, {
          ok: false,
          error: 'DATABASE_REQUIRED',
          reservation,
          note: 'Validation passed; persistence requires PostgreSQL with migration 165'
        });
      }
      try {
        const out = await withPrincipal(db, principal, async (client) => {
          const tidRow = await client.query(
            'select tenant_id from user_preferences where user_id = auth.uid() limit 1'
          );
          if (!tidRow.rows[0]) {
            const e = new Error('TENANT_CONTEXT_REQUIRED');
            e.statusCode = 403;
            throw e;
          }
          const tenantId = tidRow.rows[0].tenant_id;
          if (installationJobId) {
            const job = await client.query(
              'select id, tenant_id, status from installation_jobs where id = $1',
              [installationJobId]
            );
            assertTenantOwnsRow(job.rows[0], tenantId, { notFoundCode: 'INSTALLATION_JOB_NOT_FOUND' });
          }
          // Idempotent replay
          const existing = await client.query(
            `select id, status, starts_at, ends_at, technician_id, slot_type, idempotency_key, installation_job_id
               from field_visit_time_slots
              where tenant_id = $1 and idempotency_key = $2`,
            [tenantId, reservation.idempotencyKey]
          );
          if (existing.rows[0]) {
            return { replay: true, slot: existing.rows[0] };
          }
          const ins = await client.query(
            `insert into field_visit_time_slots (
               tenant_id, technician_id, slot_type, status, starts_at, ends_at,
               work_order_ref, idempotency_key, created_by, installation_job_id
             ) values ($1,$2,$3,'HELD',$4,$5,$6,$7,$8,$9)
             returning id, status, starts_at, ends_at, technician_id, slot_type, idempotency_key, installation_job_id, created_at`,
            [
              tenantId,
              reservation.technicianId,
              reservation.slotType,
              reservation.startsAt,
              reservation.endsAt,
              body && body.workOrderRef ? String(body.workOrderRef).slice(0, 160) : null,
              reservation.idempotencyKey,
              principal.sub || null,
              installationJobId
            ]
          );
          if (installationJobId) {
            await client.query(
              `update installation_jobs set visit_scheduled_at = $2, status = case when status in ('NEW','DRAFT','OPEN') then 'SCHEDULED' else status end, updated_at = now()
                where id = $1 and tenant_id = $3`,
              [installationJobId, reservation.startsAt, tenantId]
            );
          }
          return { replay: false, slot: ins.rows[0] };
        });
        return send(res, out.replay ? 200 : 201, {
          ok: true,
          ...out,
          authority: 'DATABASE_EXCLUDE_CONSTRAINT'
        });
      } catch (e) {
        if (e && (e.code === '23P01' || /exclusion|overlap/i.test(String(e.message)))) {
          return send(res, 409, {
            ok: false,
            error: 'TIME_SLOT_OVERLAP',
            message: 'Technician already has an overlapping HELD/CONFIRMED slot'
          });
        }
        if (e && e.code === '23505') {
          return send(res, 200, { ok: true, replay: true, error: null, note: 'idempotency unique hit' });
        }
        throw e;
      }
    }

    return null;
  } catch (e) {
    const status = e.statusCode || 400;
    return send(res, status, {
      ok: false,
      error: e.code || e.message || 'FIELD_SLOT_ERROR',
      detail: e.minDurationMinutes || e.maxDurationMinutes || e.allowed || null
    });
  }
}

module.exports = { handleFieldTimeSlots };
