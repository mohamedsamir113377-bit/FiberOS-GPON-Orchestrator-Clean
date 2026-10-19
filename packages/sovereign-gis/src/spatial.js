'use strict';

// Sovereign spatial-intelligence query boundary.
// Read-only, tenant authority remains PostgreSQL RLS/session state.
// No caller-supplied tenant_id is accepted and no external GIS provider is used.

const MAX_RADIUS_M = 50000;
const MAX_DEPTH = 64;

function uuid(value, code) {
  const s = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) throw new Error(code);
  return s;
}

function radiusMeters(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_RADIUS_M) throw new Error('GIS_RADIUS_INVALID');
  return n;
}

function depth(value) {
  const n = value == null ? MAX_DEPTH : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_DEPTH) throw new Error('GIS_DEPTH_INVALID');
  return n;
}

function point(lat, lon) {
  const la = Number(lat); const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
    throw new Error('GIS_POINT_INVALID');
  }
  return [la, lo];
}

function nearbyAssetsQuery(input = {}) {
  const [lat, lon] = point(input.lat, input.lon);
  const radius = radiusMeters(input.radiusMeters);
  return {
    text: `SELECT a.id, a.asset_code, a.asset_type, a.name, a.region, a.status,
      ST_Y(a.gps::geometry) AS lat, ST_X(a.gps::geometry) AS lon,
      ST_Distance(a.gps, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography) AS distance_m
      FROM network_assets a
      WHERE a.gps IS NOT NULL
        AND ST_DWithin(a.gps, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $3)
      ORDER BY distance_m ASC, a.id ASC`,
    values: [lat, lon, radius]
  };
}

function assetTwinQuery(assetId) {
  const id = uuid(assetId, 'GIS_ASSET_ID_INVALID');
  return {
    text: `SELECT a.id, a.asset_code, a.asset_type, a.parent_asset_id, a.name, a.region,
      a.status, a.gps, d.dna_version, d.identity_kind, d.canonical_payload,
      d.payload_sha256, d.evidence_class, d.created_at AS dna_created_at
      FROM network_assets a
      LEFT JOIN LATERAL (
        SELECT dna_version, identity_kind, canonical_payload, payload_sha256, evidence_class, created_at
        FROM fiberos_asset_dna
        WHERE asset_id = a.id
        ORDER BY dna_version DESC
        LIMIT 1
      ) d ON true
      WHERE a.id = $1`,
    values: [id]
  };
}

function spatialImpactQuery(assetId, maxDepth) {
  const id = uuid(assetId, 'GIS_ASSET_ID_INVALID');
  const d = depth(maxDepth);
  return {
    text: `WITH RECURSIVE impact(asset_id, depth) AS (
      SELECT $1::uuid, 0
      UNION
      SELECT CASE WHEN e.from_asset_id = i.asset_id THEN e.to_asset_id ELSE e.from_asset_id END,
             i.depth + 1
      FROM impact i
      JOIN physical_topology_edges e
        ON e.active = true
       AND i.depth < $2
       AND (e.from_asset_id = i.asset_id OR (e.direction = 'undirected' AND e.to_asset_id = i.asset_id))
    ),
    affected AS (SELECT DISTINCT asset_id, min(depth) AS depth FROM impact GROUP BY asset_id),
    customers AS (
      SELECT DISTINCT p.connected_customer_id AS customer_id
      FROM affected x
      JOIN network_ports p ON p.asset_id = x.asset_id
      WHERE p.connected_customer_id IS NOT NULL
    )
    SELECT jsonb_build_object(
      'failedAssetId', $1::text,
      'maxDepth', $2,
      'affectedAssetCount', (SELECT count(*) FROM affected),
      'affectedAssets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'assetId', a.id, 'assetCode', a.asset_code, 'assetType', a.asset_type,
        'status', a.status, 'depth', x.depth,
        'geometry', CASE WHEN a.gps IS NULL THEN NULL ELSE ST_AsGeoJSON(a.gps::geometry)::jsonb END
      ) ORDER BY x.depth, a.id) FROM affected x JOIN network_assets a ON a.id = x.asset_id), '[]'::jsonb),
      'affectedCustomerIds', COALESCE((SELECT jsonb_agg(customer_id ORDER BY customer_id) FROM customers), '[]'::jsonb)
    ) AS impact`,
    values: [id, d]
  };
}

function intersectionQuery(layer, bbox) {
  const values = [bbox && bbox.minLon, bbox && bbox.minLat, bbox && bbox.maxLon, bbox && bbox.maxLat].map(Number);
  const [minLon,minLat,maxLon,maxLat] = values;
  if (values.some(v => !Number.isFinite(v)) || minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90 || minLon >= maxLon || minLat >= maxLat) {
    throw new Error('GIS_BBOX_INVALID');
  }
  const tables = Object.freeze({
    network_asset: ['network_assets','gps'],
    duct: ['ftth_duct_segments','geometry'],
    fiber_cable: ['ftth_cable_segments','geometry'],
    evidence: ['ftth_construction_evidence','gps']
  });
  const spec = tables[String(layer || '').toLowerCase()];
  if (!spec) throw new Error('GIS_LAYER_NOT_ALLOWED');
  return {
    text: `SELECT id, ST_AsGeoJSON(${spec[1]})::jsonb AS geometry FROM ${spec[0]}
      WHERE ${spec[1]} IS NOT NULL AND ST_Intersects(${spec[1]}::geometry, ST_MakeEnvelope($1,$2,$3,$4,4326))
      ORDER BY id`,
    values
  };
}

async function readQuery(client, query) {
  if (!client || typeof client.query !== 'function') throw new Error('GIS_DB_CLIENT_REQUIRED');
  const result = await client.query(query.text, query.values);
  return result.rows;
}

module.exports = Object.freeze({ MAX_RADIUS_M, MAX_DEPTH, nearbyAssetsQuery, assetTwinQuery, spatialImpactQuery, intersectionQuery, readQuery });
