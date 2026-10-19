'use strict';

const { readBody, send, notFound, parseUrl } = require('../../api/src/http');
const { getRequestPrincipalAsync } = require('../../api/src/auth');
const { normalizeRole } = require('../../../packages/security/src/authorization');
const { requireVerifiedPrincipal } = require('../../api/src/requireAuth');
const { createPool } = require('../../../packages/db/src/index');
const { withPrincipal } = require('../../../packages/db/src/session');
const GIS = require('../../../packages/sovereign-gis/src');
const { readFeatureCollection, readMvt, readNearbyAssets, readAssetTwin, readSpatialImpact, readIntersections } = GIS;
const { applySecurityHeaders, applyCorsHeaders, validateSecurityConfiguration, validateRequestAbuseBoundary, validateHttpFraming, createRateLimiter, rateKey } = require('../../../packages/security/src/httpHardening');
const { evaluateRequest: firewallEvaluate, validateFirewallConfiguration } = require('../../../packages/security-firewall/src/index');
const { createDdosGuard } = require('../../../packages/security/src/ddosGuard');
const { parseAttestedOutboundUrl, resolveAttestedOutboundTarget, requestAttestedJson } = require('../../../packages/security/src/outboundPolicy');

function attestedUrl(raw, requiredEnv, code) {
  try { return parseAttestedOutboundUrl(raw, { envName: requiredEnv, codePrefix: code, productionPort443:false }); }
  catch (e) { if (e && e.code === `${code}_HOST_NOT_ATTESTED`) throw Object.assign(new Error(code), { statusCode:503 }); throw Object.assign(new Error(e.code || `${requiredEnv}_INVALID`), { statusCode:503 }); }
}

function routerUrl(router) {
  const r = String(router || '').toUpperCase();
  if (r === 'VALHALLA') return attestedUrl(process.env.FIBEROS_VALHALLA_URL, 'FIBEROS_VALHALLA_URL', 'GIS_VALHALLA_HOST_NOT_ATTESTED');
  if (r === 'OSRM') return attestedUrl(process.env.FIBEROS_OSRM_URL, 'FIBEROS_OSRM_URL', 'GIS_OSRM_HOST_NOT_ATTESTED');
  throw Object.assign(new Error('GIS_ROUTER_INVALID'), { statusCode: 400 });
}
async function httpJson(u, payload) {
  const target = await resolveAttestedOutboundTarget(u, {
    codePrefix:'GIS_ROUTER',
    allowedHostsEnv:'FIBEROS_SELF_HOSTED_HOSTS',
    cidrsEnv:'FIBEROS_SELF_HOSTED_CIDRS'
  });
  return requestAttestedJson(u, target, {
    codePrefix:'GIS_ROUTER', method:'POST', timeoutMs:10000, maxResponseBytes:2 * 1024 * 1024,
    headers:{ 'content-type':'application/json' }, body:JSON.stringify(payload)
  });
}

function createGisService() {
  const db = createPool(process.env);
  const securityGate = validateSecurityConfiguration(process.env);
  const firewallGate = validateFirewallConfiguration(process.env);
  const ddosGuard = createDdosGuard(process.env);
  const limiter = createRateLimiter(process.env);
  const port = Number(process.env.GIS_PORT || 3009);
  const host = String(process.env.GIS_BIND_HOST || '127.0.0.1');

  async function authenticated(req) {
    const principal = await getRequestPrincipalAsync(req, process.env);
    const verified = requireVerifiedPrincipal(principal, process.env);
    if (!verified.ok) { const e = new Error(verified.body && verified.body.error || 'AUTH_REQUIRED'); e.statusCode=verified.status || 401; throw e; }
    return verified.principal;
  }
  async function dbRead(principal, fn) { return withPrincipal(db, principal, fn); }
  const GIS_READ_ROLES = new Set(['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
  const GIS_OPERATOR_ROLES = new Set(['dispatcher','ops_manager','area_supervisor','exec','sysadmin']);
  function requireRole(principal, allowed) {
    const role = normalizeRole(principal && principal.role);
    if (!allowed.has(role)) { const e = new Error('GIS_ROLE_NOT_AUTHORIZED'); e.statusCode = 403; throw e; }
    return role;
  }

  const server = http.createServer(async (req,res) => {
    const ddosToken = ddosGuard.admit(req.socket && req.socket.remoteAddress);
    if (!ddosToken.allow) {
      res.setHeader('Retry-After', String(ddosToken.retryAfter || 1));
      res.setHeader('X-FiberOS-DDoS-Guard', ddosToken.code || 'REJECTED');
      return send(res, ddosToken.status || 429, { ok:false, error: ddosToken.code || 'DDOS_GUARD_REJECTED', authority:'DDOS_GUARD' });
    }
    const releaseDdos = () => ddosGuard.release(ddosToken);
    res.on('finish', releaseDdos);
    res.on('close', releaseDdos);
    try {
      applySecurityHeaders(res, process.env);
      const cors = applyCorsHeaders(res, req, process.env);
      if (!cors.allowed) return send(res,403,{ok:false,error:cors.code,authority:'HTTP_SECURITY_ENFORCEMENT'});
      if (securityGate.config.production && !securityGate.ok) return send(res,503,{ok:false,error:'SECURITY_CONFIGURATION_INVALID'});
      if (firewallGate.config.production && !firewallGate.ok) return send(res,503,{ok:false,error:'SECURITY_FIREWALL_CONFIGURATION_INVALID'});
      const fw = firewallEvaluate({method:req.method,path:(req.url||'/').split('?')[0],url:req.url||'/',headers:req.headers||{},protocol:req.socket && req.socket.encrypted ? 'https' : '', remoteAddress:req.socket && req.socket.remoteAddress},process.env);
      if (!fw.allow) return send(res,fw.status||400,{ok:false,error:fw.code||'FIREWALL_REJECTED',authority:'SECURITY_FIREWALL'});
      const framing=validateHttpFraming(req); if(!framing.ok) return send(res,400,{ok:false,error:'HTTP_FRAMING_REJECTED'});
      const abuse=validateRequestAbuseBoundary(req); if(!abuse.ok) return send(res,400,{ok:false,error:'REQUEST_ABUSE_REJECTED'});
      const limit=limiter.allow(rateKey(req,null,{scope:'ip'})); if(!limit.allowed) return send(res,429,{ok:false,error:'RATE_LIMIT_EXCEEDED'});
      if(req.method==='OPTIONS') {
        res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600','Vary':'Origin'});
        return res.end();
      }
      const url=parseUrl(req); const path=url.pathname.replace(/\/+$/,'')||'/';
      if(req.method==='GET' && path==='/health') return send(res,200,{ok:true,service:'fiberos-gis',authority:'FIBEROS_DATABASE_POSTGIS',executionAuthorized:false,dbConfigured:!!db.configured,bindHost:host});
      const principal=await authenticated(req);
      if(req.method==='GET' && /^\/tiles\/[^/]+\/\d+\/\d+\/\d+\.pbf$/.test(path)) {
        requireRole(principal, GIS_READ_ROLES); const m=path.match(/^\/tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/); const layer=m[1];
        const tile=await dbRead(principal, client=>readMvt(client,{layer,z:Number(m[2]),x:Number(m[3]),y:Number(m[4])}));
        res.writeHead(200,{'content-type':'application/vnd.mapbox-vector-tile','cache-control':'private, no-store'}); return res.end(tile);
      }
      if(req.method==='GET' && path==='/v1/gis/features') { requireRole(principal, GIS_READ_ROLES);
        const layer=url.searchParams.get('layer'); const bbox={minLon:url.searchParams.get('minLon'),minLat:url.searchParams.get('minLat'),maxLon:url.searchParams.get('maxLon'),maxLat:url.searchParams.get('maxLat')};
        const out=await dbRead(principal,client=>readFeatureCollection(client,{layer,bbox})); return send(res,200,out);
      }
      if(req.method==='POST' && path==='/v1/gis/nearby-assets') { requireRole(principal, GIS_OPERATOR_ROLES); const body=await readBody(req); return send(res,200,await dbRead(principal,c=>readNearbyAssets(c,body||{}))); }
      if(req.method==='GET' && /^\/v1\/gis\/assets\/[0-9a-f-]+\/twin$/.test(path)) { requireRole(principal, GIS_READ_ROLES); const id=path.split('/')[4]; return send(res,200,await dbRead(principal,c=>readAssetTwin(c,id))); }
      if(req.method==='GET' && /^\/v1\/gis\/assets\/[0-9a-f-]+\/impact$/.test(path)) { requireRole(principal, GIS_OPERATOR_ROLES); const id=path.split('/')[4]; const d=url.searchParams.get('maxDepth'); return send(res,200,await dbRead(principal,c=>readSpatialImpact(c,id,d==null?undefined:Number(d)))); }
      if(req.method==='POST' && path==='/v1/gis/intersections') { requireRole(principal, GIS_OPERATOR_ROLES); const body=await readBody(req); return send(res,200,await dbRead(principal,c=>readIntersections(c,body&&body.layer,body&&body.bbox))); }
      if(req.method==='POST' && /^\/routing\/(valhalla|osrm)$/.test(path)) { requireRole(principal, GIS_OPERATOR_ROLES);
        const router=path.split('/')[2].toUpperCase(); const body=GIS.routingRequest(Object.assign({},await readBody(req),{router}));
        const upstream=routerUrl(router); const result=await httpJson(upstream,body);
        if(result.status<200||result.status>=300) return send(res,502,{ok:false,error:'GIS_ROUTER_UPSTREAM_ERROR',upstreamStatus:result.status});
        return send(res,200,{ok:true,authority:'INTERNAL_SELF_HOSTED_ROUTER',executionAuthorized:false,router,data:result.data});
      }
      return notFound(res);
    } catch(e) { return send(res,e.statusCode||400,{ok:false,error:e.code||e.message||'GIS_SERVICE_ERROR',authority:'SOVEREIGN_GIS_SERVICE'}); }
  });
  return {server,port,host,db};
}
module.exports={createGisService,attestedUrl,routerUrl};
