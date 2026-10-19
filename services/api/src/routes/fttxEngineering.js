'use strict';

/**
 * FTTX engineering evaluation API — pure policy engines + optional DB persistence.
 * Never claims live OTDR/OLT connectivity or production certification.
 */

const { withPrincipal } = require('../../../../packages/db/src/session');
const { rejectClientTenantAuthority, assertPrincipalForWrite } = require('../tenantBoundary');
const { evaluateOdnPowerBudget } = require('../../../../packages/engineering/src/odnPowerBudget');
const {
  evaluateBendRadius,
  evaluateMicroductBlow,
  listOperatorSelectableCatalog,
  getFiberAttenuationMax,
  resolveSplitterLossDb
} = require('../../../../packages/engineering/src/fttxMaterialsCatalog');
const {
  evaluateToolCalibration,
  authorizeMeasurementCampaign
} = require('../../../../packages/engineering/src/fieldToolCalibration');
const { evaluateSpliceLossFromOtdr, validateOtdrAcquisition } = require('../../../../packages/engineering/src/otdrTracePolicy');
const { buildAsBuiltDeviation, summarizeDeviations } = require('../../../../packages/engineering/src/asBuiltDeviation');
const {
  composeHierarchicalLabel,
  parseHierarchicalLabel,
  assertFireClass,
  FIRE_CLASS_OPTIONS,
  DEFAULT_SEGMENTS
} = require('../../../../packages/engineering/src/hierarchicalLabeling');

const ENGINEERING_ROLES = Object.freeze([
  'ops_manager',
  'area_supervisor',
  'dispatcher',
  'qc',
  'sysadmin',
  'exec',
  'technician',
  'team_lead',
  'fiber_splicer'
]);

function requireRole(principal) {
  const role = principal && principal.role ? String(principal.role) : '';
  if (!ENGINEERING_ROLES.includes(role)) {
    const e = new Error('FORBIDDEN_ROLE');
    e.statusCode = 403;
    e.code = 'FORBIDDEN_ROLE';
    throw e;
  }
}

function mapEngineError(e) {
  const status = e.statusCode || 400;
  return {
    status,
    body: {
      ok: false,
      error: e.code || e.message || 'FTTX_ENGINEERING_ERROR',
      detail: e.allowed || e.part || e.segment || null,
      truthBoundary: 'SOURCE_EVALUATION_ONLY'
    }
  };
}

async function optionalTenant(client) {
  const result = await client.query(
    'select public.fiberos_session_tenant_id() as tenant_id'
  );
  return result.rows[0] ? result.rows[0].tenant_id : null;
}

/**
 * Dispatcher for /v1/fttx-engineering/*
 */
async function handleFttxEngineering(req, res, ctx) {
  const { method, path, principal, db, send, body } = ctx;
  if (!path.startsWith('/v1/fttx-engineering')) return null;

  try {
    const gate = assertPrincipalForWrite(principal);
    if (!gate.ok) return send(res, gate.status || 401, gate.body || { ok: false, error: gate.error });
    requireRole(principal);

    // --- pure catalog ---
    if (method === 'GET' && path === '/v1/fttx-engineering/catalog') {
      return send(res, 200, {
        ok: true,
        catalog: listOperatorSelectableCatalog(),
        fireClassOptions: FIRE_CLASS_OPTIONS,
        labelDefaultSegments: DEFAULT_SEGMENTS,
        authority: 'SOURCE_STANDARDS_CATALOG'
      });
    }

    // --- pure evaluations (no DB required) ---
    if (method === 'POST' && path === '/v1/fttx-engineering/evaluate/bend-radius') {
      const out = evaluateBendRadius(body || {});
      return send(res, 200, { ok: true, evaluation: out, authority: 'SOURCE_POLICY' });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/evaluate/microduct-blow') {
      const out = evaluateMicroductBlow(body || {});
      return send(res, 200, { ok: true, evaluation: out, authority: 'SOURCE_POLICY' });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/evaluate/odn-budget') {
      const input = { ...(body || {}) };
      if (input.fiberStandard && input.fiberAttenuationDbPerKm == null && input.wavelengthNm) {
        input.fiberAttenuationDbPerKm = getFiberAttenuationMax(input.fiberStandard, input.wavelengthNm);
      }
      if (input.splitterProfile && input.splitterLossDb == null) {
        input.splitterLossDb = resolveSplitterLossDb(input.splitterProfile);
      }
      const out = evaluateOdnPowerBudget(input);
      return send(res, out.rejected ? 422 : 200, {
        ok: !out.rejected,
        evaluation: out,
        authority: 'SOURCE_ODN_BUDGET_ENGINE'
      });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/evaluate/tool-calibration') {
      const out = evaluateToolCalibration(body || {});
      return send(res, out.accepted ? 200 : 422, {
        ok: out.accepted,
        evaluation: out,
        authority: 'SOURCE_CALIBRATION_GATE'
      });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/evaluate/measurement-campaign') {
      const out = authorizeMeasurementCampaign(body || {});
      return send(res, out.accepted ? 200 : 422, {
        ok: out.accepted,
        evaluation: out,
        authority: 'SOURCE_CALIBRATION_GATE'
      });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/evaluate/otdr-splice') {
      if (body && body.acquisition) validateOtdrAcquisition(body.acquisition);
      const out = evaluateSpliceLossFromOtdr(body || {});
      return send(res, out.accepted ? 200 : 422, {
        ok: out.accepted,
        evaluation: out,
        authority: 'SOURCE_OTDR_POLICY'
      });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/label/compose') {
      const out = composeHierarchicalLabel(body || {});
      return send(res, 200, { ok: true, label: out, authority: 'SOURCE_LABEL_POLICY' });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/label/parse') {
      const out = parseHierarchicalLabel((body && body.code) || '', body || {});
      return send(res, 200, { ok: true, label: out, authority: 'SOURCE_LABEL_POLICY' });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/as-built/deviation') {
      const row = buildAsBuiltDeviation(body || {});
      return send(res, 200, { ok: true, deviation: row, authority: 'SOURCE_AS_BUILT_POLICY' });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/as-built/summarize') {
      const summary = summarizeDeviations((body && body.deviations) || []);
      return send(res, 200, { ok: true, summary, authority: 'SOURCE_AS_BUILT_POLICY' });
    }
    if (method === 'POST' && path === '/v1/fttx-engineering/fire-class/assert') {
      const fireClass = assertFireClass(body && body.fireClass);
      return send(res, 200, { ok: true, fireClass, authority: 'SOURCE_FIRE_CLASS_POLICY' });
    }

    // --- DB-backed profile / persistence ---
    if (!db || !db.configured) {
      if (
        path === '/v1/fttx-engineering/profile' ||
        path.startsWith('/v1/fttx-engineering/as-built/records') ||
        path.startsWith('/v1/fttx-engineering/labels')
      ) {
        return send(res, 503, {
          ok: false,
          error: 'DATABASE_REQUIRED',
          authority: 'DATABASE_BACKED_WHEN_CONFIGURED'
        });
      }
      return null;
    }

    const tenantGate = rejectClientTenantAuthority(body || {});
    if (!tenantGate.ok) return send(res, tenantGate.status || 400, tenantGate);

    if (method === 'GET' && path === '/v1/fttx-engineering/profile') {
      const out = await withPrincipal(db, principal, async (client) => {
        const tid = await optionalTenant(client);
        if (!tid) {
          const e = new Error('TENANT_CONTEXT_REQUIRED');
          e.statusCode = 403;
          throw e;
        }
        const r = await client.query(
          `select architecture_code, topology_code, pon_technology, default_fiber_standard,
                  default_connector_polish, notes, updated_at
             from tenant_fttx_profile where tenant_id = $1`,
          [tid]
        );
        return { tenantId: tid, profile: r.rows[0] || null };
      });
      return send(res, 200, { ok: true, ...out, authority: 'DATABASE_BACKED_PROFILE' });
    }

    if (method === 'PUT' && path === '/v1/fttx-engineering/profile') {
      const b = body || {};
      if (b.fireClass != null) assertFireClass(b.fireClass);
      const out = await withPrincipal(db, principal, async (client) => {
        const tid = await optionalTenant(client);
        if (!tid) {
          const e = new Error('TENANT_CONTEXT_REQUIRED');
          e.statusCode = 403;
          throw e;
        }
        const r = await client.query(
          `insert into tenant_fttx_profile (
             tenant_id, architecture_code, topology_code, pon_technology,
             default_fiber_standard, default_connector_polish, notes, updated_at
           ) values ($1,$2,$3,$4,$5,$6,$7,now())
           on conflict (tenant_id) do update set
             architecture_code = excluded.architecture_code,
             topology_code = excluded.topology_code,
             pon_technology = excluded.pon_technology,
             default_fiber_standard = excluded.default_fiber_standard,
             default_connector_polish = excluded.default_connector_polish,
             notes = excluded.notes,
             updated_at = now()
           returning architecture_code, topology_code, pon_technology,
                     default_fiber_standard, default_connector_polish, notes, updated_at`,
          [
            tid,
            b.architectureCode || 'FTTH',
            b.topologyCode || 'P2MP_PON',
            b.ponTechnology || null,
            b.defaultFiberStandard || 'G.652.D',
            b.defaultConnectorPolish || 'APC',
            b.notes ? String(b.notes).slice(0, 1000) : null
          ]
        );
        return { tenantId: tid, profile: r.rows[0] };
      });
      return send(res, 200, { ok: true, ...out, authority: 'DATABASE_BACKED_PROFILE' });
    }

    if (method === 'POST' && path === '/v1/fttx-engineering/as-built/records') {
      const row = buildAsBuiltDeviation(body || {});
      const out = await withPrincipal(db, principal, async (client) => {
        const tid = await optionalTenant(client);
        if (!tid) {
          const e = new Error('TENANT_CONTEXT_REQUIRED');
          e.statusCode = 403;
          throw e;
        }
        const ins = await client.query(
          `insert into as_built_deviations (
             tenant_id, design_ref, as_built_ref, kind, design_value, as_built_value,
             matched, reason, severity, affects_service, created_by
           ) values ($1,$2,$3,$4,$5::text,$6::text,$7,$8,$9,$10,$11)
           returning id, design_ref, as_built_ref, kind, matched, severity, created_at`,
          [
            tid,
            row.designRef,
            row.asBuiltRef,
            row.kind,
            row.designValue == null ? null : String(row.designValue),
            row.asBuiltValue == null ? null : String(row.asBuiltValue),
            row.matched,
            row.reason,
            row.severity,
            row.affectsService,
            principal.sub || null
          ]
        );
        return ins.rows[0];
      });
      return send(res, 201, {
        ok: true,
        record: out,
        deviation: row,
        authority: 'DATABASE_BACKED_AS_BUILT'
      });
    }

    if (method === 'POST' && path === '/v1/fttx-engineering/labels') {
      const label = composeHierarchicalLabel(body || {});
      const fireClass = body && body.fireClass != null ? assertFireClass(body.fireClass) : null;
      const out = await withPrincipal(db, principal, async (client) => {
        const tid = await optionalTenant(client);
        if (!tid) {
          const e = new Error('TENANT_CONTEXT_REQUIRED');
          e.statusCode = 403;
          throw e;
        }
        const ins = await client.query(
          `insert into network_hierarchical_labels (
             tenant_id, label_code, segment_order, segments, separator, fire_class, asset_ref, created_by
           ) values ($1,$2,$3::text[],$4::text[],$5,$6,$7,$8)
           returning id, label_code, fire_class, created_at`,
          [
            tid,
            label.code,
            label.segmentOrder,
            label.segments,
            label.separator,
            fireClass,
            body && body.assetRef ? String(body.assetRef).slice(0, 160) : null,
            principal.sub || null
          ]
        );
        return ins.rows[0];
      });
      return send(res, 201, {
        ok: true,
        record: out,
        label,
        authority: 'DATABASE_BACKED_LABEL'
      });
    }

    return null;
  } catch (e) {
    if (e.code || e.statusCode) {
      const mapped = mapEngineError(e);
      return send(res, mapped.status, mapped.body);
    }
    return send(res, 500, { ok: false, error: e.message || 'FTTX_ENGINEERING_ERROR' });
  }
}

module.exports = { handleFttxEngineering };
