'use strict';

const crypto = require('crypto');
const { readNearbyAssets } = require('../../sovereign-gis/src/index');
const { buildGraph } = require('../../unified-intelligence-graph/src');

const MAX_ASSETS = 20;
const MAX_INCIDENTS = 20;
const MAX_RADIUS_M = 50000;
const MAX_DEPTH = 32;

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function limitInt(value, fallback, max) {
  const n = value == null ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error('AI_CONTEXT_LIMIT_INVALID');
  return n;
}
function point(lat, lon) {
  const a = Number(lat), o = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(o) || a < -90 || a > 90 || o < -180 || o > 180) throw new Error('AI_CONTEXT_POINT_INVALID');
  return [a, o];
}
function radius(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_RADIUS_M) throw new Error('AI_CONTEXT_RADIUS_INVALID');
  return n;
}
function assetId(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) throw new Error('AI_CONTEXT_ASSET_ID_INVALID');
  return s;
}
function read(client, text, values) { return client.query(text, values).then(r => r.rows); }

async function buildContext(client, input = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('AI_CONTEXT_DB_CLIENT_REQUIRED');
  const out = {
    sourceAuthority: 'FIBEROS_DATABASE_RLS',
    tenantAuthority: 'POSTGRESQL_RLS_SESSION',
    advisoryOnly: true,
    executionAuthorized: false,
    piiMinimized: true,
    data: Object.create(null)
  };

  if (Object.prototype.hasOwnProperty.call(input, 'tenantId')) throw new Error('AI_CONTEXT_TENANT_ID_FORBIDDEN');
  const count = limitInt(input.limit, 10, MAX_ASSETS);
  const incidents = limitInt(input.incidentLimit, 10, MAX_INCIDENTS);
  const id = assetId(input.assetId);

  const activeIncidents = await read(client, `SELECT id, incident_key, severity, state, affected_customers, primary_asset_id, declared_at, sla_deadline
    FROM incidents WHERE state NOT IN ('resolved','closed') ORDER BY CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, created_at DESC LIMIT $1`, [incidents]);
  out.data.activeIncidents = activeIncidents.map(x => ({
    id: x.id, incidentKey: x.incident_key, severity: x.severity, state: x.state,
    affectedCustomers: Number(x.affected_customers || 0), primaryAssetId: x.primary_asset_id,
    declaredAt: x.declared_at, slaDeadline: x.sla_deadline
  }));

  if (id) {
    const graph = await buildGraph(client, {
      assetId: id,
      depth: Math.min(limitInt(input.depth, 8, MAX_DEPTH), MAX_DEPTH),
      neighborLimit: Math.min(count, 20),
      assessmentLimit: Math.min(incidents, 20)
    });
    out.data.intelligenceGraph = graph;
    out.data.assetTwin = graph.asset && graph.dna ? {
      id: graph.asset.id, assetCode: graph.asset.assetCode, assetType: graph.asset.assetType,
      parentAssetId: graph.asset.parentAssetId, name: graph.asset.name, region: graph.asset.region,
      status: graph.asset.status, dnaVersion: graph.dna.version, identityKind: graph.dna.identityKind,
      payloadSha256: graph.dna.payloadSha256, evidenceClass: graph.dna.evidenceClass, dnaCreatedAt: graph.dna.createdAt
    } : graph.asset || null;
    out.data.spatialImpact = graph.spatialImpact;
  }

  if (input.lat != null || input.lon != null || input.radiusMeters != null) {
    const [lat, lon] = point(input.lat, input.lon);
    const rows = await readNearbyAssets(client, { lat, lon, radiusMeters: radius(input.radiusMeters) });
    out.data.nearbyAssets = rows.slice(0, count).map(x => ({
      id: x.id, assetCode: x.asset_code, assetType: x.asset_type, name: x.name,
      region: x.region, status: x.status, lat: Number(x.lat), lon: Number(x.lon), distanceM: Number(x.distance_m)
    }));
  }

  out.contextHash = hash(out.data);
  return Object.freeze(out);
}

module.exports = Object.freeze({ buildContext, MAX_ASSETS, MAX_INCIDENTS, MAX_RADIUS_M, MAX_DEPTH });
