'use strict';

const crypto = require('node:crypto');
const { assetTwinQuery, spatialImpactQuery, nearbyAssetsQuery } = require('../../sovereign-gis/src/spatial');

const MAX_DEPTH = 32;
const MAX_NEIGHBORS = 50;
const MAX_ASSESSMENTS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertClient(client) {
  if (!client || typeof client.query !== 'function') throw new Error('INTELLIGENCE_GRAPH_DB_CLIENT_REQUIRED');
}
function assertUuid(value) {
  const id = String(value || '');
  if (!UUID.test(id)) throw new Error('INTELLIGENCE_GRAPH_ASSET_ID_INVALID');
  return id;
}
function bounded(value, fallback, max, code) {
  const n = value == null ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(code);
  return n;
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function topologyNeighborsQuery(assetId, limit) {
  const id = assertUuid(assetId);
  const n = bounded(limit, 20, MAX_NEIGHBORS, 'INTELLIGENCE_GRAPH_NEIGHBOR_LIMIT_INVALID');
  return { text: `SELECT e.id, e.from_asset_id, e.to_asset_id, e.relation, e.capacity, e.weight,
      e.shared_risk_group, e.direction, e.active,
      CASE WHEN e.from_asset_id=$1::uuid THEN e.to_asset_id ELSE e.from_asset_id END AS neighbor_asset_id
    FROM physical_topology_edges e
    WHERE e.active=true AND (e.from_asset_id=$1::uuid OR e.to_asset_id=$1::uuid)
    ORDER BY e.weight NULLS LAST, neighbor_asset_id, e.id LIMIT $2`, values: [id, n] };
}

function engineeringAssessmentsQuery(assetId, limit) {
  const id = assertUuid(assetId);
  const n = bounded(limit, 10, MAX_ASSESSMENTS, 'INTELLIGENCE_GRAPH_ASSESSMENT_LIMIT_INVALID');
  return { text: `SELECT id, assessment_kind, evidence_class, standards_refs, input_payload AS inputs, result_payload AS results,
      result_sha256, created_at
    FROM fiberos_ftth_engineering_assessments
    WHERE asset_id=$1::uuid
    ORDER BY created_at DESC, id DESC LIMIT $2`, values: [id, n] };
}

async function queryRows(client, q) { const r = await client.query(q.text, q.values); return r.rows; }

async function buildGraph(client, input = {}) {
  assertClient(client);
  const assetId = assertUuid(input.assetId);
  const depth = bounded(input.depth, 8, MAX_DEPTH, 'INTELLIGENCE_GRAPH_DEPTH_INVALID');
  const neighborLimit = bounded(input.neighborLimit, 20, MAX_NEIGHBORS, 'INTELLIGENCE_GRAPH_NEIGHBOR_LIMIT_INVALID');
  const assessmentLimit = bounded(input.assessmentLimit, 10, MAX_ASSESSMENTS, 'INTELLIGENCE_GRAPH_ASSESSMENT_LIMIT_INVALID');

  const [twinRows, edgeRows, assessmentRows, impactRows] = await Promise.all([
    queryRows(client, assetTwinQuery(assetId)),
    queryRows(client, topologyNeighborsQuery(assetId, neighborLimit)),
    queryRows(client, engineeringAssessmentsQuery(assetId, assessmentLimit)),
    queryRows(client, spatialImpactQuery(assetId, depth))
  ]);
  if (!twinRows[0]) throw new Error('INTELLIGENCE_GRAPH_ASSET_NOT_FOUND');

  const twin = twinRows[0];
  const impact = impactRows[0] && impactRows[0].impact ? impactRows[0].impact : null;
  const graph = {
    authority: 'FIBEROS_DATABASE_RLS',
    tenantAuthority: 'POSTGRESQL_RLS_SESSION',
    readOnly: true,
    advisoryOnly: true,
    executionAuthorized: false,
    asset: {
      id: twin.id, assetCode: twin.asset_code, assetType: twin.asset_type,
      parentAssetId: twin.parent_asset_id, name: twin.name, region: twin.region,
      status: twin.status, geometry: twin.gps ? twin.gps : null
    },
    dna: twin.dna_version == null ? null : {
      version: Number(twin.dna_version), identityKind: twin.identity_kind,
      payloadSha256: twin.payload_sha256, evidenceClass: twin.evidence_class,
      createdAt: twin.dna_created_at
    },
    topology: edgeRows.map(e => ({
      id: e.id, neighborAssetId: e.neighbor_asset_id, fromAssetId: e.from_asset_id,
      toAssetId: e.to_asset_id, relation: e.relation, capacity: e.capacity,
      weight: e.weight, sharedRiskGroup: e.shared_risk_group, direction: e.direction, active: e.active
    })),
    spatialImpact: impact ? {
      failedAssetId: impact.failedAssetId,
      maxDepth: impact.maxDepth,
      affectedAssetCount: impact.affectedAssetCount,
      affectedAssets: impact.affectedAssets
    } : null,
    engineering: assessmentRows.map(a => ({
      id: a.id, assessmentKind: a.assessment_kind, evidenceClass: a.evidence_class,
      standardsRefs: a.standards_refs, inputs: a.inputs, results: a.results,
      resultSha256: a.result_sha256, createdAt: a.created_at
    }))
  };
  return Object.freeze({ ...graph, graphHash: digest(graph) });
}

function assertNearbyInput(input) {
  if (Object.prototype.hasOwnProperty.call(input || {}, 'tenantId')) throw new Error('INTELLIGENCE_GRAPH_TENANT_ID_FORBIDDEN');
  return true;
}

module.exports = Object.freeze({ buildGraph, topologyNeighborsQuery, engineeringAssessmentsQuery, assertNearbyInput, MAX_DEPTH, MAX_NEIGHBORS, MAX_ASSESSMENTS });
