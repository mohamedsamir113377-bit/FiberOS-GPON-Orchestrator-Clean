'use strict';

/**
 * FiberOS Digital Twin + GIS contracts
 * =====================================
 * Pure domain. Complements packages/engineering twin.js with:
 * - hierarchical FTTH asset model (OLT → … → ONT)
 * - derived capacity (never hand-entered as truth)
 * - impact analysis helpers aligned with network_assets / network_ports schema
 *
 * Spatial distance uses the same Haversine as realityGate; PostGIS remains
 * the authoritative store for geography columns.
 */

const ASSET_TYPES = Object.freeze([
  'OLT',
  'MDF',
  'FDT',
  'PFP',
  'FAT',
  'SPLITTER',
  'ONT'
]);

const PORT_STATUSES = Object.freeze(['free', 'used', 'faulty', 'reserved']);
const ASSET_STATUSES = Object.freeze([
  'active',
  'degrading',
  'critical',
  'decommissioned'
]);

const twinVerification = require('./twinVerification');

function assertAssetType(t) {
  if (ASSET_TYPES.indexOf(String(t || '')) === -1) {
    const e = new TypeError('INVALID_ASSET_TYPE');
    e.code = 'INVALID_ASSET_TYPE';
    throw e;
  }
}

/**
 * Build a hierarchy path from parent links.
 * nodes: [{ id, assetType, parentId, code }]
 */
function buildHierarchy(nodes) {
  if (!Array.isArray(nodes)) throw Object.assign(new TypeError('INVALID_HIERARCHY_NODES'), { code: 'INVALID_HIERARCHY_NODES' });
  const byId = new Map();
  for (const n of nodes) {
    if (!n || n.id == null || !String(n.id).trim()) throw Object.assign(new TypeError('INVALID_HIERARCHY_NODE_ID'), { code: 'INVALID_HIERARCHY_NODE_ID' });
    assertAssetType(n.assetType || n.asset_type);
    const id = String(n.id);
    if (byId.has(id)) throw Object.assign(new Error('DUPLICATE_HIERARCHY_NODE_ID'), { code: 'DUPLICATE_HIERARCHY_NODE_ID', assetId: id });
    byId.set(id, {
      id,
      assetType: n.assetType || n.asset_type,
      parentId: n.parentId != null ? String(n.parentId) : n.parent_asset_id != null ? String(n.parent_asset_id) : null,
      code: n.code || n.asset_code || null,
      status: n.status || 'active'
    });
  }
  for (const node of byId.values()) {
    if (node.parentId && !byId.has(node.parentId)) throw Object.assign(new Error('HIERARCHY_PARENT_NOT_FOUND'), { code: 'HIERARCHY_PARENT_NOT_FOUND', assetId: node.id, parentId: node.parentId });
    const seen = new Set();
    let current = node.id;
    while (current) {
      if (seen.has(current)) throw Object.assign(new Error('HIERARCHY_CYCLE_DETECTED'), { code: 'HIERARCHY_CYCLE_DETECTED', assetId: node.id });
      seen.add(current);
      const parent = byId.get(current);
      current = parent && parent.parentId;
    }
  }
  function pathToRoot(id) {
    const chain = [];
    const seen = new Set();
    let cur = String(id);
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const node = byId.get(cur);
      chain.push(node);
      cur = node.parentId;
    }
    return chain;
  }
  return Object.freeze({
    byId,
    pathToRoot,
    roots: [...byId.values()].filter((n) => !n.parentId)
  });
}

/**
 * Capacity is DERIVED from port rows — never from a hand-typed total alone.
 * Mirrors SQL view network_asset_capacity.
 */
function deriveCapacity(asset, ports) {
  const total = asset && asset.totalPorts != null ? Number(asset.totalPorts) : null;
  const list = Array.isArray(ports) ? ports : [];
  let used = 0;
  let free = 0;
  let faulty = 0;
  let reserved = 0;
  for (const p of list) {
    const st = String(p.status || 'free');
    if (st === 'used') used += 1;
    else if (st === 'faulty') faulty += 1;
    else if (st === 'reserved') reserved += 1;
    else free += 1;
  }
  const provisioned = list.length;
  const overCapacity =
    total != null && Number.isFinite(total) && used > total;
  return Object.freeze({
    assetId: asset && (asset.id || asset.assetId) ? String(asset.id || asset.assetId) : null,
    totalPorts: total,
    usedPorts: used,
    freePorts: free,
    faultyPorts: faulty,
    reservedPorts: reserved,
    provisionedPorts: provisioned,
    overCapacity: !!overCapacity,
    utilization:
      total && total > 0 ? Math.round((used / total) * 10000) / 100 : null
  });
}

/**
 * Customer / service impact from a failed asset (BFS down the hierarchy).
 */
function impactFromAsset(nodes, failedAssetId, serviceByAsset, customerByAsset) {
  const h = buildHierarchy(nodes);
  const children = new Map();
  for (const n of h.byId.values()) {
    if (!n.parentId) continue;
    if (!children.has(n.parentId)) children.set(n.parentId, []);
    children.get(n.parentId).push(n.id);
  }
  const q = [String(failedAssetId)];
  const affected = new Set();
  while (q.length) {
    const id = q.shift();
    if (affected.has(id)) continue;
    affected.add(id);
    for (const c of children.get(id) || []) q.push(c);
  }
  const services = new Set();
  const customers = new Set();
  const svcMap = serviceByAsset || {};
  const custMap = customerByAsset || {};
  for (const id of affected) {
    for (const s of svcMap[id] || []) services.add(String(s));
    for (const c of custMap[id] || []) customers.add(String(c));
  }
  return Object.freeze({
    failedAssetId: String(failedAssetId),
    affectedAssetIds: [...affected],
    affectedAssetCount: affected.size,
    affectedServices: [...services],
    affectedCustomers: [...customers]
  });
}

/**
 * Simple WGS84 point validation for GIS payloads before PostGIS insert.
 */
function validateGeoPoint(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return { ok: false, code: 'INVALID_COORDINATES' };
  }
  if (la < -90 || la > 90 || lo < -180 || lo > 180) {
    return { ok: false, code: 'COORDINATES_OUT_OF_RANGE' };
  }
  return { ok: true, lat: la, lon: lo };
}

/**
 * Haversine (metres) — same constant as realityGate / domain geo.
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Rank candidate technicians by distance + load (deterministic, no LLM).
 * Stable tie-break by technicianId.
 */
function rankTechnicians(job, technicians, options) {
  options = options || {};
  const maxM = options.maxMeters != null ? Number(options.maxMeters) : null;
  const jobLat = Number(job && job.lat);
  const jobLon = Number(job && (job.lon != null ? job.lon : job.lng));
  if (!Number.isFinite(jobLat) || !Number.isFinite(jobLon)) {
    return [];
  }
  const rows = [];
  for (const t of technicians || []) {
    const lat = Number(t.lat != null ? t.lat : t.latitude);
    const lon = Number(t.lon != null ? t.lon : t.longitude != null ? t.longitude : t.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const dist = haversineMeters(jobLat, jobLon, lat, lon);
    if (maxM != null && dist > maxM) continue;
    const load = Number(t.activeJobs || t.load || 0) || 0;
    const skillBonus =
      t.skills && job.skill && Array.isArray(t.skills) && t.skills.indexOf(job.skill) >= 0
        ? 15
        : 0;
    const availPenalty =
      t.status === 'ACTIVE_MIDAN' || t.active !== false ? 0 : 100;
    const score =
      100 -
      Math.min(dist / 50000, 1) * 40 -
      Math.min(load / 10, 1) * 25 +
      skillBonus -
      availPenalty;
    rows.push({
      technicianId: String(t.id || t.technicianId),
      score: Math.round(score * 100) / 100,
      distanceMeters: Math.round(dist),
      load
    });
  }
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.technicianId.localeCompare(b.technicianId);
  });
  return rows;
}

module.exports = Object.freeze({
  ASSET_TYPES,
  PORT_STATUSES,
  ASSET_STATUSES,
  buildHierarchy,
  deriveCapacity,
  impactFromAsset,
  validateGeoPoint,
  haversineMeters,
  rankTechnicians,
  twinVerification
});
