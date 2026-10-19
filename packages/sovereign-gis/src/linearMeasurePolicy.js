'use strict';

/**
 * Linear referencing helpers for fiber plant (measure M along path).
 * Complements snap: locate-along, between measures, OTDR position binding.
 */

const { assertPoint, assertLimit } = require('./proximityPolicy');

function assertFraction(f) {
  const n = Number(f);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    const e = new Error('GIS_MEASURE_FRACTION_INVALID');
    e.code = 'GIS_MEASURE_FRACTION_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return n;
}

function assertMetersAlong(m, maxM = 200000) {
  const n = Number(m);
  if (!Number.isFinite(n) || n < 0 || n > maxM) {
    const e = new Error('GIS_MEASURE_METERS_INVALID');
    e.code = 'GIS_MEASURE_METERS_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return n;
}

/**
 * Point at fraction along a specific cable segment (tenant-scoped).
 */
function interpolateAlongSegmentQuery({ segmentId, fraction, layer = 'FIBER_CABLE' } = {}) {
  if (!segmentId || typeof segmentId !== 'string') {
    const e = new Error('GIS_SEGMENT_ID_REQUIRED');
    e.code = 'GIS_SEGMENT_ID_REQUIRED';
    e.statusCode = 400;
    throw e;
  }
  const frac = assertFraction(fraction);
  const table = layer === 'DUCT' ? 'ftth_duct_segments' : 'ftth_cable_segments';
  return Object.freeze({
    text: `
      SELECT s.id AS segment_id, s.segment_code,
             ST_Length(s.geometry::geography) AS length_m,
             $2::float8 AS measure_fraction,
             ($2::float8 * ST_Length(s.geometry::geography)) AS measure_m,
             ST_Y(ST_LineInterpolatePoint(ST_LineMerge(s.geometry), $2)::geometry) AS lat,
             ST_X(ST_LineInterpolatePoint(ST_LineMerge(s.geometry), $2)::geometry) AS lon
      FROM ${table} s
      WHERE s.id = $1::uuid
        AND s.geometry IS NOT NULL
        AND s.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)`,
    values: [segmentId, frac],
    meta: Object.freeze({
      layer: layer === 'DUCT' ? 'DUCT' : 'FIBER_CABLE',
      method: 'ST_LineInterpolatePoint',
      truthBoundary: 'REQUIRES_SEGMENT_GEOMETRY'
    })
  });
}

/**
 * Sub-linestring between two fractions (e.g. OTDR event span).
 */
function locateBetweenFractionsQuery({ segmentId, fromFraction, toFraction, layer = 'FIBER_CABLE' } = {}) {
  if (!segmentId) {
    const e = new Error('GIS_SEGMENT_ID_REQUIRED');
    e.code = 'GIS_SEGMENT_ID_REQUIRED';
    e.statusCode = 400;
    throw e;
  }
  const a = assertFraction(fromFraction);
  const b = assertFraction(toFraction);
  if (b < a) {
    const e = new Error('GIS_MEASURE_RANGE_INVALID');
    e.code = 'GIS_MEASURE_RANGE_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const table = layer === 'DUCT' ? 'ftth_duct_segments' : 'ftth_cable_segments';
  return Object.freeze({
    text: `
      SELECT s.id AS segment_id, s.segment_code,
             ST_Length(s.geometry::geography) AS length_m,
             $2::float8 AS from_fraction, $3::float8 AS to_fraction,
             ST_AsGeoJSON(
               ST_LineSubstring(ST_LineMerge(s.geometry), $2, $3)
             ) AS substring_geojson
      FROM ${table} s
      WHERE s.id = $1::uuid
        AND s.geometry IS NOT NULL
        AND s.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)`,
    values: [segmentId, a, b],
    meta: Object.freeze({
      method: 'ST_LineSubstring',
      truthBoundary: 'REQUIRES_SEGMENT_GEOMETRY'
    })
  });
}

/**
 * Bind OTDR distance-along-fiber (meters from start) to map coordinates.
 * Assumes OTDR start aligns with segment start (documented boundary).
 */
function otdrMetersToMapQuery({ segmentId, metersFromStart, layer = 'FIBER_CABLE' } = {}) {
  if (!segmentId) {
    const e = new Error('GIS_SEGMENT_ID_REQUIRED');
    e.code = 'GIS_SEGMENT_ID_REQUIRED';
    e.statusCode = 400;
    throw e;
  }
  const meters = assertMetersAlong(metersFromStart);
  const table = layer === 'DUCT' ? 'ftth_duct_segments' : 'ftth_cable_segments';
  return Object.freeze({
    text: `
      SELECT s.id AS segment_id, s.segment_code,
             ST_Length(s.geometry::geography) AS length_m,
             $2::float8 AS otdr_meters,
             CASE WHEN ST_Length(s.geometry::geography) > 0
               THEN LEAST(1.0, GREATEST(0.0, $2::float8 / ST_Length(s.geometry::geography)))
               ELSE NULL END AS measure_fraction,
             CASE WHEN ST_Length(s.geometry::geography) > 0 THEN
               ST_Y(ST_LineInterpolatePoint(
                 ST_LineMerge(s.geometry),
                 LEAST(1.0, GREATEST(0.0, $2::float8 / ST_Length(s.geometry::geography)))
               )::geometry)
             ELSE NULL END AS lat,
             CASE WHEN ST_Length(s.geometry::geography) > 0 THEN
               ST_X(ST_LineInterpolatePoint(
                 ST_LineMerge(s.geometry),
                 LEAST(1.0, GREATEST(0.0, $2::float8 / ST_Length(s.geometry::geography)))
               )::geometry)
             ELSE NULL END AS lon,
             ($2::float8 > ST_Length(s.geometry::geography)) AS beyond_segment
      FROM ${table} s
      WHERE s.id = $1::uuid
        AND s.geometry IS NOT NULL
        AND s.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)`,
    values: [segmentId, meters],
    meta: Object.freeze({
      method: 'OTDR_METERS_TO_FRACTION_VIA_LENGTH',
      assumption: 'OTDR_ZERO_EQUALS_SEGMENT_START',
      truthBoundary: 'MAP_ALIGNMENT_REQUIRES_AS_BUILT_CALIBRATION'
    })
  });
}


/**
 * OTDR distance locating across an explicitly ordered as-built segment chain.
 * Segment order and orientation must come from reviewed splice/as-built evidence;
 * this query never guesses a chain from segment identifiers.
 */
function otdrChainToMapQuery({
  segmentIds, directions, metersFromStart, layer = 'FIBER_CABLE', continuityToleranceM = 2
} = {}) {
  const fail = (code, status = 400) => { const error = new Error(code); error.code = code; error.statusCode = status; throw error; };
  if (!Array.isArray(segmentIds) || segmentIds.length < 1) fail('GIS_SEGMENT_CHAIN_REQUIRED');
  if (segmentIds.length > 128) fail('GIS_SEGMENT_CHAIN_TOO_LONG', 413);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = segmentIds.map((id) => { if (typeof id !== 'string' || !uuidPattern.test(id)) fail('GIS_SEGMENT_ID_INVALID'); return id.toLowerCase(); });
  if (new Set(ids).size !== ids.length) fail('GIS_SEGMENT_CHAIN_DUPLICATE');
  let traversal;
  if (directions === undefined) traversal = ids.map(() => 1);
  else {
    if (!Array.isArray(directions) || directions.length !== ids.length || directions.some((d) => d !== 1 && d !== -1)) fail('GIS_SEGMENT_DIRECTION_INVALID');
    traversal = [...directions];
  }
  const normalizedLayer = String(layer || 'FIBER_CABLE').toUpperCase();
  if (!['FIBER_CABLE', 'DUCT'].includes(normalizedLayer)) fail('GIS_LAYER_INVALID');
  const tolerance = Number(continuityToleranceM);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 10) fail('GIS_CHAIN_CONTINUITY_TOLERANCE_INVALID');
  const meters = assertMetersAlong(metersFromStart);
  const table = normalizedLayer === 'DUCT' ? 'public.ftth_duct_segments' : 'public.ftth_cable_segments';
  return Object.freeze({
    text: `
      WITH requested AS (
        SELECT r.segment_id, r.direction, r.ordinality::int AS ordinality
        FROM unnest($1::uuid[], $2::smallint[]) WITH ORDINALITY AS r(segment_id, direction, ordinality)
      ),
      raw AS (
        SELECT r.*, s.id AS found_segment_id, s.segment_code, s.geometry,
               CASE WHEN s.geometry IS NOT NULL THEN ST_LineMerge(s.geometry) END AS merged_geometry,
               CASE WHEN s.geometry IS NOT NULL THEN ST_Length(s.geometry::geography) END AS length_m
        FROM requested r
        LEFT JOIN ${table} s ON s.id = r.segment_id
          AND s.tenant_id = (SELECT up.tenant_id FROM public.user_preferences up WHERE up.user_id = auth.uid() LIMIT 1)
      ),
      oriented AS (
        SELECT raw.*,
               CASE WHEN direction = -1 THEN ST_Reverse(merged_geometry) ELSE merged_geometry END AS oriented_geometry,
               COALESCE(geometry IS NOT NULL AND ST_IsValid(geometry)
                 AND GeometryType(merged_geometry) = 'LINESTRING'
                 AND ST_NPoints(merged_geometry) >= 2 AND length_m > 0, false) AS geometry_valid
        FROM raw
      ),
      sequenced AS (
        SELECT oriented.*,
               COALESCE(SUM(length_m) OVER (ORDER BY ordinality ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::float8 AS chain_start_m,
               (SUM(length_m) OVER ())::float8 AS chain_total_m,
               LAG(ST_EndPoint(oriented_geometry)) OVER (ORDER BY ordinality) AS previous_end
        FROM oriented
      ),
      checked AS (
        SELECT sequenced.*,
          CASE WHEN ordinality = 1 THEN 0::float8
               WHEN geometry_valid AND previous_end IS NOT NULL
                 THEN ST_Distance(previous_end::geography, ST_StartPoint(oriented_geometry)::geography)
               ELSE NULL END AS gap_m
        FROM sequenced
      ),
      summary AS (
        SELECT COUNT(*)::int AS requested_count, COUNT(found_segment_id)::int AS found_count,
               COALESCE(BOOL_AND(geometry_valid), false) AS all_geometry_valid,
               COALESCE(BOOL_AND(ordinality = 1 OR (gap_m IS NOT NULL AND gap_m <= $4::float8)), false) AS chain_connected,
               COALESCE(MAX(chain_total_m), 0)::float8 AS total_m
        FROM checked
      ),
      target AS (
        SELECT c.* FROM checked c CROSS JOIN summary sm
        WHERE c.geometry_valid AND $3::float8 >= c.chain_start_m
          AND ($3::float8 < c.chain_start_m + c.length_m
            OR (c.ordinality = sm.requested_count AND $3::float8 = sm.total_m))
        ORDER BY c.ordinality LIMIT 1
      )
      SELECT CASE
          WHEN sm.found_count <> sm.requested_count THEN 'CHAIN_SEGMENT_MISSING'
          WHEN NOT sm.all_geometry_valid THEN 'CHAIN_GEOMETRY_INVALID'
          WHEN NOT sm.chain_connected THEN 'CHAIN_DISCONNECTED'
          WHEN $3::float8 > sm.total_m THEN 'OTDR_DISTANCE_OUT_OF_RANGE'
          WHEN t.found_segment_id IS NULL THEN 'OTDR_DISTANCE_UNRESOLVED'
          ELSE 'LOCATED' END AS status,
        t.found_segment_id AS segment_id, t.segment_code, t.ordinality AS sequence_index, t.direction,
        t.length_m AS segment_length_m, t.chain_start_m, sm.total_m AS chain_total_m,
        CASE WHEN t.found_segment_id IS NOT NULL THEN GREATEST(0::float8, LEAST(t.length_m, $3::float8 - t.chain_start_m)) END AS segment_measure_m,
        CASE WHEN t.length_m > 0 THEN GREATEST(0::float8, LEAST(1::float8, ($3::float8 - t.chain_start_m) / t.length_m)) END AS measure_fraction,
        CASE WHEN t.length_m > 0 THEN ST_Y(ST_LineInterpolatePoint(t.oriented_geometry,
          GREATEST(0::float8, LEAST(1::float8, ($3::float8 - t.chain_start_m) / t.length_m)))) END AS lat,
        CASE WHEN t.length_m > 0 THEN ST_X(ST_LineInterpolatePoint(t.oriented_geometry,
          GREATEST(0::float8, LEAST(1::float8, ($3::float8 - t.chain_start_m) / t.length_m)))) END AS lon,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'sequenceIndex', c.ordinality, 'segmentId', c.segment_id, 'segmentCode', c.segment_code,
          'direction', c.direction, 'lengthM', c.length_m, 'chainStartM', c.chain_start_m, 'gapM', c.gap_m
        ) ORDER BY c.ordinality) FROM checked c), '[]'::jsonb) AS chain_segments
      FROM summary sm LEFT JOIN target t ON true`,
    values: [ids, traversal, meters, tolerance],
    meta: Object.freeze({
      layer: normalizedLayer, method: 'OTDR_CHAIN_CUMULATIVE_MEASURE',
      orderAuthority: 'CALLER_SUPPLIED_REVIEWED_AS_BUILT_SEQUENCE',
      continuityToleranceM: tolerance, assumption: 'OTDR_ZERO_EQUALS_FIRST_SEGMENT_START',
      truthBoundary: 'REQUIRES_AS_BUILT_SEQUENCE_AND_CONNECTED_TENANT_OWNED_GEOMETRY'
    })
  });
}

/**
 * Pure helper: meters ↔ fraction given length.
 */
function metersToFraction(meters, lengthM) {
  const m = Number(meters);
  const L = Number(lengthM);
  if (!Number.isFinite(m) || !Number.isFinite(L) || L <= 0) return null;
  return Math.min(1, Math.max(0, m / L));
}

function fractionToMeters(fraction, lengthM) {
  const f = Number(fraction);
  const L = Number(lengthM);
  if (!Number.isFinite(f) || !Number.isFinite(L) || L < 0) return null;
  return f * L;
}

module.exports = {
  assertFraction,
  assertMetersAlong,
  interpolateAlongSegmentQuery,
  locateBetweenFractionsQuery,
  otdrMetersToMapQuery,
  otdrChainToMapQuery,
  metersToFraction,
  fractionToMeters
};
