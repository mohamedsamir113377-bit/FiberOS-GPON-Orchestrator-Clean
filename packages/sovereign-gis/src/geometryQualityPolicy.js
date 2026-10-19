'use strict';

/**
 * Geometry quality / simplification policy (read-model safe defaults).
 */

function assertToleranceM(t) {
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0.01 || n > 100) {
    const e = new Error('GIS_SIMPLIFY_TOLERANCE_INVALID');
    e.code = 'GIS_SIMPLIFY_TOLERANCE_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return n;
}

/**
 * Return simplified GeoJSON for a segment (display only — does not mutate plant).
 */
function simplifySegmentQuery({ segmentId, toleranceM = 1, layer = 'FIBER_CABLE' } = {}) {
  if (!segmentId) {
    const e = new Error('GIS_SEGMENT_ID_REQUIRED');
    e.code = 'GIS_SEGMENT_ID_REQUIRED';
    e.statusCode = 400;
    throw e;
  }
  const tol = assertToleranceM(toleranceM);
  const table = layer === 'DUCT' ? 'ftth_duct_segments' : 'ftth_cable_segments';
  // Convert meter tolerance to degrees approx at equator for geometry simplify;
  // document as display-only approximation.
  return Object.freeze({
    text: `
      SELECT s.id AS segment_id, s.segment_code,
             ST_NPoints(s.geometry) AS points_original,
             ST_NPoints(
               ST_SimplifyPreserveTopology(
                 s.geometry,
                 $2 / 111320.0
               )
             ) AS points_simplified,
             ST_AsGeoJSON(
               ST_SimplifyPreserveTopology(s.geometry, $2 / 111320.0)
             ) AS simplified_geojson,
             ST_IsValid(s.geometry) AS is_valid
      FROM ${table} s
      WHERE s.id = $1::uuid
        AND s.geometry IS NOT NULL
        AND s.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)`,
    values: [segmentId, tol],
    meta: Object.freeze({
      toleranceM: tol,
      method: 'ST_SimplifyPreserveTopology',
      truthBoundary: 'DISPLAY_ONLY_DOES_NOT_MUTATE_PLANT',
      note: 'Degree epsilon ≈ meters/111320; for production local UTM preferred'
    })
  });
}

function validateGeometryWkt(wkt) {
  if (!wkt || typeof wkt !== 'string' || wkt.length > 500000) {
    return { ok: false, code: 'GIS_WKT_INVALID' };
  }
  return { ok: true, wkt };
}

module.exports = {
  assertToleranceM,
  simplifySegmentQuery,
  validateGeometryWkt
};
