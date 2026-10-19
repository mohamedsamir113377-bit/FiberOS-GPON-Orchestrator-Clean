'use strict';

/**
 * Civil corridor conflict detection — buffer around plant + spatial predicates.
 * Uses parameterized PostGIS only; no invented geometries at runtime.
 */

const { assertPoint, assertLimit } = require('./proximityPolicy');

const MIN_BUFFER_M = 0.5;
const MAX_BUFFER_M = 50;
const DEFAULT_BUFFER_M = 2;

function assertBufferM(v) {
  const n = Number(v == null ? DEFAULT_BUFFER_M : v);
  if (!Number.isFinite(n) || n < MIN_BUFFER_M || n > MAX_BUFFER_M) {
    const e = new Error('GIS_BUFFER_M_INVALID');
    e.code = 'GIS_BUFFER_M_INVALID';
    e.statusCode = 400;
    e.min = MIN_BUFFER_M;
    e.max = MAX_BUFFER_M;
    throw e;
  }
  return n;
}

/**
 * Plant segments whose buffer intersects a proposed dig polygon (WKT polygon).
 * digWkt must be POLYGON/MULTIPOLYGON in EPSG:4326.
 */
function plantConflictWithDigQuery({ digWkt, bufferM = DEFAULT_BUFFER_M, limit = 50 } = {}) {
  if (!digWkt || typeof digWkt !== 'string' || digWkt.length > 200000) {
    const e = new Error('GIS_DIG_WKT_INVALID');
    e.code = 'GIS_DIG_WKT_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const upper = digWkt.trim().toUpperCase();
  if (!upper.startsWith('POLYGON') && !upper.startsWith('MULTIPOLYGON')) {
    const e = new Error('GIS_DIG_WKT_MUST_BE_POLYGON');
    e.code = 'GIS_DIG_WKT_MUST_BE_POLYGON';
    e.statusCode = 400;
    throw e;
  }
  const buf = assertBufferM(bufferM);
  const lim = assertLimit(limit);
  return Object.freeze({
    text: `
      WITH dig AS (
        SELECT ST_SetSRID(ST_GeomFromText($1), 4326) AS g
      ),
      plant AS (
        SELECT 'FIBER_CABLE'::text AS layer, c.id AS segment_id, c.segment_code, c.geometry
        FROM ftth_cable_segments c
        WHERE c.geometry IS NOT NULL
          AND c.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        UNION ALL
        SELECT 'DUCT'::text, d.id, d.segment_code, d.geometry
        FROM ftth_duct_segments d
        WHERE d.geometry IS NOT NULL
          AND d.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
      )
      SELECT p.layer, p.segment_id, p.segment_code,
             ST_Intersects(
               ST_Buffer(p.geometry::geography, $2)::geometry,
               dig.g
             ) AS intersects_buffer,
             ST_Overlaps(
               ST_Buffer(p.geometry::geography, $2)::geometry,
               dig.g
             ) AS overlaps_buffer,
             ST_Touches(p.geometry, dig.g) AS touches_exact,
             ST_Distance(p.geometry::geography, dig.g::geography) AS distance_m
      FROM plant p CROSS JOIN dig
      WHERE ST_DWithin(p.geometry::geography, dig.g::geography, $2 + 1)
      ORDER BY distance_m ASC
      LIMIT $3`,
    values: [digWkt, buf, lim],
    meta: Object.freeze({
      bufferM: buf,
      limit: lim,
      method: 'ST_Buffer(geography)+ST_Intersects/Overlaps/Touches',
      truthBoundary: 'REQUIRES_LIVE_PLANT_GEOMETRY_AND_VALID_DIG_WKT'
    })
  });
}

/**
 * Civil inspections whose geometry intersects plant buffer (existing field data).
 */
function civilInspectionPlantConflictQuery({ bufferM = DEFAULT_BUFFER_M, limit = 50 } = {}) {
  const buf = assertBufferM(bufferM);
  const lim = assertLimit(limit);
  return Object.freeze({
    text: `
      SELECT i.id AS inspection_id, i.inspection_type, i.captured_at,
             c.id AS cable_id, c.segment_code,
             ST_Distance(c.geometry::geography, i.geometry::geography) AS distance_m
      FROM ftth_civil_inspections i
      JOIN ftth_cable_segments c
        ON c.tenant_id = i.tenant_id
       AND c.geometry IS NOT NULL
       AND i.geometry IS NOT NULL
       AND ST_DWithin(c.geometry::geography, i.geometry::geography, $1)
      WHERE i.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
      ORDER BY distance_m ASC
      LIMIT $2`,
    values: [buf, lim],
    meta: Object.freeze({
      bufferM: buf,
      method: 'ST_DWithin civil inspection ↔ cable',
      truthBoundary: 'REQUIRES_FTTH_CIVIL_INSPECTIONS_ROWS'
    })
  });
}

/**
 * Pure evaluation of conflict severity from query rows (no DB).
 */
function classifyConflicts(rows = [], bufferM = DEFAULT_BUFFER_M) {
  const list = Array.isArray(rows) ? rows : [];
  const critical = list.filter(r => r.intersects_buffer === true || Number(r.distance_m) <= bufferM * 0.25);
  const warning = list.filter(r => !critical.includes(r) && (r.overlaps_buffer === true || r.touches_exact === true || Number(r.distance_m) <= bufferM));
  return Object.freeze({
    total: list.length,
    criticalCount: critical.length,
    warningCount: warning.length,
    clear: list.length === 0,
    severity: critical.length ? 'CRITICAL' : warning.length ? 'WARNING' : 'CLEAR',
    bufferM: Number(bufferM)
  });
}

module.exports = {
  MIN_BUFFER_M,
  MAX_BUFFER_M,
  DEFAULT_BUFFER_M,
  assertBufferM,
  plantConflictWithDigQuery,
  civilInspectionPlantConflictQuery,
  classifyConflicts
};
