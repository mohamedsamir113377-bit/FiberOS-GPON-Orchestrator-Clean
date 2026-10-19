'use strict';

const crypto = require('crypto');
const { buildHierarchy } = require('./index');

const MAX_FAILED_ASSETS = 32;
const MAX_NODES = 20000;
const MAX_EDGES = 40000;
const MAX_SERVICE_BINDINGS = 50000;

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function finiteNonNegative(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw Object.assign(new TypeError(name + '_INVALID'), { code: name + '_INVALID' });
  return n;
}

function normalizeIds(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const out = [...new Set(list.filter(Boolean).map(String))];
  if (!out.length) throw Object.assign(new TypeError('FAILED_ASSET_IDS_REQUIRED'), { code: 'FAILED_ASSET_IDS_REQUIRED' });
  if (out.length > MAX_FAILED_ASSETS) throw Object.assign(new RangeError('FAILED_ASSET_IDS_TOO_MANY'), { code: 'FAILED_ASSET_IDS_TOO_MANY' });
  return out;
}

function propagation(nodes, edges, failedIds) {
  const byId = new Map((nodes || []).map(n => [String(n.id), n]));
  const adjacency = new Map();
  const add = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push(b);
  };
  for (const edge of edges || []) {
    if (!edge || edge.active === false) continue;
    const from = String(edge.fromAssetId ?? edge.from_asset_id ?? '');
    const to = String(edge.toAssetId ?? edge.to_asset_id ?? '');
    if (!byId.has(from) || !byId.has(to)) continue;
    const direction = String(edge.direction || 'directed');
    add(from, to);
    if (direction === 'undirected') add(to, from);
  }

  const visited = new Set();
  const queue = [];
  for (const id of failedIds) {
    if (byId.has(id)) {
      visited.add(id);
      queue.push(id);
    }
  }
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return [...visited];
}

function hierarchyDescendants(nodes, failedIds) {
  const h = buildHierarchy(nodes);
  const children = new Map();
  for (const n of h.byId.values()) {
    if (!n.parentId) continue;
    if (!children.has(n.parentId)) children.set(n.parentId, []);
    children.get(n.parentId).push(n.id);
  }
  const out = new Set();
  const q = [...failedIds];
  while (q.length) {
    const id = String(q.shift());
    if (out.has(id)) continue;
    out.add(id);
    for (const child of children.get(id) || []) q.push(child);
  }
  return [...out];
}

function normalizeServices(services) {
  if (!Array.isArray(services)) return { serviceByAsset: {}, customerByAsset: {}, count: 0 };
  if (services.length > MAX_SERVICE_BINDINGS) {
    throw Object.assign(new RangeError('SERVICE_BINDINGS_TOO_MANY'), { code: 'SERVICE_BINDINGS_TOO_MANY' });
  }
  const serviceByAsset = {};
  const customerByAsset = {};
  for (const row of services) {
    if (!row || row.id == null) continue;
    const assetPath = row.assetPath ?? row.asset_path ?? {};
    const ids = [];
    if (assetPath && typeof assetPath === 'object' && !Array.isArray(assetPath)) {
      for (const value of Object.values(assetPath)) {
        if (value) ids.push(String(value));
      }
    }
    for (const assetId of ids) {
      (serviceByAsset[assetId] ||= []).push(String(row.id));
      if (row.customerRef || row.customer_ref) {
        (customerByAsset[assetId] ||= []).push(String(row.customerRef ?? row.customer_ref));
      }
    }
  }
  return { serviceByAsset, customerByAsset, count: services.length };
}

function capacityImpact(portsByAsset, affectedIds) {
  let totalPortsBefore = 0;
  let usedPortsBefore = 0;
  let faultyPortsBefore = 0;
  let reservedPortsBefore = 0;
  let affectedPortCount = 0;

  for (const [assetId, ports] of Object.entries(portsByAsset || {})) {
    const list = Array.isArray(ports) ? ports : [];
    const affected = affectedIds.has(String(assetId));
    if (!affected) continue;
    for (const port of list) {
      affectedPortCount += 1;
      const status = String(port.status || 'free');
      if (status === 'used') usedPortsBefore += 1;
      else if (status === 'faulty') faultyPortsBefore += 1;
      else if (status === 'reserved') reservedPortsBefore += 1;
    }
    totalPortsBefore += list.length;
  }

  const availableBefore = totalPortsBefore - usedPortsBefore - faultyPortsBefore - reservedPortsBefore;
  return {
    affectedAssets: affectedIds.size,
    observedPortsOnAffectedAssets: affectedPortCount,
    occupiedPortsAtRisk: usedPortsBefore,
    faultyPortsAtRisk: faultyPortsBefore,
    reservedPortsAtRisk: reservedPortsBefore,
    availablePortsAtRisk: Math.max(0, availableBefore),
    virtualCapacityLossPorts: affectedPortCount,
    note: 'Port counts are derived from supplied snapshot rows; no production capacity is mutated.'
  };
}

function simulateFailure(input) {
  const data = input || {};
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  if (!nodes.length) throw Object.assign(new RangeError('SIMULATION_NODES_REQUIRED'), { code: 'SIMULATION_NODES_REQUIRED' });
  if (nodes.length > MAX_NODES) throw Object.assign(new RangeError('SIMULATION_NODES_TOO_MANY'), { code: 'SIMULATION_NODES_TOO_MANY' });
  if (edges.length > MAX_EDGES) throw Object.assign(new RangeError('SIMULATION_EDGES_TOO_MANY'), { code: 'SIMULATION_EDGES_TOO_MANY' });

  const failedIds = normalizeIds(data.failedAssetIds ?? data.failedAssetId);
  const nodeIds = new Set(nodes.map(n => String(n.id)));
  const unknown = failedIds.filter(id => !nodeIds.has(id));
  if (unknown.length) throw Object.assign(new RangeError('FAILED_ASSET_NOT_IN_SNAPSHOT'), { code: 'FAILED_ASSET_NOT_IN_SNAPSHOT', unknownAssetIds: unknown });

  const graphAffected = propagation(nodes, edges, failedIds);
  const hierarchyAffected = hierarchyDescendants(nodes, failedIds);
  const affected = new Set([...graphAffected, ...hierarchyAffected]);
  const serviceMaps = normalizeServices(data.services);
  const affectedServices = new Set();
  const affectedCustomers = new Set();
  for (const id of affected) {
    for (const serviceId of serviceMaps.serviceByAsset[id] || []) affectedServices.add(String(serviceId));
    for (const customerRef of serviceMaps.customerByAsset[id] || []) affectedCustomers.add(String(customerRef));
  }

  const portsByAsset = data.portsByAsset || {};
  const cap = capacityImpact(portsByAsset, affected);
  const virtualChanges = failedIds.map(id => {
    const node = nodes.find(n => String(n.id) === id);
    return { assetId: id, fromStatus: String(node.status || 'active'), toStatus: 'SIMULATED_FAILED' };
  });

  const snapshot = {
    failedAssetIds: failedIds,
    nodes,
    edges,
    services: data.services || [],
    portsByAsset,
    model: 'ASSET_GRAPH_REACHABILITY_V1'
  };
  const simulationId = sha256(snapshot);

  return Object.freeze({
    ok: true,
    simulationId,
    model: 'ASSET_GRAPH_REACHABILITY_V1',
    deterministic: true,
    autonomousPrediction: false,
    productionMutation: false,
    failedAssetIds: failedIds,
    propagation: {
      graphReachableAssetIds: graphAffected,
      hierarchyDescendantAssetIds: hierarchyAffected,
      affectedAssetIds: [...affected],
      affectedAssetCount: affected.size
    },
    capacityImpact: cap,
    affectedServices: [...affectedServices].sort(),
    affectedCustomers: [...affectedCustomers].sort(),
    virtualChanges,
    rollbackPreview: {
      mode: 'NO_WRITE_PREVIEW',
      writes: 0,
      reversible: true,
      steps: virtualChanges.map(change => ({
        assetId: change.assetId,
        restoreStatus: change.fromStatus
      }))
    },
    snapshotIntegrity: {
      serviceRowsObserved: serviceMaps.count,
      hash: sha256({ nodes, edges, services: data.services || [], portsByAsset }),
      inputsAreEphemeral: true
    }
  });
}

module.exports = Object.freeze({
  MAX_FAILED_ASSETS,
  MAX_NODES,
  MAX_EDGES,
  simulateFailure
});
