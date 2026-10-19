'use strict';

/**
 * Spatial clustering policy using PostGIS ST_ClusterDBSCAN (public docs).
 * For field density: technicians, faults, evidence points within eps meters.
 * Caps protect against unrestricted scans (API4 spirit).
 */

const { assertPoint, assertRadius, MAX_RADIUS_M } = require('./proximityPolicy');

const MAX_EPS_M = 5000;
const MIN_EPS_M = 25;
const MAX_MINPOINTS = 50;
const DEFAULT_MINPOINTS = 3;

function assertEps(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n) || n < MIN_EPS_M || n > MAX_EPS_M) {
    const e = new Error('GIS_CLUSTER_EPS_INVALID');
    e.code = 'GIS_CLUSTER_EPS_INVALID';
    e.statusCode = 400;
    e.min = MIN_EPS_M;
    e.max = MAX_EPS_M;
    throw e;
  }
  return n;
}

function assertMinPoints(n) {
  const v = n == null ? DEFAULT_MINPOINTS : Number(n);
  if (!Number.isInteger(v) || v < 2 || v > MAX_MINPOINTS) {
    const e = new Error('GIS_CLUSTER_MINPOINTS_INVALID');
    e.code = 'GIS_CLUSTER_MINPOINTS_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return v;
}

/**
 * Cluster active technician positions near a focus point.
 * Uses geography cast to geometry in local meters via geography distance is complex
 * for DBSCAN (geometry units). Policy: transform via geography only for filter;
 * clustering runs on geometry in 4326 with eps converted approximately —
 * OR require projected SRID. Safer approach: filter candidates with ST_DWithin
 * then cluster in a meter-based geography workaround:
 *   ST_ClusterDBSCAN(geom, eps_degrees) is wrong for meters.
 * Official DBSCAN expects SRID units. We require operator-supplied projected
 * geometry column OR use a conservative degree approximation only when
 * explicitly opted in.
 *
 * FiberOS policy: cluster on geography-backed points after casting to geometry
 * with ST_Transform to a tenant-declared UTM-like SRID when provided; otherwise
 * refuse (no silent wrong-unit clustering).
 */
function technicianDensityClusterQuery({
  lat,
  lon,
  filterRadiusM = 10000,
  epsMeters = 200,
  minPoints = DEFAULT_MINPOINTS,
  limit = 100,
  projectedSrid
} = {}) {
  const sridEarly = Number(projectedSrid);
  if (!Number.isInteger(sridEarly) || sridEarly < 1) {
    const e = new Error('GIS_CLUSTER_PROJECTED_SRID_REQUIRED');
    e.code = 'GIS_CLUSTER_PROJECTED_SRID_REQUIRED';
    e.statusCode = 400;
    e.note = 'ST_ClusterDBSCAN uses SRID units; declare projectedSrid (e.g. UTM) so epsMeters is meaningful';
    throw e;
  }
  const p = assertPoint(lat, lon);
  const filterR = assertRadius(Math.min(Number(filterRadiusM) || 10000, MAX_RADIUS_M));
  const eps = assertEps(epsMeters);
  const mp = assertMinPoints(minPoints);
  const rawLimit = limit == null ? 100 : Number(limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
    const e = new Error('GIS_CLUSTER_LIMIT_INVALID');
    e.code = 'GIS_CLUSTER_LIMIT_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const lim = rawLimit;
  const srid = sridEarly;

  return Object.freeze({
    text: `
      WITH candidates AS (
        SELECT t.id AS technician_id, t.name, t.current_gps,
               ST_Transform(t.current_gps::geometry, $6) AS geom_m
        FROM technicians t
        WHERE t.current_gps IS NOT NULL
          AND t.is_active = true
          AND t.current_gps_captured_at >= now() - interval '30 minutes'
          AND t.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
          AND ST_DWithin(
                t.current_gps,
                ST_SetSRID(ST_MakePoint($2,$1),4326)::geography,
                $3
              )
        LIMIT $7
      )
      SELECT technician_id, name,
             ST_X(current_gps::geometry) AS lon,
             ST_Y(current_gps::geometry) AS lat,
             ST_ClusterDBSCAN(geom_m, $4, $5) OVER (ORDER BY technician_id) AS cluster_id
      FROM candidates
      ORDER BY cluster_id NULLS LAST, technician_id`,
    values: [p.lat, p.lon, filterR, eps, mp, srid, lim],
    meta: Object.freeze({
      filterRadiusM: filterR,
      epsMeters: eps,
      minPoints: mp,
      projectedSrid: srid,
      method: 'ST_DWithin+ST_ClusterDBSCAN',
      source: 'PostGIS ST_ClusterDBSCAN official documentation'
    })
  });
}

module.exports = {
  MAX_EPS_M,
  MIN_EPS_M,
  technicianDensityClusterQuery,
  assertEps,
  assertMinPoints
};
