'use strict';

/**
 * Linked shared-risk analysis — loads authoritative service-path hops and
 * resource risk metadata from PostgreSQL under the caller's RLS session.
 *
 * Truth boundaries:
 * - Never invents hops, shared-risk groups, or customer links.
 * - Tenant scope comes only from the RLS session (no client tenantId).
 * - Ranking remains structural; failure probabilities are never fabricated.
 * - When required tables are absent, returns a structured NOT_AVAILABLE result.
 */

const {
  analyseSharedRiskFromServicePaths,
  whatIfResourceFails,
  rankCriticalConcentration
} = require('./resilienceAdvanced');

const MAX_PATHS = 5000;
const MAX_HOPS = 200000;
const MAX_HOPS_PER_PATH = 5000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertClient(client) {
  if (!client || typeof client.query !== 'function') {
    const e = new Error('SHARED_RISK_DB_CLIENT_REQUIRED');
    e.code = 'SHARED_RISK_DB_CLIENT_REQUIRED';
    e.statusCode = 503;
    throw e;
  }
}

function bounded(value, fallback, max, code) {
  const n = value == null ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    const e = new Error(code);
    e.code = code;
    e.statusCode = 400;
    throw e;
  }
  return n;
}

function optionalUuid(value, code) {
  if (value == null || value === '') return null;
  const id = String(value);
  if (!UUID.test(id)) {
    const e = new Error(code);
    e.code = code;
    e.statusCode = 400;
    throw e;
  }
  return id;
}

function isMissingRelation(err) {
  const msg = String(err && err.message || '');
  // Hide only a genuinely missing relation. Undefined columns and other schema
  // drift must surface instead of being misreported as an optional table.
  return Boolean(
    err &&
    (err.code === '42P01' ||
      /relation\s+(?:"[^"]+"|[^\s]+)\s+does not exist/i.test(msg))
  );
}

async function querySafe(client, text, values) {
  try {
    return await client.query(text, values);
  } catch (err) {
    if (isMissingRelation(err)) {
      return { rows: [], _missingRelation: true, _error: err };
    }
    throw err;
  }
}

/**
 * Load live/accepted service-path versions and their ordered hops.
 * RLS on network_service_path_* determines tenant visibility.
 */
async function loadLinkedServicePaths(client, {
  serviceId = null,
  assetId = null,
  states = ['live', 'accepted'],
  maxPaths = 2000
} = {}) {
  assertClient(client);
  const limit = bounded(maxPaths, 2000, MAX_PATHS, 'SHARED_RISK_MAX_PATHS_INVALID');
  const sid = optionalUuid(serviceId, 'SHARED_RISK_SERVICE_ID_INVALID');
  const aid = optionalUuid(assetId, 'SHARED_RISK_ASSET_ID_INVALID');
  const stateList = (Array.isArray(states) && states.length ? states : ['live', 'accepted']).map(String);

  const pathSql = `
    SELECT
      v.id AS service_path_version_id,
      v.service_id,
      v.state,
      s.customer_ref AS customer_id,
      (SELECT count(*) FROM network_service_path_hops h0 WHERE h0.service_path_version_id = v.id)::integer AS hop_count
    FROM network_service_path_versions v
    JOIN services s ON s.id = v.service_id
    WHERE v.state = ANY($1::text[])
      AND ($2::uuid IS NULL OR v.service_id = $2::uuid)
      AND (
        $3::uuid IS NULL
        OR EXISTS (
          SELECT 1 FROM network_service_path_hops h
          WHERE h.service_path_version_id = v.id
            AND (
              h.from_asset_id = $3::uuid OR h.to_asset_id = $3::uuid
              OR h.from_port_id = $3::uuid OR h.to_port_id = $3::uuid
              OR h.from_core_id = $3::uuid OR h.to_core_id = $3::uuid
            )
        )
      )
    ORDER BY v.service_id, v.version_no DESC
    LIMIT $4
  `;

  const pathResult = await querySafe(client, pathSql, [stateList, sid, aid, limit]);
  if (pathResult._missingRelation) {
    return Object.freeze({
      available: false,
      reason: 'SERVICE_PATH_SCHEMA_NOT_AVAILABLE',
      servicePaths: Object.freeze([]),
      pathCount: 0
    });
  }

  const versions = pathResult.rows || [];
  if (!versions.length) {
    return Object.freeze({
      available: true,
      reason: null,
      servicePaths: Object.freeze([]),
      pathCount: 0
    });
  }

  const totalHopCount = versions.reduce((sum, row) => sum + Number(row.hop_count || 0), 0);
  const oversizedPath = versions.find((row) => Number(row.hop_count || 0) > MAX_HOPS_PER_PATH);
  if (oversizedPath || totalHopCount > MAX_HOPS) {
    return Object.freeze({
      available: false,
      reason: 'SERVICE_PATH_HOPS_BOUND_EXCEEDED',
      servicePaths: Object.freeze([]),
      pathCount: versions.length,
      hopCount: totalHopCount,
      maxHopsPerPath: MAX_HOPS_PER_PATH,
      maxHopsTotal: MAX_HOPS,
      offendingServicePathVersionId: oversizedPath ? String(oversizedPath.service_path_version_id) : null
    });
  }

  const versionIds = versions.map((r) => r.service_path_version_id);
  const hopSql = `
    SELECT
      service_path_version_id,
      ordinal,
      from_asset_id,
      from_port_id,
      from_core_id,
      to_asset_id,
      to_port_id,
      to_core_id,
      relation
    FROM network_service_path_hops
    WHERE service_path_version_id = ANY($1::uuid[])
    ORDER BY service_path_version_id, ordinal
  `;
  const hopResult = await querySafe(client, hopSql, [versionIds]);
  if (hopResult._missingRelation) {
    return Object.freeze({
      available: false,
      reason: 'SERVICE_PATH_HOPS_SCHEMA_NOT_AVAILABLE',
      servicePaths: Object.freeze([]),
      pathCount: 0
    });
  }

  const hopsByVersion = new Map();
  for (const h of hopResult.rows || []) {
    const key = String(h.service_path_version_id);
    if (!hopsByVersion.has(key)) hopsByVersion.set(key, []);
    hopsByVersion.get(key).push(
      Object.freeze({
        ordinal: Number(h.ordinal),
        fromAssetId: h.from_asset_id != null ? String(h.from_asset_id) : null,
        fromPortId: h.from_port_id != null ? String(h.from_port_id) : null,
        fromCoreId: h.from_core_id != null ? String(h.from_core_id) : null,
        toAssetId: h.to_asset_id != null ? String(h.to_asset_id) : null,
        toPortId: h.to_port_id != null ? String(h.to_port_id) : null,
        toCoreId: h.to_core_id != null ? String(h.to_core_id) : null,
        relation: h.relation != null ? String(h.relation) : null
      })
    );
  }

  const incompleteVersion = versions.find((v) => {
    const expected = Number(v.hop_count || 0);
    const actual = (hopsByVersion.get(String(v.service_path_version_id)) || []).length;
    return expected !== actual;
  });
  if (incompleteVersion) {
    const key = String(incompleteVersion.service_path_version_id);
    return Object.freeze({
      available: false,
      reason: 'SERVICE_PATH_HOPS_INCOMPLETE',
      servicePaths: Object.freeze([]),
      pathCount: versions.length,
      expectedHopCount: Number(incompleteVersion.hop_count || 0),
      actualHopCount: (hopsByVersion.get(key) || []).length,
      offendingServicePathVersionId: key
    });
  }

  const servicePaths = versions.map((v) =>
    Object.freeze({
      servicePathVersionId: String(v.service_path_version_id),
      serviceId: v.service_id != null ? String(v.service_id) : null,
      customerId: v.customer_id != null ? String(v.customer_id) : null,
      state: String(v.state),
      hopCount: Number(v.hop_count || 0),
      hops: Object.freeze(hopsByVersion.get(String(v.service_path_version_id)) || [])
    })
  );

  return Object.freeze({
    available: true,
    reason: null,
    servicePaths: Object.freeze(servicePaths),
    pathCount: servicePaths.length
  });
}

/**
 * Load resource metadata for the identifiers collected from hops.
 * sharedRiskGroup precedence: failure-domain membership → edge shared_risk_group.
 */
async function loadLinkedResources(client, resourceIds = []) {
  assertClient(client);
  const ids = [...new Set((resourceIds || []).map(String).filter((id) => UUID.test(id)))];
  if (!ids.length) {
    return Object.freeze({ available: true, resources: Object.freeze([]), resourceCount: 0 });
  }

  // Asset type/code
  const assetResult = await querySafe(
    client,
    `SELECT id, asset_type, asset_code
     FROM network_assets
     WHERE id = ANY($1::uuid[])`,
    [ids]
  );

  const byId = new Map();
  for (const id of ids) {
    byId.set(id, {
      id,
      type: 'unknown',
      sharedRiskGroup: null,
      criticality: null,
      alternativePathAvailable: false,
      failureDomainKeys: new Set(),
      failureDomainConflict: false
    });
  }

  if (!assetResult._missingRelation) {
    for (const a of assetResult.rows || []) {
      const id = String(a.id);
      const cur = byId.get(id) || { id };
      cur.type = a.asset_type != null ? String(a.asset_type).toLowerCase() : 'unknown';
      byId.set(id, cur);
    }
  }

  // Failure domain membership → sharedRiskGroup + criticality + alternative
  const domainResult = await querySafe(
    client,
    `SELECT m.resource_id, d.domain_key, d.criticality, d.alternative_path_available
     FROM network_failure_domain_members m
     JOIN network_failure_domains d ON d.id = m.failure_domain_id
     WHERE m.resource_id = ANY($1::uuid[])`,
    [ids]
  );
  if (!domainResult._missingRelation) {
    for (const row of domainResult.rows || []) {
      const id = String(row.resource_id);
      const cur = byId.get(id);
      if (!cur) continue;
      if (row.domain_key != null) cur.failureDomainKeys.add(String(row.domain_key));
      if (row.criticality != null && Number.isFinite(Number(row.criticality))) {
        cur.criticality = Number(row.criticality);
      }
      if (row.alternative_path_available === true) cur.alternativePathAvailable = true;
      byId.set(id, cur);
    }
  }

  // Never silently select one failure domain when a resource belongs to multiple
  // distinct domains. That ambiguity must remain explicit in the result.
  for (const cur of byId.values()) {
    const groups = [...cur.failureDomainKeys];
    if (groups.length === 1) cur.sharedRiskGroup = groups[0];
    else if (groups.length > 1) {
      cur.sharedRiskGroup = null;
      cur.failureDomainConflict = true;
    }
  }

  // Edge shared_risk_group for assets that still lack a domain group
  const edgeResult = await querySafe(
    client,
    `SELECT from_asset_id, to_asset_id, shared_risk_group
     FROM physical_topology_edges
     WHERE active = true
       AND shared_risk_group IS NOT NULL
       AND (from_asset_id = ANY($1::uuid[]) OR to_asset_id = ANY($1::uuid[]))`,
    [ids]
  );
  if (!edgeResult._missingRelation) {
    for (const e of edgeResult.rows || []) {
      const group = e.shared_risk_group != null ? String(e.shared_risk_group) : null;
      if (!group) continue;
      for (const col of [e.from_asset_id, e.to_asset_id]) {
        if (col == null) continue;
        const id = String(col);
        const cur = byId.get(id);
        if (!cur) continue;
        if (!cur.sharedRiskGroup && !cur.failureDomainConflict) cur.sharedRiskGroup = group;
        byId.set(id, cur);
      }
    }
  }

  const resources = Object.freeze(
    [...byId.values()].map((r) =>
      Object.freeze({
        id: r.id,
        type: r.type,
        sharedRiskGroup: r.sharedRiskGroup,
        criticality: r.criticality,
        alternativePathAvailable: r.alternativePathAvailable === true,
        failureDomainConflict: r.failureDomainConflict === true
      })
    )
  );

  return Object.freeze({
    available: true,
    resources,
    resourceCount: resources.length
  });
}

/**
 * Load duct/corridor-style containers from assets that appear on paths,
 * using parent containment edges when present (relation containment/duct).
 */
async function loadLinkedContainers(client, resourceIds = []) {
  assertClient(client);
  const ids = [...new Set((resourceIds || []).map(String).filter((id) => UUID.test(id)))];
  if (!ids.length) {
    return Object.freeze({ available: true, containers: Object.freeze([]) });
  }

  // Assets typed as duct / corridor acting as containers of path resources via edges
  const result = await querySafe(
    client,
    `SELECT e.from_asset_id AS container_id,
            a.asset_type AS container_type,
            e.to_asset_id AS member_id
     FROM physical_topology_edges e
     JOIN network_assets a ON a.id = e.from_asset_id
     WHERE e.active = true
       AND e.to_asset_id = ANY($1::uuid[])
       AND (
         lower(COALESCE(e.relation, '')) IN ('contains','containment','duct','corridor','in_duct')
         OR lower(COALESCE(a.asset_type, '')) IN ('duct','corridor','trench','conduit')
       )`,
    [ids]
  );

  if (result._missingRelation) {
    return Object.freeze({ available: false, containers: Object.freeze([]) });
  }

  const byContainer = new Map();
  for (const row of result.rows || []) {
    const cid = String(row.container_id);
    if (!byContainer.has(cid)) {
      byContainer.set(cid, {
        id: cid,
        type: row.container_type != null ? String(row.container_type).toLowerCase() : 'container',
        resourceIds: new Set()
      });
    }
    if (row.member_id != null) byContainer.get(cid).resourceIds.add(String(row.member_id));
  }

  const containers = Object.freeze(
    [...byContainer.values()].map((c) =>
      Object.freeze({
        id: c.id,
        type: c.type,
        resourceIds: Object.freeze([...c.resourceIds])
      })
    )
  );

  return Object.freeze({ available: true, containers });
}

function collectResourceIdsFromPaths(servicePaths) {
  const ids = new Set();
  for (const sp of servicePaths || []) {
    for (const h of sp.hops || []) {
      for (const k of [
        'fromAssetId',
        'toAssetId',
        'fromPortId',
        'toPortId',
        'fromCoreId',
        'toCoreId'
      ]) {
        if (h[k]) ids.add(String(h[k]));
      }
    }
  }
  return [...ids];
}

/**
 * Full linked analysis against the live/accepted service-path graph under RLS.
 */
async function analyseLinkedSharedRisk(client, input = {}) {
  assertClient(client);
  const topN = bounded(input.topN, 10, 500, 'SHARED_RISK_TOP_N_INVALID');
  const pathLoad = await loadLinkedServicePaths(client, {
    serviceId: input.serviceId,
    assetId: input.assetId,
    states: input.states,
    maxPaths: input.maxPaths
  });

  if (!pathLoad.available) {
    return Object.freeze({
      schema: 'fiberos.linked-shared-risk.v1',
      available: false,
      reason: pathLoad.reason,
      pathCount: pathLoad.pathCount != null ? pathLoad.pathCount : 0,
      hopCount: pathLoad.hopCount != null ? pathLoad.hopCount : null,
      expectedHopCount: pathLoad.expectedHopCount != null ? pathLoad.expectedHopCount : null,
      actualHopCount: pathLoad.actualHopCount != null ? pathLoad.actualHopCount : null,
      offendingServicePathVersionId: pathLoad.offendingServicePathVersionId != null ? String(pathLoad.offendingServicePathVersionId) : null,
      maxHopsPerPath: pathLoad.maxHopsPerPath != null ? pathLoad.maxHopsPerPath : null,
      maxHopsTotal: pathLoad.maxHopsTotal != null ? pathLoad.maxHopsTotal : null,
      authority: 'POSTGRESQL_RLS_SESSION',
      exposure: null,
      concentration: null,
      linkage: Object.freeze({
        pathCount: pathLoad.pathCount != null ? pathLoad.pathCount : 0,
        resourceCount: 0,
        containerCount: 0
      }),
      note: 'Required service-path schema is not available in this database; no synthetic paths were invented.'
    });
  }

  const resourceIds = collectResourceIdsFromPaths(pathLoad.servicePaths);
  const resourceLoad = await loadLinkedResources(client, resourceIds);
  const containerLoad = await loadLinkedContainers(client, resourceIds);

  const exposure = analyseSharedRiskFromServicePaths({
    servicePaths: pathLoad.servicePaths,
    resources: resourceLoad.resources,
    acceptedStates: input.states || ['live', 'accepted'],
    topN
  });

  const concentration =
    containerLoad.available && containerLoad.containers.length
      ? rankCriticalConcentration({
          containers: containerLoad.containers,
          dependencies: exposure.pathDerivation.dependencies,
          topN
        })
      : null;

  let whatIf = null;
  if (input.whatIfResourceId) {
    const rid = optionalUuid(input.whatIfResourceId, 'SHARED_RISK_WHAT_IF_RESOURCE_INVALID');
    whatIf = whatIfResourceFails({
      resourceId: rid,
      dependencies: exposure.pathDerivation.dependencies,
      resources: resourceLoad.resources
    });
  }

  return Object.freeze({
    schema: 'fiberos.linked-shared-risk.v1',
    available: true,
    reason: null,
    authority: 'POSTGRESQL_RLS_SESSION',
    linkage: Object.freeze({
      pathCount: pathLoad.pathCount,
      resourceCount: resourceLoad.resourceCount,
      containerCount: containerLoad.containers.length,
      states: Object.freeze((input.states || ['live', 'accepted']).map(String)),
      filteredServiceId: input.serviceId != null ? String(input.serviceId) : null,
      filteredAssetId: input.assetId != null ? String(input.assetId) : null
    }),
    exposure,
    concentration,
    whatIf,
    assumptions: Object.freeze([
      'Service paths and hops are loaded from network_service_path_versions / network_service_path_hops under RLS.',
      'sharedRiskGroup comes from failure-domain membership when present, else physical_topology_edges.shared_risk_group.',
      'No failure probabilities, cut rates, or costs are invented.',
      'Output is structural ranking only; it does not mutate network state.'
    ])
  });
}

module.exports = {
  loadLinkedServicePaths,
  loadLinkedResources,
  loadLinkedContainers,
  analyseLinkedSharedRisk,
  collectResourceIdsFromPaths
};
