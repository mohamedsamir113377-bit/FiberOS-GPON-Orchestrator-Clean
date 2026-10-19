'use strict';

/**
 * Resilience / Shared-Risk scenario primitives (Master Operating Statement §20).
 *
 * Truth boundaries:
 * - No invented failure probabilities, costs, or growth factors.
 * - All numeric risk inputs must be supplied by the caller; omitted → treated as absent.
 * - Outputs are deterministic rankings and structural exposure reports only.
 * - Never mutates live topology; never promotes a ranking to a physical fault fact.
 */

function finite(x, n) {
  const v = Number(x);
  if (!Number.isFinite(v)) throw new TypeError(`${n} must be a finite number`);
  return v;
}

function nonNeg(x, n) {
  const v = finite(x, n);
  if (v < 0) throw new RangeError(`${n} must be >= 0`);
  return v;
}

function positive(x, n) {
  const v = finite(x, n);
  if (v <= 0) throw new RangeError(`${n} must be > 0`);
  return v;
}

function enumerateSimplePaths({ edges, source, target, maxPaths = 1000 }) {
  if (!source || !target) throw new TypeError('source/target required');
  const adj = new Map();
  for (const e of edges || []) {
    if (e.disabled) continue;
    const a = String(e.from);
    const b = String(e.to);
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(e);
  }
  for (const a of adj.values()) {
    a.sort((x, y) => String(x.id || '').localeCompare(String(y.id || '')));
  }
  const out = [];
  const seen = new Set([String(source)]);
  function dfs(n, path) {
    if (out.length >= maxPaths) return;
    if (n === String(target)) {
      out.push(path.slice());
      return;
    }
    for (const e of adj.get(n) || []) {
      const v = String(e.to);
      if (seen.has(v)) continue;
      seen.add(v);
      path.push(e);
      dfs(v, path);
      path.pop();
      seen.delete(v);
    }
  }
  dfs(String(source), []);
  return out;
}

function pathFailureProbability(path, edgeFailureProbability) {
  let survival = 1;
  for (const e of path) {
    const p = finite(edgeFailureProbability(e), `failureProbability(${e.id})`);
    if (p < 0 || p > 1) throw new RangeError('edge failure probability must be in [0,1]');
    survival *= 1 - p;
  }
  return 1 - survival;
}

function independentPathReliability({
  edges,
  source,
  target,
  edgeFailureProbability,
  maxPaths = 1000
}) {
  const paths = enumerateSimplePaths({ edges, source, target, maxPaths });
  if (!paths.length) {
    return Object.freeze({
      paths: 0,
      reliability: 0,
      independenceAssumption: true
    });
  }
  const probs = paths.map((p) => pathFailureProbability(p, edgeFailureProbability));
  let survival = 1;
  for (const pf of probs) survival *= pf;
  return Object.freeze({
    paths: paths.length,
    reliability: 1 - survival,
    pathFailureProbabilities: probs,
    independenceAssumption: true,
    note:
      'Path-level multiplication is valid only under the declared independence assumption; shared-risk correlation requires a joint model.'
  });
}

function sharedRiskGroups(edges) {
  const m = new Map();
  for (const e of edges || []) {
    if (!e.sharedRiskGroup) continue;
    const g = String(e.sharedRiskGroup);
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(String(e.id));
  }
  return Object.freeze(
    Object.fromEntries([...m].map(([k, v]) => [k, [...new Set(v)]]))
  );
}

/**
 * Build an immutable shared-risk exposure index from explicit resource and dependency records.
 *
 * @param {object} input
 * @param {Array<{id:string,type?:string,sharedRiskGroup?:string,criticality?:number,alternativePathAvailable?:boolean}>} input.resources
 * @param {Array<{id:string,customerId?:string,serviceId?:string,resourceIds:string[]}>} input.dependencies
 *   Each dependency lists the resources that must remain available for that service/customer path.
 * @param {number} [input.topN=10]
 */
function analyseSharedRiskExposure({ resources = [], dependencies = [], topN = 10 } = {}) {
  const n = Math.max(1, Math.min(500, Math.floor(finite(topN, 'topN'))));
  const resourceMap = new Map();
  for (const r of resources) {
    if (!r || !r.id) throw new TypeError('resource.id required');
    const id = String(r.id);
    resourceMap.set(
      id,
      Object.freeze({
        id,
        type: r.type != null ? String(r.type) : 'unknown',
        sharedRiskGroup: r.sharedRiskGroup != null ? String(r.sharedRiskGroup) : null,
        criticality: r.criticality != null ? nonNeg(r.criticality, `criticality(${id})`) : null,
        alternativePathAvailable: r.alternativePathAvailable === true
      })
    );
  }

  // Aggregate exposure per resource and per shared-risk group
  const byResource = new Map();
  const byGroup = new Map();
  const zeroDiversity = [];

  for (const dep of dependencies) {
    if (!dep || !Array.isArray(dep.resourceIds) || dep.resourceIds.length === 0) {
      throw new TypeError('dependency.resourceIds must be a non-empty array');
    }
    const depId = dep.id != null ? String(dep.id) : null;
    const customerId = dep.customerId != null ? String(dep.customerId) : null;
    const serviceId = dep.serviceId != null ? String(dep.serviceId) : null;
    const resourceIds = [...new Set(dep.resourceIds.map(String))];

    // Path diversity: unique shared-risk groups + resources without group
    const groups = new Set();
    let ungrouped = 0;
    for (const rid of resourceIds) {
      const res = resourceMap.get(rid);
      if (res && res.sharedRiskGroup) groups.add(res.sharedRiskGroup);
      else ungrouped += 1;
    }
    const diversityScore = groups.size + ungrouped;
    if (diversityScore <= 1) {
      zeroDiversity.push(
        Object.freeze({
          dependencyId: depId,
          customerId,
          serviceId,
          resourceIds: Object.freeze(resourceIds),
          diversityScore,
          reason: 'single_shared_risk_or_single_resource_path'
        })
      );
    }

    for (const rid of resourceIds) {
      if (!byResource.has(rid)) {
        byResource.set(rid, {
          resourceId: rid,
          serviceIds: new Set(),
          customerIds: new Set(),
          dependencyCount: 0
        });
      }
      const agg = byResource.get(rid);
      agg.dependencyCount += 1;
      if (serviceId) agg.serviceIds.add(serviceId);
      if (customerId) agg.customerIds.add(customerId);

      const res = resourceMap.get(rid);
      const g = res && res.sharedRiskGroup ? res.sharedRiskGroup : null;
      if (g) {
        if (!byGroup.has(g)) {
          byGroup.set(g, {
            sharedRiskGroup: g,
            resourceIds: new Set(),
            serviceIds: new Set(),
            customerIds: new Set(),
            dependencyCount: 0
          });
        }
        const gg = byGroup.get(g);
        gg.resourceIds.add(rid);
        gg.dependencyCount += 1;
        if (serviceId) gg.serviceIds.add(serviceId);
        if (customerId) gg.customerIds.add(customerId);
      }
    }
  }

  function scoreExposure(serviceCount, customerCount, criticality) {
    // Structural exposure only: product of declared counts; criticality multiplies when supplied.
    const base = serviceCount * Math.max(1, customerCount);
    return criticality != null ? base * (1 + criticality) : base;
  }

  const resourceRankings = [...byResource.values()]
    .map((agg) => {
      const meta = resourceMap.get(agg.resourceId) || {
        id: agg.resourceId,
        type: 'unknown',
        sharedRiskGroup: null,
        criticality: null,
        alternativePathAvailable: false
      };
      const serviceCount = agg.serviceIds.size;
      const customerCount = agg.customerIds.size;
      return Object.freeze({
        resourceId: agg.resourceId,
        type: meta.type,
        sharedRiskGroup: meta.sharedRiskGroup,
        criticality: meta.criticality,
        alternativePathAvailable: meta.alternativePathAvailable,
        serviceCount,
        customerCount,
        dependencyCount: agg.dependencyCount,
        exposureScore: scoreExposure(serviceCount, customerCount, meta.criticality),
        hasNoAcceptableAlternative: meta.alternativePathAvailable !== true && customerCount > 0
      });
    })
    .sort((a, b) => {
      if (b.exposureScore !== a.exposureScore) return b.exposureScore - a.exposureScore;
      return a.resourceId.localeCompare(b.resourceId);
    });

  const groupRankings = [...byGroup.values()]
    .map((gg) => {
      const serviceCount = gg.serviceIds.size;
      const customerCount = gg.customerIds.size;
      const memberCount = gg.resourceIds.size;
      return Object.freeze({
        sharedRiskGroup: gg.sharedRiskGroup,
        memberResourceIds: Object.freeze([...gg.resourceIds].sort()),
        memberCount,
        serviceCount,
        customerCount,
        dependencyCount: gg.dependencyCount,
        exposureScore: scoreExposure(serviceCount, customerCount, null) * memberCount
      });
    })
    .sort((a, b) => {
      if (b.exposureScore !== a.exposureScore) return b.exposureScore - a.exposureScore;
      return a.sharedRiskGroup.localeCompare(b.sharedRiskGroup);
    });

  const concentrationByType = new Map();
  for (const r of resourceRankings) {
    const t = r.type || 'unknown';
    if (!concentrationByType.has(t)) {
      concentrationByType.set(t, {
        type: t,
        resourceCount: 0,
        totalServices: 0,
        totalCustomers: 0,
        totalExposure: 0
      });
    }
    const c = concentrationByType.get(t);
    c.resourceCount += 1;
    c.totalServices += r.serviceCount;
    c.totalCustomers += r.customerCount;
    c.totalExposure += r.exposureScore;
  }

  const typeConcentration = [...concentrationByType.values()]
    .map((c) =>
      Object.freeze({
        type: c.type,
        resourceCount: c.resourceCount,
        totalServices: c.totalServices,
        totalCustomers: c.totalCustomers,
        totalExposure: c.totalExposure
      })
    )
    .sort((a, b) => {
      if (b.totalExposure !== a.totalExposure) return b.totalExposure - a.totalExposure;
      return a.type.localeCompare(b.type);
    });

  const noAlternative = resourceRankings.filter((r) => r.hasNoAcceptableAlternative);

  // Diversification candidates: highest-exposure resources that still have alternatives missing
  // or that sit in the largest shared-risk groups.
  const diversificationCandidates = resourceRankings
    .filter((r) => r.customerCount > 0)
    .slice(0, n)
    .map((r) =>
      Object.freeze({
        resourceId: r.resourceId,
        type: r.type,
        sharedRiskGroup: r.sharedRiskGroup,
        exposureScore: r.exposureScore,
        customerCount: r.customerCount,
        serviceCount: r.serviceCount,
        suggestedAction: r.alternativePathAvailable
          ? 'VERIFY_ALTERNATIVE_CAPACITY'
          : 'INVESTIGATE_PATH_DIVERSITY',
        note: 'Recommendation only; no investment order or topology mutation is performed.'
      })
    );

  return Object.freeze({
    schema: 'fiberos.shared-risk-exposure.v1',
    topN: n,
    rankedResources: Object.freeze(resourceRankings.slice(0, n)),
    rankedSharedRiskGroups: Object.freeze(groupRankings.slice(0, n)),
    zeroPathDiversity: Object.freeze(zeroDiversity),
    resourcesWithoutAcceptableAlternative: Object.freeze(noAlternative.slice(0, n)),
    concentrationByAssetType: Object.freeze(typeConcentration),
    diversificationCandidates: Object.freeze(diversificationCandidates),
    totals: Object.freeze({
      resourcesAnalysed: resourceMap.size,
      dependenciesAnalysed: dependencies.length,
      sharedRiskGroups: byGroup.size,
      zeroDiversityCount: zeroDiversity.length
    }),
    assumptions: Object.freeze([
      'Exposure scores are structural products of declared service/customer counts and optional criticality; they are not failure probabilities.',
      'No vendor coefficients, historical cut rates, or cost figures are invented.',
      'Output is a ranking/recommendation layer only; it does not mutate network state.'
    ])
  });
}

/**
 * Deterministic what-if: impact of a single resource failure given explicit dependency list.
 * Does not invent cascade probabilities beyond the supplied dependency graph.
 */
function whatIfResourceFails({ resourceId, dependencies = [], resources = [] } = {}) {
  if (!resourceId) throw new TypeError('resourceId required');
  const rid = String(resourceId);
  const resourceMeta = (resources || []).find((r) => String(r.id) === rid) || null;

  const affected = [];
  for (const dep of dependencies) {
    if (!dep || !Array.isArray(dep.resourceIds)) continue;
    if (dep.resourceIds.map(String).includes(rid)) {
      affected.push(
        Object.freeze({
          dependencyId: dep.id != null ? String(dep.id) : null,
          customerId: dep.customerId != null ? String(dep.customerId) : null,
          serviceId: dep.serviceId != null ? String(dep.serviceId) : null,
          remainingResourceIds: Object.freeze(
            dep.resourceIds.map(String).filter((x) => x !== rid)
          )
        })
      );
    }
  }

  const customers = new Set(affected.map((a) => a.customerId).filter(Boolean));
  const services = new Set(affected.map((a) => a.serviceId).filter(Boolean));

  return Object.freeze({
    schema: 'fiberos.what-if-resource-failure.v1',
    failedResourceId: rid,
    resourceType: resourceMeta && resourceMeta.type != null ? String(resourceMeta.type) : null,
    sharedRiskGroup:
      resourceMeta && resourceMeta.sharedRiskGroup != null
        ? String(resourceMeta.sharedRiskGroup)
        : null,
    affectedDependencyCount: affected.length,
    affectedCustomerCount: customers.size,
    affectedServiceCount: services.size,
    affected: Object.freeze(affected),
    note: 'Structural impact only from supplied dependencies; no probabilistic cascade is claimed.'
  });
}

/**
 * Rank ducts / cabinets / arbitrary containers by critical-service concentration.
 * Container membership must be supplied explicitly (containerId → resourceIds).
 */
function rankCriticalConcentration({
  containers = [],
  dependencies = [],
  topN = 10
} = {}) {
  const n = Math.max(1, Math.min(500, Math.floor(finite(topN, 'topN'))));
  const resourceToContainers = new Map();
  for (const c of containers) {
    if (!c || !c.id || !Array.isArray(c.resourceIds)) {
      throw new TypeError('container.id and container.resourceIds required');
    }
    const cid = String(c.id);
    for (const rid of c.resourceIds) {
      const id = String(rid);
      if (!resourceToContainers.has(id)) resourceToContainers.set(id, new Set());
      resourceToContainers.get(id).add(cid);
    }
  }

  const byContainer = new Map();
  for (const c of containers) {
    byContainer.set(String(c.id), {
      containerId: String(c.id),
      type: c.type != null ? String(c.type) : 'container',
      serviceIds: new Set(),
      customerIds: new Set(),
      resourceCount: new Set(c.resourceIds.map(String)).size
    });
  }

  for (const dep of dependencies) {
    if (!dep || !Array.isArray(dep.resourceIds)) continue;
    const serviceId = dep.serviceId != null ? String(dep.serviceId) : null;
    const customerId = dep.customerId != null ? String(dep.customerId) : null;
    const hitContainers = new Set();
    for (const rid of dep.resourceIds) {
      const cs = resourceToContainers.get(String(rid));
      if (cs) for (const c of cs) hitContainers.add(c);
    }
    for (const cid of hitContainers) {
      const agg = byContainer.get(cid);
      if (!agg) continue;
      if (serviceId) agg.serviceIds.add(serviceId);
      if (customerId) agg.customerIds.add(customerId);
    }
  }

  const ranked = [...byContainer.values()]
    .map((agg) => {
      const serviceCount = agg.serviceIds.size;
      const customerCount = agg.customerIds.size;
      return Object.freeze({
        containerId: agg.containerId,
        type: agg.type,
        resourceCount: agg.resourceCount,
        serviceCount,
        customerCount,
        concentrationScore: serviceCount * Math.max(1, customerCount)
      });
    })
    .sort((a, b) => {
      if (b.concentrationScore !== a.concentrationScore) {
        return b.concentrationScore - a.concentrationScore;
      }
      return a.containerId.localeCompare(b.containerId);
    });

  return Object.freeze({
    schema: 'fiberos.critical-concentration.v1',
    topN: n,
    ranked: Object.freeze(ranked.slice(0, n)),
    assumptions: Object.freeze([
      'Concentration is structural (services × customers sharing a container); not a failure probability.',
      'Container membership must be supplied by the caller; nothing is inferred from geometry alone.'
    ])
  });
}


/**
 * Convert authoritative service-path hop records into dependency inputs for
 * analyseSharedRiskExposure. No geometry inference and no invented hops.
 *
 * Each live/accepted path version becomes one dependency whose resourceIds are
 * the distinct asset/port/core identifiers present on its hops (in ordinal order).
 *
 * @param {object} input
 * @param {Array<{
 *   servicePathVersionId:string,
 *   serviceId?:string,
 *   customerId?:string,
 *   state?:string,
 *   hops:Array<{
 *     ordinal:number,
 *     fromAssetId?:string|null, toAssetId?:string|null,
 *     fromPortId?:string|null, toPortId?:string|null,
 *     fromCoreId?:string|null, toCoreId?:string|null,
 *     relation?:string
 *   }>
 * }>} input.servicePaths
 * @param {string[]} [input.acceptedStates=['live','accepted']]
 * @returns {{ dependencies: object[], skipped: object[], schema: string }}
 */
function dependenciesFromServicePathHops({ servicePaths = [], acceptedStates = ['live', 'accepted'] } = {}) {
  if (!Array.isArray(servicePaths)) throw new TypeError('servicePaths must be an array');
  const accepted = new Set((acceptedStates || []).map(String));
  const dependencies = [];
  const skipped = [];

  for (const sp of servicePaths) {
    if (!sp || typeof sp !== 'object') {
      skipped.push(Object.freeze({ reason: 'INVALID_PATH_RECORD' }));
      continue;
    }
    const versionId = sp.servicePathVersionId != null ? String(sp.servicePathVersionId) : null;
    if (!versionId) {
      skipped.push(Object.freeze({ reason: 'MISSING_SERVICE_PATH_VERSION_ID' }));
      continue;
    }
    const state = sp.state != null ? String(sp.state) : 'unknown';
    if (accepted.size && !accepted.has(state)) {
      skipped.push(Object.freeze({
        servicePathVersionId: versionId,
        reason: 'STATE_NOT_ACCEPTED',
        state
      }));
      continue;
    }
    if (!Array.isArray(sp.hops) || sp.hops.length === 0) {
      skipped.push(Object.freeze({
        servicePathVersionId: versionId,
        reason: 'EMPTY_HOPS'
      }));
      continue;
    }

    const ordered = [...sp.hops].sort((a, b) => {
      const ao = Number(a && a.ordinal);
      const bo = Number(b && b.ordinal);
      if (!Number.isFinite(ao) || !Number.isFinite(bo)) throw new TypeError('hop.ordinal must be finite');
      return ao - bo;
    });

    const resourceIds = [];
    const seen = new Set();
    function pushId(v) {
      if (v == null || v === '') return;
      const s = String(v);
      if (seen.has(s)) return;
      seen.add(s);
      resourceIds.push(s);
    }

    for (const h of ordered) {
      if (!h || typeof h !== 'object') throw new TypeError('hop must be an object');
      pushId(h.fromAssetId);
      pushId(h.fromPortId);
      pushId(h.fromCoreId);
      pushId(h.toAssetId);
      pushId(h.toPortId);
      pushId(h.toCoreId);
    }

    if (resourceIds.length === 0) {
      skipped.push(Object.freeze({
        servicePathVersionId: versionId,
        reason: 'NO_RESOURCE_IDENTIFIERS_ON_HOPS'
      }));
      continue;
    }

    dependencies.push(
      Object.freeze({
        id: `spv:${versionId}`,
        serviceId: sp.serviceId != null ? String(sp.serviceId) : null,
        customerId: sp.customerId != null ? String(sp.customerId) : null,
        servicePathVersionId: versionId,
        state,
        resourceIds: Object.freeze(resourceIds),
        hopCount: ordered.length
      })
    );
  }

  return Object.freeze({
    schema: 'fiberos.service-path-dependencies.v1',
    dependencies: Object.freeze(dependencies),
    skipped: Object.freeze(skipped),
    note: 'Dependencies are derived only from supplied hop identifiers; no path is invented.'
  });
}

/**
 * Convenience: build shared-risk exposure directly from service-path hops + resource metadata.
 * Pure composition of dependenciesFromServicePathHops + analyseSharedRiskExposure.
 */
function analyseSharedRiskFromServicePaths({
  servicePaths = [],
  resources = [],
  acceptedStates = ['live', 'accepted'],
  topN = 10
} = {}) {
  const derived = dependenciesFromServicePathHops({ servicePaths, acceptedStates });
  const exposure = analyseSharedRiskExposure({
    resources,
    dependencies: derived.dependencies,
    topN
  });
  return Object.freeze({
    schema: 'fiberos.shared-risk-from-service-paths.v1',
    pathDerivation: derived,
    exposure,
    assumptions: Object.freeze([
      ...(exposure.assumptions || []),
      'Service-path dependencies come only from explicit hop asset/port/core identifiers.',
      'Paths in non-accepted states are skipped, not invented.'
    ])
  });
}


/**
 * Convert ordered operational-trace path node identities into hop-shaped
 * service path records consumable by dependenciesFromServicePathHops.
 * Consecutive node ids become fromAssetId → toAssetId hops. No nodes invented.
 */
function servicePathsFromTraceNodes({ traces = [], acceptedStates = ['live', 'accepted'] } = {}) {
  if (!Array.isArray(traces)) throw new TypeError('traces must be an array');
  const out = [];
  const skipped = [];
  for (const tr of traces) {
    if (!tr || typeof tr !== 'object') {
      skipped.push(Object.freeze({ reason: 'INVALID_TRACE_RECORD' }));
      continue;
    }
    const versionId = tr.servicePathVersionId != null ? String(tr.servicePathVersionId) : null;
    if (!versionId) {
      skipped.push(Object.freeze({ reason: 'MISSING_SERVICE_PATH_VERSION_ID' }));
      continue;
    }
    const nodeIds = Array.isArray(tr.pathNodeIds)
      ? tr.pathNodeIds.map(String)
      : Array.isArray(tr.pathNodes)
        ? tr.pathNodes.map((n) => String(n && n.id != null ? n.id : n))
        : null;
    if (!nodeIds || nodeIds.length < 2) {
      skipped.push(Object.freeze({
        servicePathVersionId: versionId,
        reason: 'TRACE_PATH_TOO_SHORT'
      }));
      continue;
    }
    const hops = [];
    for (let i = 0; i < nodeIds.length - 1; i += 1) {
      hops.push(
        Object.freeze({
          ordinal: i + 1,
          fromAssetId: nodeIds[i],
          toAssetId: nodeIds[i + 1],
          relation: 'trace_hop'
        })
      );
    }
    out.push(
      Object.freeze({
        servicePathVersionId: versionId,
        serviceId: tr.serviceId != null ? String(tr.serviceId) : null,
        customerId: tr.customerId != null ? String(tr.customerId) : null,
        state: tr.state != null ? String(tr.state) : 'live',
        hops: Object.freeze(hops)
      })
    );
  }
  return Object.freeze({
    schema: 'fiberos.service-paths-from-trace.v1',
    servicePaths: Object.freeze(out),
    skipped: Object.freeze(skipped),
    acceptedStates: Object.freeze((acceptedStates || []).map(String)),
    note: 'Hops are consecutive pairs from supplied node identities only; no graph search is performed here.'
  });
}

/**
 * Full pipeline: operational-trace node path → hop dependencies → shared-risk exposure.
 */
function analyseSharedRiskFromTraceNodes({
  traces = [],
  resources = [],
  acceptedStates = ['live', 'accepted'],
  topN = 10
} = {}) {
  const converted = servicePathsFromTraceNodes({ traces, acceptedStates });
  const report = analyseSharedRiskFromServicePaths({
    servicePaths: converted.servicePaths,
    resources,
    acceptedStates,
    topN
  });
  return Object.freeze({
    schema: 'fiberos.shared-risk-from-trace.v1',
    pathConversion: converted,
    pathDerivation: report.pathDerivation,
    exposure: report.exposure,
    assumptions: Object.freeze([
      ...(report.assumptions || []),
      'Trace node identities are caller-supplied; this function does not query a live graph.'
    ])
  });
}

module.exports = {
  enumerateSimplePaths,
  pathFailureProbability,
  independentPathReliability,
  sharedRiskGroups,
  analyseSharedRiskExposure,
  whatIfResourceFails,
  rankCriticalConcentration,
  dependenciesFromServicePathHops,
  analyseSharedRiskFromServicePaths,
  servicePathsFromTraceNodes,
  analyseSharedRiskFromTraceNodes
};
