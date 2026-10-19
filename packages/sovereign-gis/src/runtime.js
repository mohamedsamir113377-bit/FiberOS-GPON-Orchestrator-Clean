'use strict';
const { assertLayer, routingRequest } = require('./index');
const { parseAttestedOutboundUrl, joinAttestedPath, resolveAttestedOutboundTarget, requestAttested } = require('../../security/src/outboundPolicy');

function serviceUrl() {
  return parseAttestedOutboundUrl(process.env.FIBEROS_GIS_SERVICE_URL, { envName:'FIBEROS_GIS_SERVICE_URL', codePrefix:'GIS_SERVICE', productionPort443:false });
}

async function getTile({ accessToken, layer, z, x, y }) {
  if (!accessToken) throw new Error('GIS_ACCESS_TOKEN_REQUIRED');
  assertLayer(layer);
  for (const n of [z,x,y]) if (!Number.isInteger(n) || n < 0) throw new Error('GIS_TILE_COORDINATE_INVALID');
  const base = serviceUrl();
  const url = joinAttestedPath(base, `/tiles/${encodeURIComponent(layer.kind.toLowerCase())}/${z}/${x}/${y}.pbf`);
  const target = await resolveAttestedOutboundTarget(base, { codePrefix:'GIS_SERVICE' });
  const response = await requestAttested(url, target, { codePrefix:'GIS_TILE', method:'GET', timeoutMs:15000, maxResponseBytes:10 * 1024 * 1024, headers:{ accept:'application/vnd.mapbox-vector-tile,application/octet-stream', authorization:`Bearer ${accessToken}` } });
  if (!response.ok) throw Object.assign(new Error(`GIS_TILE_HTTP_${response.status}`), { code:`GIS_TILE_HTTP_${response.status}` });
  return { status:response.status, contentType:String(response.headers['content-type'] || 'application/octet-stream'), bytes:response.body };
}

async function route(input) {
  if (!input || !input.accessToken) throw new Error('GIS_ACCESS_TOKEN_REQUIRED');
  const req = routingRequest(input);
  if (req.router === 'NONE') return Object.freeze({ ok: false, code: 'GIS_ROUTER_NOT_CONFIGURED' });
  const base = serviceUrl();
  const url = joinAttestedPath(base, `/routing/${req.router.toLowerCase()}`);
  const target = await resolveAttestedOutboundTarget(base, { codePrefix:'GIS_SERVICE' });
  const response = await require('../../security/src/outboundPolicy').requestAttestedJson(url, target, { codePrefix:'GIS_ROUTE', method:'POST', timeoutMs:15000, maxResponseBytes:5 * 1024 * 1024, headers:{'content-type':'application/json','authorization':`Bearer ${input.accessToken}`}, body:JSON.stringify(req) });
  if (!response.ok) throw Object.assign(new Error(`GIS_ROUTE_HTTP_${response.status}`), { code:`GIS_ROUTE_HTTP_${response.status}` });
  return Object.freeze(response.data || {});
}
module.exports = { serviceUrl, getTile, route };
