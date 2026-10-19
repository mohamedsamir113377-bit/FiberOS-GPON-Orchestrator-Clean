#!/usr/bin/env node
'use strict';

const { info: logInfo, error: logError } = require('../../../packages/observability/src/logger');
/**
 * FiberOS AI Gateway — ADVISORY ONLY.
 * Never closes tickets. Never writes audit_log as authority.
 * executionAuthorized is always false from this service's perspective for network changes.
 */
const http = require('http');
const https = require('https');
const { loadServerConfig } = require('../../../packages/core/src/config');
const { readBody, send, notFound, parseUrl } = require('../../api/src/http');
const { applySecurityHeaders, applyCorsHeaders, validateSecurityConfiguration, validateRequestAbuseBoundary, validateHttpFraming, createRateLimiter, rateKey } = require('../../../packages/security/src/httpHardening');
const { getRequestPrincipalAsync } = require('../../api/src/auth');
const { requireVerifiedPrincipal } = require('../../api/src/requireAuth');
const { authorizeAiRequest } = require('./authorization');
const { canonicalAiPath, publicAiHealthResponse, aiPrincipalRateKey } = require('./httpContract');
const { evaluateRequest: firewallEvaluate, validateFirewallConfiguration } = require('../../../packages/security-firewall/src/index');
const { createDdosGuard } = require('../../../packages/security/src/ddosGuard');
const { parseAttestedOutboundUrl, resolveAttestedOutboundTarget, requestAttestedJson, hasOnlyInternalNetworkTargets } = require('../../../packages/security/src/outboundPolicy');

const cfg = loadServerConfig(process.env);
const securityGate = validateSecurityConfiguration(process.env);
const firewallGate = validateFirewallConfiguration(process.env);
const ddosGuard = createDdosGuard(process.env);
const rateLimiter = createRateLimiter(process.env);
const { buildAdvisoryResponse, assertNoExecutionAuthority, normalizeAdvisoryInput, validateAdvisoryOutput, resolveAiPolicy } = require('../../../packages/ai-boundary/src/index');

function validateAiUpstream() {
  if (!cfg.aiUpstreamUrl) return null;
  let u;
  try {
    u = parseAttestedOutboundUrl(cfg.aiUpstreamUrl, {
      envName:'AI_UPSTREAM_URL', codePrefix:'AI_SELF_HOSTED',
      productionPort443:true
    });
  } catch (e) {
    const err = new Error(e && e.code === 'AI_SELF_HOSTED_HOST_NOT_ATTESTED' ? 'AI_SELF_HOSTED_HOST_NOT_ATTESTED' : (e.code || 'AI_UPSTREAM_URL_INVALID'));
    err.statusCode = 503; throw err;
  }
  const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (!production && process.env.ALLOW_PUBLIC_AI_UPSTREAM === 'true') { const e = new Error('AI_PUBLIC_UPSTREAM_FORBIDDEN'); e.statusCode = 503; throw e; }
  return u;
}

async function advise(body) {
  body = body || {};
  const input = normalizeAdvisoryInput(body);
  const aiPolicy = resolveAiPolicy(process.env);
  if (aiPolicy.inferenceConflict) return { ok:false, authority:'ADVISORY_ONLY', executionAuthorized:false, error:'AI_INFERENCE_CONFIGURATION_CONFLICT' };
  const upstream = aiPolicy.aiEnabled ? validateAiUpstream() : null;
  if (!aiPolicy.aiEnabled || !upstream) {
    const out = buildAdvisoryResponse(input, { aiEnabled: aiPolicy.aiEnabled, aiUpstreamUrl: cfg.aiUpstreamUrl || '' });
    assertNoExecutionAuthority(out); return out;
  }
  try {
    const target = await resolveAttestedOutboundTarget(upstream, { codePrefix:'AI_UPSTREAM' });
    if (!hasOnlyInternalNetworkTargets(target)) {
      return { ok:false, authority:'ADVISORY_ONLY', executionAuthorized:false, error:'AI_UPSTREAM_EXTERNAL_NETWORK_FORBIDDEN' };
    }
    const result = await requestAttestedJson(upstream, target, {
      codePrefix:'AI_UPSTREAM', method:'POST', timeoutMs:10000, maxResponseBytes:1024 * 1024,
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ question: input.question, context: input.context, ticketId: input.ticketId })
    });
    if (result.status >= 300 && result.status < 400) throw Object.assign(new Error('AI_UPSTREAM_REDIRECT_FORBIDDEN'), { statusCode: 502 });
    const out = { ok: result.ok, authority: 'ADVISORY_ONLY', executionAuthorized: false, upstreamStatus: result.status, advice: result.data, forbiddenActions: require('../../../packages/ai-boundary/src/index').FORBIDDEN_ACTIONS.slice() };
    validateAdvisoryOutput(out); assertNoExecutionAuthority(out); return out;
  } catch (e) {
    return { ok: false, authority: 'ADVISORY_ONLY', executionAuthorized: false, error: e.code === 'AI_UPSTREAM_TIMEOUT' ? 'AI_UPSTREAM_TIMEOUT' : 'AI_UPSTREAM_ERROR' };
  }
}
const server = http.createServer(async function (req, res) {
  const ddosToken = ddosGuard.admit(req.socket && req.socket.remoteAddress);
  const releaseDdos = () => ddosGuard.release(ddosToken);
  res.on('finish', releaseDdos);
  res.on('close', releaseDdos);
  if (!ddosToken.allow) {
    res.setHeader('Retry-After', String(ddosToken.retryAfter || 1));
    res.setHeader('X-FiberOS-DDoS-Guard', ddosToken.code || 'REJECTED');
    return send(res, ddosToken.status || 429, { ok: false, error: ddosToken.code || 'DDOS_GUARD_REJECTED', authority: 'DDOS_GUARD' });
  }
  try {
    applySecurityHeaders(res, process.env);
    const cors = applyCorsHeaders(res, req, process.env);
    if (!cors.allowed) return send(res, 403, { ok:false, error: cors.code, authority:'HTTP_SECURITY_ENFORCEMENT' });
    if (securityGate.config.production && !securityGate.ok) return send(res, 503, { ok:false, error:'SECURITY_CONFIGURATION_INVALID' });
    if (firewallGate.config.production && !firewallGate.ok) return send(res, 503, { ok:false, error:'SECURITY_FIREWALL_CONFIGURATION_INVALID' });
    const fw = firewallEvaluate({ method:req.method, path:(req.url || '/').split('?')[0], url:req.url || '/', headers:req.headers || {}, protocol:req.socket && req.socket.encrypted ? 'https' : '', remoteAddress:req.socket && req.socket.remoteAddress }, process.env);
    if (!fw.allow) { res.setHeader('X-FiberOS-Firewall', fw.code || 'REJECTED'); return send(res, fw.status || 400, { ok:false, error:fw.code || 'FIREWALL_REJECTED', authority:'SECURITY_FIREWALL' }); }
    const framing = validateHttpFraming(req);
    if (!framing.ok) return send(res, 400, { ok:false, error:'HTTP_FRAMING_REJECTED', failures:framing.failures, authority:'HTTP_SECURITY_ENFORCEMENT' });
    const abuse = validateRequestAbuseBoundary(req, process.env);
    if (!abuse.ok) return send(res, 400, { ok:false, error:'REQUEST_ABUSE_REJECTED', failures:abuse.failures, authority:'REQUEST_ABUSE_BOUNDARY' });
    let limit;
    try {
      limit = await rateLimiter.allow(rateKey(req, null, { scope:'ip' }));
    } catch (error) {
      if (error && error.code === 'REDIS_RATE_LIMIT_STORE_UNAVAILABLE') {
        return send(res, 503, { ok:false, error:'RATE_LIMIT_STORE_UNAVAILABLE', authority:'HTTP_SECURITY_ENFORCEMENT' });
      }
      throw error;
    }
    if (!limit.allowed) { res.setHeader('Retry-After', String(limit.retryAfter)); return send(res, 429, { ok:false, error:'RATE_LIMIT_EXCEEDED', authority:'HTTP_SECURITY_ENFORCEMENT' }); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin'
      });
      return res.end();
    }
    const url = parseUrl(req);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && path === '/health') {
      return send(res, 200, publicAiHealthResponse());
    }
    if (req.method === 'POST' && canonicalAiPath(path)) {
      const principal = await getRequestPrincipalAsync(req, process.env);
      const auth = requireVerifiedPrincipal(principal, process.env);
      if (!auth.ok) return send(res, auth.status, auth.body);
      const roleAdmission = authorizeAiRequest(principal, process.env, path);
      if (!roleAdmission.ok) return send(res, roleAdmission.status, roleAdmission.body);
      try {
        const principalLimit = await rateLimiter.allow(aiPrincipalRateKey(principal), { scope: 'principal', limitClass: 'strict' });
        if (!principalLimit.allowed) {
          res.setHeader('Retry-After', String(principalLimit.retryAfter));
          return send(res, 429, { ok: false, error: 'RATE_LIMIT_EXCEEDED', authority: 'HTTP_SECURITY_ENFORCEMENT' });
        }
      } catch (error) {
        if (error && error.code === 'REDIS_RATE_LIMIT_STORE_UNAVAILABLE') {
          return send(res, 503, { ok: false, error: 'RATE_LIMIT_STORE_UNAVAILABLE', authority: 'HTTP_SECURITY_ENFORCEMENT' });
        }
        throw error;
      }
      const body = await readBody(req);
      const out = await advise(body);
      return send(res, out && out.ok === false ? 502 : 200, out);
    }
    return notFound(res);
  } catch (e) {
    send(res, e.statusCode || 500, { ok: false, error: 'AI_UPSTREAM_ERROR' });
  }
});

server.listen(cfg.aiPort, cfg.aiBindHost, function () {
  logInfo('fiberos_ai_listening', {
    port: cfg.aiPort,
    authority: 'ADVISORY_ONLY',
    enabled: resolveAiPolicy(process.env).aiEnabled,
    bindHost: cfg.aiBindHost
  });
});
