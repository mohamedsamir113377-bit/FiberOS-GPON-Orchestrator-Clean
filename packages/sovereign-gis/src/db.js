'use strict';

// Read-only GIS query boundary. Tenant authority is inherited from the
// authenticated PostgreSQL session/RLS; no tenant_id predicate is accepted
// from callers. Geometry is emitted only from authoritative FiberOS tables.

const LAYERS = Object.freeze({
  technician: {
    table: 'fiberos_current_technician_gis',
    geom: 'position',
    id: 'id',
    where: 'is_active = true',
    properties: `jsonb_build_object('name', name, 'zone', zone, 'battery_status', battery_status, 'is_active', is_active, 'captured_at', captured_at, 'accuracy_meters', accuracy_meters, 'heading_degrees', heading_degrees, 'speed_mps', speed_mps, 'source', source, 'position_age_seconds', extract(epoch from (now() - captured_at)), 'position_stale', (captured_at < now() - interval '15 minutes'))`
  },
  network_asset: {
    table: 'network_assets',
    geom: 'gps',
    id: 'id',
    properties: `jsonb_build_object('asset_code', asset_code, 'asset_type', asset_type, 'name', name, 'region', region, 'status', status)`
  },
  duct: {
    table: 'ftth_duct_segments',
    geom: 'geometry',
    id: 'id',
    properties: `jsonb_build_object('code', code, 'status', status, 'diameter_mm', diameter_mm)`
  },
  fiber_cable: {
    table: 'ftth_cable_segments',
    geom: 'geometry',
    id: 'id',
    properties: `jsonb_build_object('code', code, 'cable_type', cable_type, 'fiber_count', fiber_count, 'status', status)`
  },
  evidence: {
    table: 'ftth_construction_evidence',
    geom: 'gps',
    id: 'id',
    properties: `jsonb_build_object('work_package_id', work_package_id, 'evidence_type', evidence_type, 'captured_at', captured_at, 'accuracy_m', accuracy_m)`
  },
  technician_position: {
    table: 'technician_positions',
    geom: 'position',
    id: 'id',
    properties: `jsonb_build_object('technician_id', technician_id, 'captured_at', captured_at, 'accuracy_meters', accuracy_meters, 'heading_degrees', heading_degrees, 'speed_mps', speed_mps, 'source', source)`
  },
  installation: {
    table: 'installation_jobs',
    geom: 'site_location',
    id: 'id',
    where: "status NOT IN ('COMPLETED','CANCELLED','REJECTED')",
    properties: `jsonb_build_object('job_code', job_code, 'status', status, 'workflow_type', workflow_type, 'technician_id', technician_id, 'visit_scheduled_at', visit_scheduled_at, 'migration_completion_deadline_at', migration_completion_deadline_at)`
  },
  fault: {
    table: 'fault_jobs',
    geom: 'site_location',
    id: 'id',
    where: "status NOT IN ('RESOLVED','CANCELLED','REJECTED')",
    properties: `jsonb_build_object('job_code', job_code, 'status', status, 'fault_type', fault_type, 'severity', severity, 'technician_id', technician_id, 'visit_scheduled_at', visit_scheduled_at, 'sla_deadline_at', sla_deadline_at, 'root_asset_id', root_asset_id)`
  },
  ticket_location: {
    table: 'tickets',
    geom: 'location_coordinates',
    id: 'id',
    properties: `jsonb_build_object('status', status, 'type', type, 'technician_id', technician_id, 'sla_deadline', sla_deadline)`
  }
});

function assertSqlIdent(name, label) {
  // C-4 hardening: only allow simple SQL identifiers from the frozen allow-list.
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw Object.assign(new Error('GIS_IDENTIFIER_INVALID'), { code: 'GIS_IDENTIFIER_INVALID', label });
  }
  return name;
}

function layerSpec(layer) {
  const spec = LAYERS[String(layer || '').toLowerCase()];
  if (!spec) throw Object.assign(new Error('GIS_LAYER_NOT_ALLOWED'), { code: 'GIS_LAYER_NOT_ALLOWED' });
  // Defense-in-depth: even allow-listed specs must be pure identifiers before interpolation.
  assertSqlIdent(spec.table, 'table');
  assertSqlIdent(spec.geom, 'geom');
  assertSqlIdent(spec.id, 'id');
  // properties is a fixed jsonb_build_object expression from the allow-list, not user input.
  return spec;
}

function bboxGeometry({ minLon, minLat, maxLon, maxLat }) {
  const values = [minLon, minLat, maxLon, maxLat].map(Number);
  if (values.some(v => !Number.isFinite(v))) throw new Error('GIS_BBOX_INVALID');
  const [a,b,c,d] = values;
  if (a < -180 || c > 180 || b < -90 || d > 90 || a >= c || b >= d) throw new Error('GIS_BBOX_INVALID');
  return values;
}

function featureCollectionQuery(layer, bbox) {
  const s = layerSpec(layer);
  const [minLon,minLat,maxLon,maxLat] = bboxGeometry(bbox);
  // Identifiers are selected only from the fixed allow-list above.
  return {
    text: `SELECT jsonb_build_object('type','FeatureCollection','features',COALESCE(jsonb_agg(jsonb_build_object('type','Feature','id',${s.id},'geometry',ST_AsGeoJSON(${s.geom})::jsonb,'properties',${s.properties})),'[]'::jsonb)) AS geojson FROM ${s.table} WHERE ${s.geom} IS NOT NULL AND ST_Intersects(${s.geom}::geometry, ST_MakeEnvelope($1,$2,$3,$4,4326))`,
    values: [minLon,minLat,maxLon,maxLat]
  };
}

function mvtQuery(layer, z, x, y) {
  const s = layerSpec(layer);
  for (const n of [z,x,y]) if (!Number.isInteger(n) || n < 0) throw new Error('GIS_TILE_COORDINATE_INVALID');
  if (z > 24) throw new Error('GIS_ZOOM_INVALID');
  const tileCount = 2 ** z;
  if (x >= tileCount || y >= tileCount) throw new Error('GIS_TILE_COORDINATE_INVALID');
  const geographyLayers = new Set(['network_asset','technician','installation','fault']);
  const key = String(layer).toLowerCase();
  const spatialFilter = geographyLayers.has(key)
    ? `${s.geom} && bounds.query4326::geography`
    : `${s.geom} && bounds.query4326`;
  const rowFilter = s.where ? ` AND (${s.where})` : '';
  return {
    text: `WITH bounds AS (SELECT ST_TileEnvelope($1,$2,$3) AS geom3857, ST_Transform(ST_TileEnvelope($1,$2,$3, margin => 64.0/4096.0),4326) AS query4326), src AS (SELECT ${s.id} AS id, ${s.geom} AS raw_geom, ${s.properties} AS properties FROM ${s.table}, bounds WHERE ${s.geom} IS NOT NULL AND ${spatialFilter}${rowFilter}) SELECT ST_AsMVT(tile, $4, 4096, 'mvt_geom') AS tile FROM (SELECT id, properties, ST_AsMVTGeom(ST_Transform(raw_geom::geometry,3857), bounds.geom3857, 4096, 64, true) AS mvt_geom FROM src,bounds) tile WHERE mvt_geom IS NOT NULL`,
    values: [z,x,y,key]
  };
}

async function readFeatureCollection(client, input) {
  if (!client || typeof client.query !== 'function') throw new Error('GIS_DB_CLIENT_REQUIRED');
  const q = featureCollectionQuery(input.layer, input.bbox);
  const result = await client.query(q.text, q.values);
  return result.rows[0] && result.rows[0].geojson ? result.rows[0].geojson : { type: 'FeatureCollection', features: [] };
}

async function readMvt(client, input) {
  if (!client || typeof client.query !== 'function') throw new Error('GIS_DB_CLIENT_REQUIRED');
  const q = mvtQuery(input.layer, input.z, input.x, input.y);
  const result = await client.query(q.text, q.values);
  return result.rows[0] && result.rows[0].tile ? result.rows[0].tile : Buffer.alloc(0);
}

// Spatial-intelligence reads share the same authenticated DB/RLS boundary.
const Spatial = require('./spatial');
async function readNearbyAssets(client, input) { return Spatial.readQuery(client, Spatial.nearbyAssetsQuery(input)); }
async function readAssetTwin(client, assetId) { return Spatial.readQuery(client, Spatial.assetTwinQuery(assetId)); }
async function readSpatialImpact(client, assetId, maxDepth) { return Spatial.readQuery(client, Spatial.spatialImpactQuery(assetId, maxDepth)); }
async function readIntersections(client, layer, bbox) { return Spatial.readQuery(client, Spatial.intersectionQuery(layer, bbox)); }

// Frozen once, after every export is defined, so no caller can ever observe
// a partially-populated (and therefore accidentally mutable) module object.
module.exports = Object.freeze({
  LAYERS,
  layerSpec,
  bboxGeometry,
  featureCollectionQuery,
  mvtQuery,
  readFeatureCollection,
  readMvt,
  readNearbyAssets,
  readAssetTwin,
  readSpatialImpact,
  readIntersections
});
