'use strict';

/**
 * Routing adapter boundary — declares supported engines without inventing paths.
 * Actual path computation requires live graph + optional pgRouting extension.
 */

const ENGINES = Object.freeze(['NONE', 'APPLICATION_GRAPH', 'PGROUTING', 'OSRM', 'GRAPHHOPPER']);

function assertEngine(engine) {
  const e = String(engine || 'NONE').toUpperCase();
  if (!ENGINES.includes(e)) {
    const err = new Error('GIS_ROUTING_ENGINE_UNKNOWN');
    err.code = 'GIS_ROUTING_ENGINE_UNKNOWN';
    err.statusCode = 400;
    err.allowed = ENGINES.slice();
    throw err;
  }
  return e;
}

/**
 * Shortest path on application topology (asset hops) — pure SQL BFS-limited.
 * Does not claim road routing. Max depth protects CPU.
 */
function applicationGraphPathQuery({ fromAssetId, toAssetId, maxDepth = 12 } = {}) {
  if (!fromAssetId || !toAssetId) {
    const e = new Error('GIS_ROUTE_ENDPOINTS_REQUIRED');
    e.code = 'GIS_ROUTE_ENDPOINTS_REQUIRED';
    e.statusCode = 400;
    throw e;
  }
  const depth = Math.min(Math.max(Number(maxDepth) || 12, 1), 20);
  return Object.freeze({
    text: `
      WITH RECURSIVE walk AS (
        SELECT e.id AS edge_id, e.from_asset_id, e.to_asset_id,
               1 AS depth,
               ARRAY[e.from_asset_id, e.to_asset_id] AS path_assets,
               ARRAY[e.id] AS path_edges
        FROM physical_topology_edges e
        WHERE e.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
          AND e.from_asset_id = $1::uuid
        UNION ALL
        SELECT e.id, e.from_asset_id, e.to_asset_id,
               w.depth + 1,
               w.path_assets || e.to_asset_id,
               w.path_edges || e.id
        FROM physical_topology_edges e
        JOIN walk w ON e.from_asset_id = w.to_asset_id
        WHERE e.tenant_id = (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid() LIMIT 1)
          AND w.depth < $3
          AND NOT e.to_asset_id = ANY (w.path_assets)
      )
      SELECT depth, path_assets, path_edges
      FROM walk
      WHERE to_asset_id = $2::uuid
      ORDER BY depth ASC
      LIMIT 5`,
    values: [fromAssetId, toAssetId, depth],
    meta: Object.freeze({
      engine: 'APPLICATION_GRAPH',
      maxDepth: depth,
      truthBoundary: 'HOP_PATH_ON_PHYSICAL_TOPOLOGY_EDGES_ONLY',
      note: 'Not street routing; not pgRouting unless extension + edge costs provisioned'
    })
  });
}

function routingCapabilityManifest() {
  return Object.freeze({
    engines: ENGINES,
    implementedInSource: ['NONE', 'APPLICATION_GRAPH'],
    pendingRuntime: ['PGROUTING', 'OSRM', 'GRAPHHOPPER'],
    authority: 'ROUTING_ADAPTER_BOUNDARY',
    syntheticPaths: false
  });
}

module.exports = {
  ENGINES,
  assertEngine,
  applicationGraphPathQuery,
  routingCapabilityManifest
};
