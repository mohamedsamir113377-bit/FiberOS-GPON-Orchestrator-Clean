'use strict';

/**
 * Contractor work package lifecycle + commercial measurement reconciliation.
 * Tenant from RLS session only. No payment success without provider evidence.
 */

const { withPrincipal } = require('../../../../packages/db/src/session');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { appendOperationalEvent } = require('../../../../packages/operational-context/src');
const {
  assertWorkPackageTransition,
  eventTypeForTransition,
  assertMeasurementSegregation,
  assertReconciliationRules,
  computeMeasurementAmountMinor,
  detectAllSlaThresholds,
  evaluateSlaClocks,
  normalizeWpStatus
} = require('../../../../packages/productization/src');

const ROLES = Object.freeze([
  'customer',
  'contractor',
  'ops_manager',
  'area_supervisor',
  'exec',
  'cfo',
  'sysadmin',
  'qc'
]);

function assertDb(db) {
  if (!db || !db.configured || !db.pool) {
    throw Object.assign(new Error('DATABASE_REQUIRED'), { statusCode: 503, code: 'DATABASE_REQUIRED' });
  }
}

function rejectClientTenant(body) {
  if (!body || typeof body !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(body, 'tenantId') || Object.prototype.hasOwnProperty.call(body, 'tenant_id')) {
    throw Object.assign(new Error('TENANT_ID_FORBIDDEN'), { statusCode: 400, code: 'TENANT_ID_FORBIDDEN' });
  }
}

function uuid(value, code = 'UUID_INVALID') {
  const v = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    throw Object.assign(new Error(code), { statusCode: 400, code });
  }
  return v;
}

function idempotencyKey(body) {
  rejectClientTenant(body);
  const key = String(body?.idempotencyKey || '').trim();
  if (key.length < 16 || key.length > 160) {
    throw Object.assign(new Error('IDEMPOTENCY_KEY_REQUIRED'), { statusCode: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  return key;
}

async function tenantId(client) {
  const r = await client.query(
    'select tenant_id from user_preferences where user_id = auth.uid() limit 1'
  );
  if (!r.rows[0]?.tenant_id) {
    throw Object.assign(new Error('TENANT_CONTEXT_REQUIRED'), { statusCode: 403, code: 'TENANT_CONTEXT_REQUIRED' });
  }
  return r.rows[0].tenant_id;
}

async function emitCanonicalCommercialEvent(client, {
  tenantId, principal, operation, eventType, aggregateType, aggregateId,
  entityRefs, idempotencyKey, payload, truthBoundary
}) {
  const actorRow = await client.query('select auth.uid() actor_id');
  return appendOperationalEvent(client, {
    tenantId,
    correlationId: String(payload?.correlationId || aggregateType + ':' + aggregateId),
    causationId: payload?.causationId || null,
    actorId: actorRow.rows[0]?.actor_id || principal?.sub || null,
    role: principal?.role || null,
    operation,
    networkFamily: String(payload?.networkFamily || 'unknown').trim().toLowerCase(),
    subjectRef: { type: aggregateType, id: String(aggregateId) },
    entityRefs: entityRefs || [{ type: aggregateType, id: String(aggregateId) }],
    truthBoundary,
    securityClassification: 'restricted',
    provenance: {
      origin: 'services/api/src/routes/contractorCommercial.js',
      requestIdempotencyKey: idempotencyKey,
      operation,
      eventType
    },
    eventType,
    aggregateType,
    aggregateId: String(aggregateId),
    idempotencyKey: 'commercial:' + operation.replace(/[^a-z0-9]+/gi, '_') + ':' + idempotencyKey,
    occurredAt: new Date().toISOString(),
    runtimeVerificationStatus: 'UNVERIFIED',
    payload: payload || {}
  });
}

async function handleContractorCommercial(req, res, ctx) {
  const { method, path, body, principal, db, send } = ctx;
  if (!path.startsWith('/v1/contractor-commercial/')) return null;

  const verified = requireVerifiedPrincipal(principal, process.env);
  if (!verified.ok) return send(res, verified.status, verified.body);
  const role = requireAnyRole(principal, ROLES);
  if (!role.ok) return send(res, role.status, role.body);

  try {
    assertDb(db);
    return await withPrincipal(db, principal, async (client) => {
      const tid = await tenantId(client);

      // Link order → work package
      if (method === 'POST' && path === '/v1/contractor-commercial/links') {
        const key = idempotencyKey(body);
        const orderId = uuid(body?.serviceOrderId, 'SERVICE_ORDER_ID_INVALID');
        const wpId = uuid(body?.workPackageId, 'WORK_PACKAGE_ID_INVALID');
        const existing = await client.query(
          `select id, service_order_id, work_package_id, link_role, created_at
           from portal_order_work_package_links
           where tenant_id=$1 and service_order_id=$2 and work_package_id=$3`,
          [tid, orderId, wpId]
        );
        if (existing.rows[0]) {
          return send(res, 200, { ok: true, link: existing.rows[0], replayed: true, idempotencyKey: key });
        }
        const order = await client.query(
          'select id from portal_service_orders where tenant_id=$1 and id=$2',
          [tid, orderId]
        );
        if (!order.rows[0]) {
          throw Object.assign(new Error('SERVICE_ORDER_NOT_FOUND'), { statusCode: 404, code: 'SERVICE_ORDER_NOT_FOUND' });
        }
        const wp = await client.query(
          'select id, status from ftth_work_packages where tenant_id=$1 and id=$2',
          [tid, wpId]
        );
        if (!wp.rows[0]) {
          throw Object.assign(new Error('WORK_PACKAGE_NOT_FOUND'), { statusCode: 404, code: 'WORK_PACKAGE_NOT_FOUND' });
        }
        const ins = await client.query(
          `insert into portal_order_work_package_links(
             tenant_id, service_order_id, work_package_id, link_role, created_by
           ) values ($1,$2,$3,$4,$5)
           returning id, service_order_id, work_package_id, link_role, created_at`,
          [tid, orderId, wpId, body?.linkRole === 'supporting' || body?.linkRole === 'rework' ? body.linkRole : 'primary', principal.sub || null]
        );
        return send(res, 201, { ok: true, link: ins.rows[0], idempotencyKey: key });
      }

      // Work package transition
      const wpTransition = path.match(/^\/v1\/contractor-commercial\/work-packages\/([0-9a-f-]+)\/transition$/i);
      if (method === 'POST' && wpTransition) {
        const wpId = uuid(wpTransition[1], 'WORK_PACKAGE_ID_INVALID');
        const key = idempotencyKey(body);
        const toStatus = normalizeWpStatus(body?.toStatus);
        const cur = await client.query(
          'select id, status from ftth_work_packages where tenant_id=$1 and id=$2',
          [tid, wpId]
        );
        if (!cur.rows[0]) {
          throw Object.assign(new Error('WORK_PACKAGE_NOT_FOUND'), { statusCode: 404, code: 'WORK_PACKAGE_NOT_FOUND' });
        }
        assertWorkPackageTransition(cur.rows[0].status, toStatus);
        const eventExisting = await client.query(
          'select id from contractor_work_package_events where tenant_id=$1 and event_idempotency_key=$2',
          [tid, key]
        );
        if (eventExisting.rows[0]) {
          const refreshed = await client.query(
            'select id, status, code, work_type from ftth_work_packages where id=$1',
            [wpId]
          );
          return send(res, 200, { ok: true, workPackage: refreshed.rows[0], replayed: true, idempotencyKey: key });
        }
        const updated = await client.query(
          `update ftth_work_packages set status=$1
           where tenant_id=$2 and id=$3
           returning id, status, code, work_type, assigned_to, contractor_id`,
          [toStatus, tid, wpId]
        );
        await client.query(
          `insert into contractor_work_package_events(
             tenant_id, work_package_id, from_status, to_status, event_type,
             actor_id, evidence_refs, event_idempotency_key, details
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            tid,
            wpId,
            cur.rows[0].status,
            toStatus,
            eventTypeForTransition(toStatus),
            principal.sub || null,
            Array.isArray(body?.evidenceRefs) ? body.evidenceRefs.map(String).slice(0, 20) : [],
            key,
            JSON.stringify({ note: body?.note != null ? String(body.note).slice(0, 500) : null })
          ]
        );
        await emitCanonicalCommercialEvent(client, {
          tenantId: tid, principal,
          operation: 'contractor.work_package.transition',
          eventType: 'contractor.work_package.transitioned',
          aggregateType: 'work_package', aggregateId: wpId,
          entityRefs: [{ type: 'work_package', id: wpId }],
          idempotencyKey: key,
          truthBoundary: 'WORK_PACKAGE_STATE_PERSISTED; COMMERCIAL_ACCEPTANCE_AND_PAYMENT_AUTHORITY_REMAIN SEPARATE',
          payload: {
            workPackageId: wpId,
            fromStatus: cur.rows[0].status,
            toStatus,
            transitionEventType: eventTypeForTransition(toStatus),
            evidenceRefs: Array.isArray(body?.evidenceRefs) ? body.evidenceRefs.map(String).slice(0, 20) : []
          }
        });
        return send(res, 200, { ok: true, workPackage: updated.rows[0], idempotencyKey: key });
      }

      // List work packages for tenant (bounded)
      if (method === 'GET' && path === '/v1/contractor-commercial/work-packages') {
        const r = await client.query(
          `select id, code, work_type, status, priority, assigned_to, contractor_id,
                  planned_start, planned_end, actual_start, actual_end, created_at
           from ftth_work_packages where tenant_id=$1
           order by created_at desc limit 100`,
          [tid]
        );
        return send(res, 200, { ok: true, workPackages: r.rows });
      }

      // Submit measurement (maker)
      if (method === 'POST' && path === '/v1/contractor-commercial/measurements') {
        const key = idempotencyKey(body);
        const contractorId = uuid(body?.contractorId, 'CONTRACTOR_ID_INVALID');
        const wpId = uuid(body?.workPackageId, 'WORK_PACKAGE_ID_INVALID');
        const quantity = Number(body?.quantity);
        const rateMinor = Number(body?.rateMinor);
        const currency = String(body?.currency || 'EGP').toUpperCase().slice(0, 3);
        const unit = String(body?.unit || '').trim().slice(0, 32);
        if (!unit) {
          throw Object.assign(new Error('MEASUREMENT_UNIT_INVALID'), { statusCode: 400, code: 'MEASUREMENT_UNIT_INVALID' });
        }
        computeMeasurementAmountMinor(quantity, rateMinor);
        const measuredBy = principal.sub;
        if (!measuredBy) {
          throw Object.assign(new Error('ACTOR_REQUIRED'), { statusCode: 401, code: 'ACTOR_REQUIRED' });
        }
        const existing = await client.query(
          `select id, status, quantity, unit, rate_minor, currency, measured_by, verified_by
           from contractor_work_measurements
           where tenant_id=$1 and contractor_id=$2 and work_package_id=$3 and unit=$4`,
          [tid, contractorId, wpId, unit]
        );
        if (existing.rows[0]) {
          return send(res, 200, { ok: true, measurement: existing.rows[0], replayed: true, idempotencyKey: key });
        }
        const ins = await client.query(
          `insert into contractor_work_measurements(
             tenant_id, contractor_id, work_package_id, quantity, unit, rate_minor, currency,
             status, measured_by, evidence_reference, measured_at
           ) values ($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$9,now())
           returning id, status, quantity, unit, rate_minor, currency, measured_by, measured_at`,
          [
            tid,
            contractorId,
            wpId,
            quantity,
            unit,
            rateMinor,
            currency,
            measuredBy,
            body?.evidenceReference ? String(body.evidenceReference).slice(0, 200) : null
          ]
        );
        await emitCanonicalCommercialEvent(client, {
          tenantId: tid, principal,
          operation: 'contractor.measurement.submit',
          eventType: 'contractor.measurement.submitted',
          aggregateType: 'measurement', aggregateId: ins.rows[0].id,
          entityRefs: [
            { type: 'measurement', id: ins.rows[0].id },
            { type: 'work_package', id: wpId }
          ],
          idempotencyKey: key,
          truthBoundary: 'CONTRACTOR_MEASUREMENT_PERSISTED; QC/CHECKER AUTHORITY REMAINS REQUIRED',
          payload: {
            measurementId: ins.rows[0].id, workPackageId: wpId,
            contractorId, quantity, unit, rateMinor, currency,
            status: ins.rows[0].status, evidenceReference: ins.rows[0].evidence_reference || null
          }
        });
        return send(res, 201, { ok: true, measurement: ins.rows[0], idempotencyKey: key });
      }

      // Verify/approve measurement (checker)
      const measTransition = path.match(/^\/v1\/contractor-commercial\/measurements\/([0-9a-f-]+)\/transition$/i);
      if (method === 'POST' && measTransition) {
        const measurementId = uuid(measTransition[1], 'MEASUREMENT_ID_INVALID');
        const key = idempotencyKey(body);
        const toStatus = String(body?.toStatus || '').toLowerCase();
        if (!['verified', 'approved', 'rejected', 'invoiced'].includes(toStatus)) {
          throw Object.assign(new Error('MEASUREMENT_STATUS_INVALID'), { statusCode: 400, code: 'MEASUREMENT_STATUS_INVALID' });
        }
        const cur = await client.query(
          `select id, status, measured_by, verified_by, quantity, rate_minor, currency
           from contractor_work_measurements where tenant_id=$1 and id=$2`,
          [tid, measurementId]
        );
        if (!cur.rows[0]) {
          throw Object.assign(new Error('MEASUREMENT_NOT_FOUND'), { statusCode: 404, code: 'MEASUREMENT_NOT_FOUND' });
        }
        const checkerId = principal.sub;
        assertMeasurementSegregation({
          measuredBy: cur.rows[0].measured_by,
          verifiedBy: checkerId,
          targetStatus: toStatus
        });
        const updated = await client.query(
          `update contractor_work_measurements
           set status=$1, verified_by=$2, verified_at=now()
           where tenant_id=$3 and id=$4
           returning id, status, measured_by, verified_by, quantity, rate_minor, currency, verified_at`,
          [toStatus, checkerId, tid, measurementId]
        );
        await emitCanonicalCommercialEvent(client, {
          tenantId: tid, principal,
          operation: 'contractor.measurement.transition',
          eventType: 'contractor.measurement.status_changed',
          aggregateType: 'measurement', aggregateId: measurementId,
          entityRefs: [{ type: 'measurement', id: measurementId }],
          idempotencyKey: key,
          truthBoundary: 'MEASUREMENT_STATUS_CHANGED UNDER MAKER_CHECKER POLICY; PAYMENT AUTHORITY REMAINS SEPARATE',
          payload: {
            measurementId,
            fromStatus: cur.rows[0].status,
            toStatus,
            measuredBy: cur.rows[0].measured_by,
            verifiedBy: updated.rows[0].verified_by,
            quantity: updated.rows[0].quantity,
            rateMinor: updated.rows[0].rate_minor,
            currency: updated.rows[0].currency
          }
        });
        return send(res, 200, { ok: true, measurement: updated.rows[0], idempotencyKey: key });
      }

      // Open reconciliation (maker)
      if (method === 'POST' && path === '/v1/contractor-commercial/reconciliations') {
        const key = idempotencyKey(body);
        const measurementId = uuid(body?.measurementId, 'MEASUREMENT_ID_INVALID');
        const existing = await client.query(
          `select id, status, amount_minor, currency, maker_id, checker_id
           from commercial_measurement_reconciliation
           where tenant_id=$1 and measurement_id=$2`,
          [tid, measurementId]
        );
        if (existing.rows[0]) {
          return send(res, 200, { ok: true, reconciliation: existing.rows[0], replayed: true, idempotencyKey: key });
        }
        const meas = await client.query(
          `select id, status, quantity, rate_minor, currency, measured_by
           from contractor_work_measurements where tenant_id=$1 and id=$2`,
          [tid, measurementId]
        );
        if (!meas.rows[0]) {
          throw Object.assign(new Error('MEASUREMENT_NOT_FOUND'), { statusCode: 404, code: 'MEASUREMENT_NOT_FOUND' });
        }
        if (!['approved', 'verified'].includes(String(meas.rows[0].status))) {
          throw Object.assign(new Error('MEASUREMENT_NOT_APPROVED'), { statusCode: 409, code: 'MEASUREMENT_NOT_APPROVED' });
        }
        const amountMinor = computeMeasurementAmountMinor(meas.rows[0].quantity, meas.rows[0].rate_minor);
        const makerId = principal.sub;
        assertReconciliationRules({
          makerId,
          checkerId: null,
          status: 'open',
          providerPaymentRef: null,
          providerEvidenceClass: null
        });
        const ins = await client.query(
          `insert into commercial_measurement_reconciliation(
             tenant_id, measurement_id, amount_minor, currency, status, maker_id, event_idempotency_key
           ) values ($1,$2,$3,$4,'open',$5,$6)
           returning id, measurement_id, amount_minor, currency, status, maker_id, created_at`,
          [tid, measurementId, amountMinor, meas.rows[0].currency, makerId, key]
        );
        await emitCanonicalCommercialEvent(client, {
          tenantId: tid, principal,
          operation: 'commercial.reconciliation.open',
          eventType: 'commercial.reconciliation.opened',
          aggregateType: 'reconciliation', aggregateId: ins.rows[0].id,
          entityRefs: [
            { type: 'reconciliation', id: ins.rows[0].id },
            { type: 'measurement', id: measurementId }
          ],
          idempotencyKey: key,
          truthBoundary: 'RECONCILIATION OPENED FROM PERSISTED MEASUREMENT; NO PAYMENT SUCCESS IMPLIED',
          payload: {
            reconciliationId: ins.rows[0].id,
            measurementId,
            amountMinor: ins.rows[0].amount_minor,
            currency: ins.rows[0].currency,
            status: ins.rows[0].status,
            makerId: ins.rows[0].maker_id
          }
        });
        return send(res, 201, { ok: true, reconciliation: ins.rows[0], idempotencyKey: key });
      }

      // Checker / payment transition on reconciliation
      const reconTransition = path.match(/^\/v1\/contractor-commercial\/reconciliations\/([0-9a-f-]+)\/transition$/i);
      if (method === 'POST' && reconTransition) {
        const reconId = uuid(reconTransition[1], 'RECON_ID_INVALID');
        const key = idempotencyKey(body);
        const toStatus = String(body?.toStatus || '').toLowerCase();
        const cur = await client.query(
          `select id, status, maker_id, checker_id, amount_minor, currency
           from commercial_measurement_reconciliation where tenant_id=$1 and id=$2`,
          [tid, reconId]
        );
        if (!cur.rows[0]) {
          throw Object.assign(new Error('RECON_NOT_FOUND'), { statusCode: 404, code: 'RECON_NOT_FOUND' });
        }
        const checkerId =
          toStatus === 'open' ? cur.rows[0].checker_id : principal.sub || cur.rows[0].checker_id;
        assertReconciliationRules({
          makerId: cur.rows[0].maker_id,
          checkerId: toStatus === 'open' ? null : checkerId,
          status: toStatus,
          providerPaymentRef: body?.providerPaymentRef,
          providerEvidenceClass: body?.providerEvidenceClass
        });
        const updated = await client.query(
          `update commercial_measurement_reconciliation
           set status=$1,
               checker_id=coalesce($2, checker_id),
               checker_at=case when $2 is not null then now() else checker_at end,
               provider_payment_ref=coalesce($3, provider_payment_ref),
               provider_evidence_class=coalesce($4, provider_evidence_class),
               invoice_id=coalesce($5::uuid, invoice_id)
           where tenant_id=$6 and id=$7
           returning id, measurement_id, amount_minor, currency, status, maker_id, checker_id,
                     provider_payment_ref, provider_evidence_class, invoice_id, updated_at`,
          [
            toStatus,
            toStatus === 'open' ? null : checkerId,
            body?.providerPaymentRef ? String(body.providerPaymentRef).slice(0, 200) : null,
            body?.providerEvidenceClass ? String(body.providerEvidenceClass) : null,
            body?.invoiceId ? uuid(body.invoiceId, 'INVOICE_ID_INVALID') : null,
            tid,
            reconId
          ]
        );
        await emitCanonicalCommercialEvent(client, {
          tenantId: tid, principal,
          operation: 'commercial.reconciliation.transition',
          eventType: 'commercial.reconciliation.status_changed',
          aggregateType: 'reconciliation', aggregateId: reconId,
          entityRefs: [
            { type: 'reconciliation', id: reconId },
            { type: 'measurement', id: updated.rows[0].measurement_id }
          ],
          idempotencyKey: key,
          truthBoundary: 'COMMERCIAL RECONCILIATION STATUS PERSISTED; PROVIDER PAYMENT EVIDENCE REMAINS REQUIRED FOR PAYMENT-COMPLETE STATE',
          payload: {
            reconciliationId: reconId,
            measurementId: updated.rows[0].measurement_id,
            fromStatus: cur.rows[0].status,
            toStatus,
            amountMinor: updated.rows[0].amount_minor,
            currency: updated.rows[0].currency,
            providerPaymentRef: updated.rows[0].provider_payment_ref || null,
            providerEvidenceClass: updated.rows[0].provider_evidence_class || null,
            invoiceId: updated.rows[0].invoice_id || null,
            makerId: updated.rows[0].maker_id,
            checkerId: updated.rows[0].checker_id
          }
        });
        return send(res, 200, { ok: true, reconciliation: updated.rows[0], idempotencyKey: key });
      }

      // SLA enforcement detection (writes breach_risk/breached events only)
      if (method === 'POST' && path === '/v1/contractor-commercial/sla/enforce') {
        rejectClientTenant(body);
        const contractId = uuid(body?.contractId, 'SLA_CONTRACT_ID_INVALID');
        const subjectType = String(body?.subjectType || '').toLowerCase();
        const subjectId = uuid(body?.subjectId, 'SLA_SUBJECT_ID_INVALID');
        if (!['ticket', 'service_order', 'incident', 'service', 'work_package'].includes(subjectType)) {
          throw Object.assign(new Error('SLA_SUBJECT_TYPE_INVALID'), { statusCode: 400, code: 'SLA_SUBJECT_TYPE_INVALID' });
        }
        const contract = await client.query(
          `select id, response_minutes, restore_minutes, resolution_minutes
           from portal_sla_contracts where tenant_id=$1 and id=$2 and active=true`,
          [tid, contractId]
        );
        if (!contract.rows[0]) {
          throw Object.assign(new Error('SLA_CONTRACT_NOT_FOUND'), { statusCode: 404, code: 'SLA_CONTRACT_NOT_FOUND' });
        }
        const events = await client.query(
          `select clock_kind, occurred_at, evidence_class
           from portal_sla_clock_events
           where tenant_id=$1 and contract_id=$2 and subject_type=$3 and subject_id=$4`,
          [tid, contractId, subjectType === 'work_package' ? 'service_order' : subjectType, subjectId]
        );
        // For work_package subject, clocks may still be under service_order; use requested subjectType for storage
        const clockEvents = await client.query(
          `select clock_kind, occurred_at, evidence_class
           from portal_sla_clock_events
           where tenant_id=$1 and contract_id=$2 and subject_id=$3`,
          [tid, contractId, subjectId]
        );
        const evaluation = evaluateSlaClocks({
          contract: contract.rows[0],
          events: (clockEvents.rows.length ? clockEvents.rows : events.rows).map((e) => ({
            clockKind: e.clock_kind,
            occurredAt: e.occurred_at,
            evidenceClass: e.evidence_class
          }))
        });
        const thresholds = detectAllSlaThresholds(evaluation);
        const written = [];
        for (const t of thresholds) {
          const idem = `${contractId}:${subjectType}:${subjectId}:${t.clockKind}:${t.thresholdPct}`;
          const ins = await client.query(
            `insert into portal_sla_enforcement_events(
               tenant_id, contract_id, subject_type, subject_id, clock_kind,
               threshold_pct, elapsed_minutes, limit_minutes, state, event_idempotency_key, details
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
             on conflict (tenant_id, event_idempotency_key) do nothing
             returning id, clock_kind, threshold_pct, state, elapsed_minutes, limit_minutes`,
            [
              tid,
              contractId,
              subjectType,
              subjectId,
              t.clockKind,
              t.thresholdPct,
              t.elapsedMinutes,
              t.limitMinutes,
              t.state,
              idem,
              JSON.stringify({ evaluationSlice: evaluation[t.clockKind] || null })
            ]
          );
          if (ins.rows[0]) written.push(ins.rows[0]);
        }
        return send(res, 200, {
          ok: true,
          evaluation,
          thresholds,
          written,
          authority: 'DATABASE_EVENT_TIMESTAMPS_ONLY',
          note: 'No ETA invented. Only threshold crossings from elapsed vs limit minutes.'
        });
      }

      return null;
    });
  } catch (e) {
    return send(res, e.statusCode || 500, {
      ok: false,
      error: e.code || e.message || 'CONTRACTOR_COMMERCIAL_ERROR',
      authority: 'CONTRACTOR_COMMERCIAL_API'
    });
  }
}

module.exports = { handleContractorCommercial };
