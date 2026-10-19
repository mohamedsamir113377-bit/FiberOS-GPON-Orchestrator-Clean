'use strict';

/**
 * Snap field GPS points to the nearest fiber/duct linestring.
 * Technique from PostGIS proximity practice (ST_DWithin filter +
 * ST_ClosestPoint / ST_Distance), applied to FTTH plant segments.
 * Parameterized SQL only — no invented geometry.
 */

const { assertPoint, assertRadius, assertLimit } = require('./proximityPolicy');

const LAYERS = Object.freeze({
  FIBER_CABLE: Object.freeze({
    table: 'ftth_cable_segments',
    geomCol: 'geometry',
    idCol: 'id',
    labelCol: 'segment_code'
  }),
  DUCT: Object.freeze({
    table: 'ftth_duct_segments',
    geomCol: 'geometry',
    idCol: 'id',
    labelCol: 'segment_code'
  })
});

function assertLayer(layer) {
  const key = String(layer || 'FIBER_CABLE').toUpperCase();
  if (!LAYERS[key]) {
    const e = new Error('GIS_SNAP_LAYER_UNKNOWN');
    e.code = 'GIS_SNAP_LAYER_UNKNOWN';
    e.statusCode = 400;
    e.allowed = Object.keys(LAYERS);
    throw e;
  }
  return { key, ...LAYERS[key] };
}

/**
 * Build query: nearest segment within tolerance, snapped point on the line.
 * Returns measure fraction along line via ST_LineLocatePoint when possible.
 */
function snapPointToSegmentQuery({
  lat,
  lon,
  maxDistanceM = 25,
  layer = 'FIBER_CABLE',
  limit = 5
} = {}) {
  const p = assertPoint(lat, lon);
  const tol = Number(maxDistanceM == null ? 25 : maxDistanceM);
  if (!Number.isFinite(tol) || tol < 1 || tol > 500) {
    const e = new Error('GIS_SNAP_TOLERANCE_INVALID');
    e.code = 'GIS_SNAP_TOLERANCE_INVALID';
    e.statusCode = 400;
    e.min = 1;
    e.max = 500;
    throw e;
  }
  const lim = assertLimit(Math.min(Number(limit) || 5, 20));
  const L = assertLayer(layer);
  // geometry columns are typically geometry(LineString,4326); use geography for meter filter
  return Object.freeze({
    text: `
      SELECT
        s.${L.idCol} AS segment_id,
        s.${L.labelCol} AS segment_code,
        ST_Distance(
          s.${L.geomCol}::geography,
          ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
        ) AS distance_m,
        ST_X(ST_ClosestPoint(s.${L.geomCol}, ST_SetSRID(ST_MakePoint($2,$1),4326))::geometry) AS snap_lon,
        ST_Y(ST_ClosestPoint(s.${L.geomCol}, ST_SetSRID(ST_MakePoint($2,$1),4326))::geometry) AS snap_lat,
        ST_LineLocatePoint(
          ST_LineMerge(s.${L.geomCol}::geometry),
          ST_ClosestPoint(s.${L.geomCol}, ST_SetSRID(ST_MakePoint($2,$1),4326))
        ) AS measure_fraction
      FROM ${L.table} s
      WHERE s.${L.geomCol} IS NOT NULL
        AND s.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND ST_DWithin(
              s.${L.geomCol}::geography,
              ST_SetSRID(ST_MakePoint($2,$1),4326)::geography,
              $3
            )
      ORDER BY s.${L.geomCol}::geography <-> ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
      LIMIT $4`,
    values: [p.lat, p.lon, tol, lim],
    meta: Object.freeze({
      layer: L.key,
      maxDistanceM: tol,
      limit: lim,
      method: 'ST_DWithin+ST_ClosestPoint+ST_LineLocatePoint',
      source: 'PostGIS proximity / geotagging practice (snap to linestring)',
      truthBoundary: 'QUERY_POLICY_ONLY; REQUIRES_LIVE_SEGMENT_GEOMETRY'
    })
  });
}

/**
 * Geotag a point into the first containing operational region polygon.
 * Regions table assumed: operational_regions(id, region_code, name, boundary geography/geometry, tenant_id)
 * If table missing at runtime, API returns structured error — policy still valid.
 */
function geotagPointToRegionQuery({ lat, lon } = {}) {
  const p = assertPoint(lat, lon);
  return Object.freeze({
    text: `
      SELECT r.id AS region_id, r.region_code, r.name
      FROM operational_regions r
      WHERE r.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND r.boundary IS NOT NULL
        AND ST_Covers(
              r.boundary::geometry,
              ST_SetSRID(ST_MakePoint($2,$1),4326)
            )
      ORDER BY r.region_code
      LIMIT 1`,
    values: [p.lat, p.lon],
    meta: Object.freeze({
      method: 'ST_Covers',
      source: 'PostGIS geotagging to region',
      truthBoundary: 'REQUIRES_OPERATIONAL_REGIONS_TABLE'
    })
  });
}

/**
 * Ring / band query: features between min and max distance (meters).
 */
function assetsBetweenDistancesQuery({
  lat,
  lon,
  minDistanceM = 100,
  maxDistanceM = 1000,
  limit = 50
} = {}) {
  const p = assertPoint(lat, lon);
  const minD = Number(minDistanceM);
  const maxD = assertRadius(maxDistanceM);
  if (!Number.isFinite(minD) || minD < 0 || minD >= maxD) {
    const e = new Error('GIS_DISTANCE_BAND_INVALID');
    e.code = 'GIS_DISTANCE_BAND_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const lim = assertLimit(limit);
  return Object.freeze({
    text: `
      SELECT a.id, a.asset_code, a.asset_type, a.name,
             ST_Y(a.gps::geometry) AS lat, ST_X(a.gps::geometry) AS lon,
             ST_Distance(a.gps, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography) AS distance_m
      FROM network_assets a
      WHERE a.gps IS NOT NULL
        AND a.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND ST_DWithin(a.gps, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $4)
        AND NOT ST_DWithin(a.gps, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $3)
      ORDER BY distance_m ASC, a.id ASC
      LIMIT $5`,
    values: [p.lat, p.lon, minD, maxD, lim],
    meta: Object.freeze({
      minDistanceM: minD,
      maxDistanceM: maxD,
      method: 'ST_DWithin band (outer minus inner)',
      source: 'PostGIS items-between-distances proximity pattern'
    })
  });
}

module.exports = {
  LAYERS,
  snapPointToSegmentQuery,
  geotagPointToRegionQuery,
  assetsBetweenDistancesQuery
};
