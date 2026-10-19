'use strict';

/**
 * Topology integrity checks on application graph (physical_topology_edges)
 * + geometry quality on plant segments. Not full PostGIS Topology extension.
 */

function danglingEdgesQuery() {
  return Object.freeze({
    text: `
      SELECT e.id AS edge_id, e.from_asset_id, e.to_asset_id,
             (fa.id IS NULL) AS from_missing,
             (ta.id IS NULL) AS to_missing
      FROM physical_topology_edges e
      LEFT JOIN network_assets fa ON fa.id = e.from_asset_id AND fa.tenant_id = e.tenant_id
      LEFT JOIN network_assets ta ON ta.id = e.to_asset_id AND ta.tenant_id = e.tenant_id
      WHERE e.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND (fa.id IS NULL OR ta.id IS NULL)
      LIMIT 200`,
    values: [],
    meta: Object.freeze({ check: 'DANGLING_EDGE_ENDPOINTS', truthBoundary: 'APPLICATION_GRAPH' })
  });
}

function selfLoopEdgesQuery() {
  return Object.freeze({
    text: `
      SELECT e.id AS edge_id, e.from_asset_id
      FROM physical_topology_edges e
      WHERE e.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND e.from_asset_id IS NOT NULL
        AND e.from_asset_id = e.to_asset_id
      LIMIT 200`,
    values: [],
    meta: Object.freeze({ check: 'SELF_LOOP', truthBoundary: 'APPLICATION_GRAPH' })
  });
}

function invalidPlantGeometryQuery() {
  return Object.freeze({
    text: `
      SELECT 'FIBER_CABLE' AS layer, c.id AS segment_id, c.segment_code,
             ST_IsValid(c.geometry) AS is_valid,
             ST_IsValidReason(c.geometry) AS reason
      FROM ftth_cable_segments c
      WHERE c.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND c.geometry IS NOT NULL
        AND ST_IsValid(c.geometry) = false
      UNION ALL
      SELECT 'DUCT', d.id, d.segment_code,
             ST_IsValid(d.geometry), ST_IsValidReason(d.geometry)
      FROM ftth_duct_segments d
      WHERE d.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND d.geometry IS NOT NULL
        AND ST_IsValid(d.geometry) = false
      LIMIT 200`,
    values: [],
    meta: Object.freeze({ check: 'ST_IsValid', truthBoundary: 'PLANT_GEOMETRY' })
  });
}

function emptyOrDegenerateGeometryQuery() {
  return Object.freeze({
    text: `
      SELECT 'FIBER_CABLE' AS layer, c.id AS segment_id, c.segment_code,
             ST_NPoints(c.geometry) AS npoints,
             ST_Length(c.geometry::geography) AS length_m
      FROM ftth_cable_segments c
      WHERE c.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND c.geometry IS NOT NULL
        AND (ST_NPoints(c.geometry) < 2 OR ST_Length(c.geometry::geography) < 0.01)
      UNION ALL
      SELECT 'DUCT', d.id, d.segment_code, ST_NPoints(d.geometry),
             ST_Length(d.geometry::geography)
      FROM ftth_duct_segments d
      WHERE d.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
        AND d.geometry IS NOT NULL
        AND (ST_NPoints(d.geometry) < 2 OR ST_Length(d.geometry::geography) < 0.01)
      LIMIT 200`,
    values: [],
    meta: Object.freeze({ check: 'DEGENERATE_GEOMETRY' })
  });
}

/**
 * Summarize integrity scan results in pure JS.
 */
function summarizeIntegrity({ dangling = [], loops = [], invalidGeom = [], degenerate = [] } = {}) {
  const d = dangling.length;
  const l = loops.length;
  const i = invalidGeom.length;
  const g = degenerate.length;
  const total = d + l + i + g;
  return Object.freeze({
    totalFindings: total,
    danglingEdges: d,
    selfLoops: l,
    invalidGeometries: i,
    degenerateGeometries: g,
    severity: total === 0 ? 'CLEAR' : i + d > 0 ? 'HIGH' : 'MEDIUM',
    authority: 'TOPOLOGY_INTEGRITY_POLICY',
    note: 'Application graph checks — not PostGIS Topology extension'
  });
}

module.exports = {
  danglingEdgesQuery,
  selfLoopEdgesQuery,
  invalidPlantGeometryQuery,
  emptyOrDegenerateGeometryQuery,
  summarizeIntegrity
};
