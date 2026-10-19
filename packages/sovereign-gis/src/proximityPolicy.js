'use strict';

/**
 * Proximity query policy — public PostGIS guidance:
 * use ST_DWithin for filter (index-aware), KNN <-> for order, geography for meters.
 * Caps protect against unrestricted resource consumption.
 */

const MAX_RADIUS_M = 50000;
const MIN_RADIUS_M = 50;
const MAX_RESULT_LIMIT = 50;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_POSITION_AGE_MINUTES = 15;

function assertPoint(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
    const e = new Error('GIS_POINT_INVALID');
    e.code = 'GIS_POINT_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return { lat: la, lon: lo };
}

function assertRadius(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n) || n < MIN_RADIUS_M || n > MAX_RADIUS_M) {
    const e = new Error('GIS_RADIUS_INVALID');
    e.code = 'GIS_RADIUS_INVALID';
    e.statusCode = 400;
    e.min = MIN_RADIUS_M;
    e.max = MAX_RADIUS_M;
    throw e;
  }
  return n;
}

function assertLimit(limit) {
  const n = limit == null ? DEFAULT_RESULT_LIMIT : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > MAX_RESULT_LIMIT) {
    const e = new Error('GIS_RESULT_LIMIT_INVALID');
    e.code = 'GIS_RESULT_LIMIT_INVALID';
    e.statusCode = 400;
    e.max = MAX_RESULT_LIMIT;
    throw e;
  }
  return n;
}

/**
 * Parameterized nearest-technicians query.
 * Filter: ST_DWithin(geography); Order: KNN <-> ; tenant from session.
 */
function nearestTechniciansQuery({ lat, lon, maxMeters = 5000, limit = DEFAULT_RESULT_LIMIT, maxAgeMinutes = MAX_POSITION_AGE_MINUTES } = {}) {
  const p = assertPoint(lat, lon);
  const radius = assertRadius(maxMeters);
  const lim = assertLimit(limit);
  const age = Math.min(Math.max(Number(maxAgeMinutes) || MAX_POSITION_AGE_MINUTES, 1), 60);
  return Object.freeze({
    text: `
      SELECT t.id AS technician_id, t.name,
             ST_X(t.current_gps::geometry) AS lon,
             ST_Y(t.current_gps::geometry) AS lat,
             ST_Distance(t.current_gps, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography) AS distance_m,
             t.zone, t.skills, t.battery_status, t.current_gps_captured_at AS captured_at,
             t.accuracy_meters, t.heading_degrees, t.speed_mps
      FROM technicians t
      WHERE t.current_gps IS NOT NULL
        AND t.current_gps_captured_at >= now() - ($4::text || ' minutes')::interval
        AND t.is_active = true
        AND t.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND ST_DWithin(t.current_gps, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $3)
      ORDER BY t.current_gps <-> ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, t.id ASC
      LIMIT $5`,
    values: [p.lat, p.lon, radius, String(age), lim],
    meta: Object.freeze({
      radiusM: radius,
      limit: lim,
      maxAgeMinutes: age,
      method: 'ST_DWithin+KNN',
      distanceUnits: 'meters',
      type: 'geography',
      source: 'PostGIS public docs: ST_DWithin index-aware radius; <-> KNN order'
    })
  });
}

module.exports = {
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  MAX_RESULT_LIMIT,
  nearestTechniciansQuery,
  assertPoint,
  assertRadius,
  assertLimit
};
