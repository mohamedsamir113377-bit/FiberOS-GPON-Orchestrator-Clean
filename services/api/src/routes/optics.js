'use strict';

/**
 * Optical measurements API — uses @fiberos/ftth-measurements domain.
 * Append-only insert into optical_measurements when DB is configured.
 * Never grants final ticket close authority from this route alone.
 */

const { withPrincipal } = require('../../../../packages/db/src/session');
const { rejectClientTenantAuthority, assertPrincipalForWrite, boundaryOk } = require('../tenantBoundary');
const {
  buildMeasurementRecord,
  isValidSource,
  isAuthoritativeSource,
  validateRxPower,
  evaluateCloseGate,
  GPON_CLASS_B_PLUS,
  MEASUREMENT_TYPES
} = require('../../../../packages/ftth-measurements/src/index');

async function handleOpticsMeasurementSubmit(body, principal, db) {
  body = body || {};

  const principalGate = assertPrincipalForWrite(principal);
  if (!principalGate.ok) return principalGate;
  const tenantGate = rejectClientTenantAuthority(body);
  if (!tenantGate.ok) return tenantGate;
  const boundary = boundaryOk({
    principalSub: principal && principal.sub ? String(principal.sub) : null
  });

  let record;
  try {
    record = buildMeasurementRecord({
      assetId: body.assetId || null,
      portId: body.portId || null,
      measurementType: body.measurementType || body.type || 'rx_power',
      valueNumeric: body.valueNumeric != null ? body.valueNumeric : body.rxDbm != null ? body.rxDbm : body.value,
      unit: body.unit || (body.measurementType === 'rx_power' || !body.measurementType ? 'dBm' : null),
      sorFileRef: body.sorFileRef || body.sor_file_ref || null,
      source: body.source,
      // measured_by is a technicians.id foreign key; resolve it only after
      // the current tenant is established. Pre-DB responses must not expose a
      // value that looks persistable but is actually a user subject UUID.
      measuredBy: null,
      measuredAt: body.measuredAt || null
    });
  } catch (e) {
    return {
      status: 422,
      body: {
        ok: false,
        error: e.code || 'INVALID_MEASUREMENT',
        message: 'Invalid measurement payload',
        allowedSources: ['field_reading', 'nms_poll', 'ai_simulated'],
        allowedTypes: MEASUREMENT_TYPES.slice(),
        gponWindow: GPON_CLASS_B_PLUS
      }
    };
  }

  if (record.measurement_type === 'rx_power' && record.value_numeric != null) {
    const rx = validateRxPower(record.value_numeric);
    if (!rx.ok) {
      return {
        status: 422,
        body: {
          ok: false,
          error: rx.code,
          detail: rx,
          gponWindow: GPON_CLASS_B_PLUS
        }
      };
    }
  }

  // Advisory close preview only — does not mutate tickets
  const closePreview = evaluateCloseGate({
    ticketId: body.ticketId || 'preview',
    measurementSource: record.source,
    gpsOk: body.gpsOk === true,
    hasPhoto: body.hasPhoto === true,
    powerDbm: record.value_numeric,
    requiresSignature: false
  });

  if (!db || !db.configured) {
    return {
      status: 202,
      body: {
        ok: true,
        accepted: false,
        persisted: false,
        record,
        closePreview,
        authoritativeSource: isAuthoritativeSource(record.source),
        authority: 'VALIDATED_NOT_PERSISTED',
        note: 'Set DATABASE_URL to persist into optical_measurements',
        boundary

      }
    };
  }

  try {
    const row = await withPrincipal(db, principal, async function (client) {
      // Tenant authority is database-owned. Do not continue with an unscoped
      // optical write when tenant resolution fails or yields no tenant.
      const tenantResult = await client.query(
        'select public.fiberos_current_tenant_id() as tenant_id'
      );
      const tenantId = tenantResult.rows[0] && tenantResult.rows[0].tenant_id;
      if (!tenantId) {
        const e = new Error('TENANT_CONTEXT_REQUIRED');
        e.statusCode = 403;
        throw e;
      }

      let resolvedTechnicianId = null;
      const role = String(principal && principal.role || '').trim();
      if (role === 'field_tech' || role === 'technician') {
        const technicianResult = await client.query(
          'select id from technicians where user_id = $1::uuid and tenant_id = $2::uuid and is_active = true limit 1',
          [principal && principal.sub, tenantId]
        );
        resolvedTechnicianId = technicianResult.rows[0] && technicianResult.rows[0].id
          ? technicianResult.rows[0].id
          : null;
        if (!resolvedTechnicianId) {
          const e = new Error('TECHNICIAN_IDENTITY_NOT_RESOLVED');
          e.statusCode = 403;
          e.code = 'TECHNICIAN_IDENTITY_NOT_RESOLVED';
          throw e;
        }
      }

      // `measured_by` is a technicians.id FK, not the authenticated user's
      // subject UUID. Resolve it from the trusted principal + current tenant.
      // Management/QC callers are permitted by DB policy without a technician
      // row, so their measurement remains unattributed rather than storing an
      // invalid user UUID in a technician foreign-key column.
      record = Object.freeze({
        ...record,
        measured_by: resolvedTechnicianId
      });

      const cols = [
        'tenant_id',
        'measurement_type',
        'value_numeric',
        'unit',
        'source',
        'sor_file_ref',
        'measured_by',
        'measured_at',
        'asset_id',
        'port_id'
      ];
      const vals = [
        tenantId,
        record.measurement_type,
        record.value_numeric,
        record.unit,
        record.source,
        record.sor_file_ref,
        record.measured_by,
        record.measured_at,
        record.asset_id,
        record.port_id
      ];

      const placeholders = vals.map(function (_, i) {
        return '$' + (i + 1);
      }).join(',');

      const sql =
        'insert into optical_measurements (' +
        cols.join(',') +
        ') values (' +
        placeholders +
        ') returning id, measurement_type, value_numeric, unit, source, measured_at, asset_id, port_id';

      const r = await client.query(sql, vals);
      return r.rows[0];
    });

    return {
      status: 200,
      body: {
        ok: true,
        persisted: true,
        measurement: row,
        closePreview,
        authoritativeSource: isAuthoritativeSource(record.source),
        authority: 'DATABASE_APPEND_ONLY',
        boundary,
        note:
          isAuthoritativeSource(record.source)
            ? 'Authoritative source recorded; ticket close still requires fieldClose + evidence gate'
            : 'Non-authoritative source recorded; cannot final-close tickets'
      }
    };
  } catch (e) {
    if (e && e.code === 'TENANT_CONTEXT_REQUIRED') {
      return {
        status: 403,
        body: { ok: false, error: 'TENANT_CONTEXT_REQUIRED' }
      };
    }
    if (e && e.code === 'TECHNICIAN_IDENTITY_NOT_RESOLVED') {
      return {
        status: 403,
        body: { ok: false, error: 'TECHNICIAN_IDENTITY_NOT_RESOLVED' }
      };
    }
    return {
      status: 500,
      body: {
        ok: false,
        error: 'OPTICAL_MEASUREMENT_PERSIST_FAILED',
        detail: 'OPTICS_PERSISTENCE_FAILED'
      }
    };
  }
}

async function handleOpticsValidateOnly(body) {
  body = body || {};
  const source = body.source;
  if (!isValidSource(source)) {
    return {
      status: 422,
      body: { ok: false, error: 'INVALID_SOURCE', allowed: ['field_reading', 'nms_poll', 'ai_simulated'] }
    };
  }
  const power = body.rxDbm != null ? body.rxDbm : body.valueNumeric;
  const rx = power != null ? validateRxPower(power) : { ok: true, skipped: true };
  const gate = evaluateCloseGate({
    ticketId: body.ticketId || 'validate',
    measurementSource: source,
    gpsOk: body.gpsOk === true,
    hasPhoto: body.hasPhoto === true,
    powerDbm: power,
    requiresSignature: body.requiresSignature === true,
    signatureRef: body.signatureRef
  });
  return {
    status: 200,
    body: {
      ok: true,
      rx,
      gate,
      authoritativeSource: isAuthoritativeSource(source),
      gponWindow: GPON_CLASS_B_PLUS,
      authority: 'PURE_DOMAIN_VALIDATION'
    }
  };
}

module.exports = {
  handleOpticsMeasurementSubmit,
  handleOpticsValidateOnly
};
