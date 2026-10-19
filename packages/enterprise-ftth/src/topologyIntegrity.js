'use strict';

const ASSET_TYPES = Object.freeze([
  'gpon_card','olt','odf','splitter','cable','splice','fat','ont','router'
]);

// Conservative physical/logical FTTH relationships. The validator does not
// invent topology; it only rejects relationships that are structurally invalid.
const ALLOWED_CONNECTIONS = Object.freeze({
  gpon_card: Object.freeze(['olt']),
  olt: Object.freeze(['odf','cable']),
  odf: Object.freeze(['olt','splitter','cable']),
  splitter: Object.freeze(['odf','cable','fat']),
  cable: Object.freeze(['olt','odf','splitter','cable','splice','fat']),
  splice: Object.freeze(['cable']),
  fat: Object.freeze(['splitter','cable','ont']),
  ont: Object.freeze(['fat','router']),
  router: Object.freeze(['ont'])
});

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }

function validateAsset(asset) {
  if (!asset || typeof asset !== 'object') throw new Error('INVALID_TOPOLOGY_ASSET');
  if (!nonEmpty(asset.asset_id)) throw new Error('TOPOLOGY_ASSET_ID_REQUIRED');
  if (!ASSET_TYPES.includes(asset.asset_type)) throw new Error('UNKNOWN_TOPOLOGY_ASSET_TYPE');
  if (asset.tenant_id !== undefined && !nonEmpty(asset.tenant_id)) throw new Error('INVALID_TOPOLOGY_TENANT_ID');
  return true;
}

function validateEdge(edge) {
  if (!edge || typeof edge !== 'object') throw new Error('INVALID_TOPOLOGY_EDGE');
  for (const f of ['edge_id','from_asset_id','to_asset_id']) {
    if (!nonEmpty(edge[f])) throw new Error(`TOPOLOGY_${f.toUpperCase()}_REQUIRED`);
  }
  if (edge.from_asset_id === edge.to_asset_id) throw new Error('TOPOLOGY_SELF_LOOP');
  if (edge.tenant_id !== undefined && !nonEmpty(edge.tenant_id)) throw new Error('INVALID_TOPOLOGY_TENANT_ID');
  return true;
}

function validateTopologyGraph({ assets, edges }) {
  if (!Array.isArray(assets) || !Array.isArray(edges)) throw new Error('TOPOLOGY_GRAPH_ARRAYS_REQUIRED');
  const byId = new Map();
  for (const asset of assets) {
    validateAsset(asset);
    if (byId.has(asset.asset_id)) throw new Error('DUPLICATE_TOPOLOGY_ASSET_ID');
    byId.set(asset.asset_id, asset);
  }
  const edgeIds = new Set();
  for (const edge of edges) {
    validateEdge(edge);
    if (edgeIds.has(edge.edge_id)) throw new Error('DUPLICATE_TOPOLOGY_EDGE_ID');
    edgeIds.add(edge.edge_id);
    const from = byId.get(edge.from_asset_id);
    const to = byId.get(edge.to_asset_id);
    if (!from || !to) throw new Error('TOPOLOGY_EDGE_REFERENCES_UNKNOWN_ASSET');
    if (edge.tenant_id !== undefined && from.tenant_id !== undefined && edge.tenant_id !== from.tenant_id) {
      throw new Error('TOPOLOGY_EDGE_TENANT_MISMATCH');
    }
    if (edge.tenant_id !== undefined && to.tenant_id !== undefined && edge.tenant_id !== to.tenant_id) {
      throw new Error('TOPOLOGY_EDGE_TENANT_MISMATCH');
    }
    const allowed = ALLOWED_CONNECTIONS[from.asset_type] || [];
    if (!allowed.includes(to.asset_type)) throw new Error('INVALID_FTTH_TOPOLOGY_RELATION');
  }
  return true;
}

module.exports = Object.freeze({ ASSET_TYPES, ALLOWED_CONNECTIONS, validateAsset, validateEdge, validateTopologyGraph });
