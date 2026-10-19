'use strict';
const crypto = require('crypto');
const LAYER_KINDS = Object.freeze(['NETWORK_ASSET','FIBER_CABLE','DUCT','ODN','OPTICAL','WORK_ORDER','EVIDENCE','IMPACT','CUSTOMER_SERVICE','TECHNICIAN_POSITION','TICKET_LOCATION' ,'FAULT','INSTALLATION','TECHNICIAN']);
const ROUTERS = Object.freeze(['VALHALLA','OSRM','NONE']);
function sha256(v) { return crypto.createHash('sha256').update(JSON.stringify(v), 'utf8').digest('hex'); }
function assertLayer(layer = {}) {
  if (!LAYER_KINDS.includes(String(layer.kind))) throw new Error('GIS_LAYER_KIND_INVALID');
  if (layer.sourceAuthority !== 'FIBEROS_DATABASE') throw new Error('GIS_SOURCE_OF_TRUTH_MUST_BE_FIBEROS_DATABASE');
  if (layer.externalProvider === true) throw new Error('GIS_EXTERNAL_PROVIDER_FORBIDDEN');
  return true;
}
function routingRequest(input = {}) {
  const router = String(input.router || 'NONE');
  if (!ROUTERS.includes(router)) throw new Error('GIS_ROUTER_INVALID');
  return Object.freeze({ router, origin: input.origin || null, destination: input.destination || null, evidenceClass: input.evidenceClass || 'unverified' });
}
function tileCacheKey({ tenantId, layer, z, x, y }) {
  if (!tenantId || !layer || !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) throw new Error('GIS_TILE_KEY_INVALID');
  return `fiberos:${tenantId}:${layer}:${z}:${x}:${y}:${sha256({tenantId,layer,z,x,y}).slice(0,16)}`;
}
const Spatial = require('./spatial');
const Proximity = require('./proximityPolicy');
const Clustering = require('./spatialClusteringPolicy');
const LinearSnap = require('./linearSnapPolicy');
const Corridor = require('./corridorConflictPolicy');
const LinearMeasure = require('./linearMeasurePolicy');
const TopologyIntegrity = require('./topologyIntegrityPolicy');
const GeometryQuality = require('./geometryQualityPolicy');
const RoutingBoundary = require('./routingBoundaryPolicy');
module.exports = {
  LAYER_KINDS, ROUTERS, assertLayer, routingRequest, tileCacheKey,
  ...Spatial, ...Proximity, ...Clustering, ...LinearSnap,
  ...Corridor, ...LinearMeasure, ...TopologyIntegrity, ...GeometryQuality, ...RoutingBoundary
};
