'use strict';
const crypto = require('node:crypto');
const { residualAnalysis } = require('../../engineering/src/opticalPhysics');

const MAX_MEASUREMENTS = 50;
const MAX_ASSESSMENTS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value) {
  const id = String(value || '');
  if (!UUID.test(id)) throw new Error('FTTH_ENGINEERING_ASSET_ID_INVALID');
  return id;
}
function limit(value, fallback, max, code) {
  const n = value == null ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(code);
  return n;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function measurementQuery(assetId, maxRows) {
  const id = assertUuid(assetId);
  const n = limit(maxRows, 50, MAX_MEASUREMENTS, 'FTTH_ENGINEERING_MEASUREMENT_LIMIT_INVALID');
  return { text: `SELECT id, asset_id, port_id, measurement_type, value_numeric, unit, source, measured_at
    FROM optical_measurements
    WHERE asset_id=$1::uuid
    ORDER BY measured_at DESC NULLS LAST, id DESC
    LIMIT $2`, values: [id, n] };
}
function assessmentQuery(assetId, maxRows) {
  const id = assertUuid(assetId);
  const n = limit(maxRows, 20, MAX_ASSESSMENTS, 'FTTH_ENGINEERING_ASSESSMENT_LIMIT_INVALID');
  return { text: `SELECT id, assessment_kind, evidence_class, standards_refs, input_payload, result_payload, result_sha256, created_at
    FROM fiberos_ftth_engineering_assessments
    WHERE asset_id=$1::uuid
    ORDER BY created_at DESC, id DESC
    LIMIT $2`, values: [id, n] };
}
function numberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function classifySource(source) {
  if (source === 'field_reading') return 'measured';
  if (source === 'nms_poll') return 'observed';
  if (source === 'ai_simulated') return 'simulated';
  return 'unverified';
}
function latestByType(rows) {
  const out = Object.create(null);
  for (const row of rows) if (!out[row.measurement_type]) out[row.measurement_type] = row;
  return out;
}
function budgetFromAssessments(rows) {
  const row = rows.find(r => r.assessment_kind === 'OPTICAL_BUDGET' && r.result_payload && r.result_payload.budget);
  return row || null;
}
function synthesize({ asset, measurements, assessments }) {
  const latest = latestByType(measurements);
  const rx = latest.rx_power;
  const budgetRow = budgetFromAssessments(assessments);
  const expectedRx = budgetRow ? numberOrNull(budgetRow.result_payload.budget.rxDbm) : null;
  const measuredRx = rx ? numberOrNull(rx.value_numeric) : null;
  let residual = null;
  if (measuredRx != null && expectedRx != null) {
    residual = residualAnalysis({
      measuredDbm: measuredRx,
      expectedDbm: expectedRx,
      measurementStdDb: numberOrNull(rx.measurement_std_db) || 0,
      modelStdDb: budgetRow && budgetRow.result_payload.budget.uncertaintyStdDb != null ? Number(budgetRow.result_payload.budget.uncertaintyStdDb) : 0
    });
  }
  const evidence = measurements.map(m => ({ id:m.id, type:m.measurement_type, value:numberOrNull(m.value_numeric), unit:m.unit, source:m.source, evidenceClass:classifySource(m.source), measuredAt:m.measured_at }));
  const findings = [];
  if (!rx || measuredRx == null) findings.push({ code:'RX_MEASUREMENT_MISSING', severity:'information', statement:'No usable rx_power measurement is available for this asset.' });
  if (!budgetRow) findings.push({ code:'OPTICAL_BUDGET_MISSING', severity:'information', statement:'No stored optical-budget assessment with a derived expected Rx value is available.' });
  if (residual && residual.statisticallyUnexpected) findings.push({ code:'RX_RESIDUAL_STATISTICALLY_UNEXPECTED', severity:'warning', statement:'Measured Rx differs from the stored expected Rx by at least three standard deviations under the supplied uncertainty model.' });
  return {
    authority:'FIBEROS_DATABASE_RLS', readOnly:true, advisoryOnly:true, executionAuthorized:false,
    asset:{ id:asset.id, assetCode:asset.asset_code, assetType:asset.asset_type, status:asset.status },
    evidence:{ measurements:evidence, latestMeasurementIds:Object.fromEntries(Object.entries(latest).map(([k,v])=>[k,v.id])) },
    optical:{ measuredRxDbm:measuredRx, expectedRxDbm:expectedRx, residual, budgetAssessmentId:budgetRow && budgetRow.id },
    assessments:assessments.map(a => ({ id:a.id, kind:a.assessment_kind, evidenceClass:a.evidence_class, standardsRefs:a.standards_refs, resultSha256:a.result_sha256, createdAt:a.created_at })),
    findings, provenance:{ measurementIds:measurements.map(m=>m.id), assessmentIds:assessments.map(a=>a.id), generatedFrom:'authoritative-postgresql-session' }
  };
}
async function buildEngineeringIntelligence(client, input={}) {
  if (!client || typeof client.query !== 'function') throw new Error('FTTH_ENGINEERING_DB_CLIENT_REQUIRED');
  if (Object.prototype.hasOwnProperty.call(input,'tenantId')) throw new Error('FTTH_ENGINEERING_TENANT_ID_FORBIDDEN');
  const assetId = assertUuid(input.assetId);
  const [assetRes, mRes, aRes] = await Promise.all([
    client.query({text:'SELECT id, asset_code, asset_type, status FROM network_assets WHERE id=$1::uuid',values:[assetId]}),
    client.query(measurementQuery(assetId, input.measurementLimit)),
    client.query(assessmentQuery(assetId, input.assessmentLimit))
  ]);
  if (!assetRes.rows[0]) throw new Error('FTTH_ENGINEERING_ASSET_NOT_FOUND');
  const out = synthesize({asset:assetRes.rows[0], measurements:mRes.rows, assessments:aRes.rows});
  return Object.freeze({...out, resultSha256:hash(out)});
}
module.exports=Object.freeze({MAX_MEASUREMENTS,MAX_ASSESSMENTS,measurementQuery,assessmentQuery,synthesize,buildEngineeringIntelligence});
