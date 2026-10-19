#!/usr/bin/env node
'use strict';

const { info: logInfo, error: logError } = require('../../../packages/observability/src/logger');
const { startOpenTelemetry } = require('./instrumentation');
const otelStatus = startOpenTelemetry(process.env);
const http = require('http');
const { loadServerConfig } = require('../../../packages/core/src/config');
const interfaceContracts = require('../../../packages/interface-contracts/src/index');
const { createPool } = require('../../../packages/db/src/index');
const { readBody, readBodyRaw, send, notFound, parseUrl } = require('./http');
const { getRequestPrincipalAsync } = require('./auth');
const { getSessionPrincipal, validateSessionMutation } = require('./auth/sessionAuth');
const { createRedisSessionStore } = require('../../../packages/security/src/redisSessionStore');
const { createRedisReplayDefenseFromEnv } = require('../../../packages/security/src/redisReplayDefense');
const { createOidcAuthServer } = require('./auth/oidcAuthServer');
const { handleOidcRoute } = require('./routes/auth/oidc');
const { requireVerifiedPrincipal, requireAnyRole } = require('./requireAuth');
const { handleTicketTransition } = require('./routes/tickets');
const { handleEvidenceSubmit } = require('./routes/evidence');
const { handleFieldClose } = require('./routes/fieldClose');
const { handleLifecycleStep, handleLifecycleSelfTest } = require('./routes/lifecycle');
const { powerBudget } = require('../../../packages/domain/src/ftthRates');
const { evaluateOdnPowerBudget } = require('../../../packages/engineering/src/odnPowerBudget');
const { createHuaweiNmsAdapter } = require('../../../packages/adapters/src/huaweiNms');
const { createNokiaNmsAdapter } = require('../../../packages/adapters/src/nokiaNms');
const { createAdapterRegistry, NullVendorAdapter } = require('../../../packages/adapters/src/registry');
const { handleSyncBatch } = require('./routes/sync');
const { handleEngineering } = require('./routes/engineering');
const { handleRealityBoundary } = require('./routes/realityBoundary');
const { handleSharedRiskLinked } = require('./routes/sharedRiskLinked');
const { handleProductization } = require('./routes/productization');
const { handleOperations } = require('./routes/operations');
const { handleDepartmentKpis } = require('./routes/departmentKpis');
const { handleFttxEngineering } = require('./routes/fttxEngineering');
const { handleFieldTimeSlots } = require('./routes/fieldTimeSlots');
const { handleInstallation } = require('./routes/installation');
const { handleFault } = require('./routes/faults');
const { handleDeepGis } = require('./routes/deepGis');
const { handleAssurance } = require('./routes/assurance');
const { buildRouteStatusIndex, checkCapabilityRoute } = require('../../../packages/assurance/src/capabilityGate');
const capabilityCatalog = require('../../../config/html-feature-parity.json');
const capabilityRouteIndex = buildRouteStatusIndex(capabilityCatalog.capabilities);
const { handleAi } = require('./routes/ai');
const { handleIntelligence } = require('./routes/intelligence');
const { handleEngineeringIntelligence } = require('./routes/engineeringIntelligence');
const { handleContactCenterIntelligence } = require('./routes/contactCenterIntelligence');
const { handleMultilingualContactCenter } = require('./routes/contactCenterMultilingual');
const { handleSla } = require('./routes/sla');
const { handleManagementSurfaces } = require('./routes/managementSurfaces');
const { handleCommercialSurfaces } = require('./routes/commercialSurfaces');
const { handleCustomerPortal } = require('./routes/customerPortal');
const { handleContractorCommercial } = require('./routes/contractorCommercial');
const { handleRealityCommand } = require('./routes/realityCommand');
const { handleOpticsMeasurementSubmit, handleOpticsValidateOnly } = require('./routes/optics');
const { handleFtthAdvisory } = require('./routes/ftthAdvisory');
const { createRateLimiter, rateKey, clientAddress, securityConfig, applySecurityHeaders, applyCorsHeaders, validateSecurityConfiguration, securityPolicyFor, validateRequestAbuseBoundary, validateHttpFraming, replayProtectedRoute } = require('../../../packages/security/src/httpHardening');
const { evaluateRequest: firewallEvaluate, validateFirewallConfiguration, createSovereignBoundary } = require('../../../packages/security-firewall/src/index');
const { createDdosGuard } = require('../../../packages/security/src/ddosGuard');
const { publicError } = require('../../../packages/security/src/errorBoundary');
const { verifyRuntimeGate } = require('../../../packages/db/src/runtimeGate');
const { handleHealth } = require('./routes/health');
const { resolveBindHost } = require('./bindHost');
const { requiresAuthBeforeRuntime } = require('./routeAuthPolicy');
const { authorizeHttpRequest } = require('./authorizationMiddleware');

const cfg = loadServerConfig(process.env);
const db = createPool(process.env);
let runtimeGate = Object.freeze({ status: 'BLOCKED_PRECONDITION', productionReady: false, productionHold: true, reason: 'RUNTIME_GATE_NOT_INITIALIZED', checks: [] });
const securityConfigGate = validateSecurityConfiguration(process.env);
const firewallConfigGate = validateFirewallConfiguration(process.env);
const sovereignBoundary = createSovereignBoundary();
const edgeRateLimiter = createRateLimiter(process.env);
const principalRateLimiter = createRateLimiter({ ...process.env, SECURITY_RATE_LIMIT_PER_MINUTE: process.env.SECURITY_AUTH_RATE_LIMIT_PER_MINUTE || process.env.SECURITY_RATE_LIMIT_PER_MINUTE, SECURITY_RATE_LIMIT_BURST: process.env.SECURITY_AUTH_RATE_LIMIT_BURST || process.env.SECURITY_RATE_LIMIT_BURST });
const ddosGuard = createDdosGuard(process.env);

let oidcSessionStore = null;
try {
  if (String(process.env.FIBEROS_OIDC_ISSUER_URL || '').trim() || String(process.env.FIBEROS_OIDC_CLIENT_ID || '').trim()) {
    oidcSessionStore = createRedisSessionStore(process.env);
  }
} catch (error) {
  logError('oidc_session_store_bootstrap_failed', { code: error.code || 'SESSION_STORE_UNAVAILABLE' });
}
const oidcAuthServer = createOidcAuthServer({
  issuerUrl: process.env.FIBEROS_OIDC_ISSUER_URL,
  clientId: process.env.FIBEROS_OIDC_CLIENT_ID,
  clientSecret: process.env.FIBEROS_OIDC_CLIENT_SECRET,
  redirectUri: `${String(process.env.FIBEROS_OPS_API_BASE_URL || '').replace(/\/$/, '')}/auth/oidc/callback`,
  dashboardUrl: process.env.FIBEROS_OPS_WEB_DASHBOARD_URL || '/dashboard',
  sessionStore: oidcSessionStore,
  env: process.env
});
let replayDefense = null;
try {
  if ((String(process.env.FIBEROS_REPLAY_DEFENSE_BACKEND || 'PROCESS_LOCAL').toUpperCase()) === 'REDIS') {
    replayDefense = createRedisReplayDefenseFromEnv(process.env, { prefix: process.env.FIBEROS_REPLAY_REDIS_PREFIX || 'fiberos:replay:v1', ttlSeconds: Number(process.env.FIBEROS_REPLAY_TTL_SECONDS || 300) });
  }
} catch (error) {
  logError('replay_defense_bootstrap_failed', { code: error.code || 'REPLAY_DEFENSE_REDIS_FAILED' });
}

const registry = createAdapterRegistry();
registry.register(NullVendorAdapter);
if (process.env.NMS_VENDOR === 'huawei') {
  registry.register(createHuaweiNmsAdapter({
    baseUrl: process.env.NMS_BASE_URL || '',
    apiKey: process.env.NMS_API_KEY || ''
  }));
} else if (process.env.NMS_VENDOR === 'nokia') {
  registry.register(createNokiaNmsAdapter({
    baseUrl: process.env.NMS_BASE_URL || '',
    apiKey: process.env.NMS_API_KEY || ''
  }));
}

function guardWrite(principal, res) {
  const g = requireVerifiedPrincipal(principal, process.env);
  if (!g.ok) {
    send(res, g.status, g.body);
    return null;
  }
  return g.principal;
}

const server = http.createServer(async function (req, res) {
  const ddosToken = ddosGuard.admit(clientAddress(req, securityConfig(process.env)));
  if (!ddosToken.allow) {
    res.setHeader('Retry-After', String(ddosToken.retryAfter || 1));
    res.setHeader('X-FiberOS-DDoS-Guard', ddosToken.code || 'REJECTED');
    return send(res, ddosToken.status || 429, {
      ok: false,
      error: ddosToken.code || 'DDOS_GUARD_REJECTED',
      authority: 'DDOS_GUARD'
    });
  }
  try {
    applySecurityHeaders(res, process.env);
    const cors = applyCorsHeaders(res, req, process.env);
    if (!cors.allowed) return send(res, 403, { ok:false, error: cors.code, authority:'HTTP_SECURITY_ENFORCEMENT' });
    const requestBoundaryPath = String(req.url || '/').split('?')[0] || '/';
    if (securityConfigGate.config.production && !securityConfigGate.ok && requestBoundaryPath !== '/health') {
      return send(res, 503, { ok:false, error:'SECURITY_CONFIGURATION_INVALID', authority:'HTTP_SECURITY_ENFORCEMENT' });
    }
    if (firewallConfigGate.config.production && !firewallConfigGate.ok && requestBoundaryPath !== '/health') {
      return send(res, 503, { ok:false, error:'SECURITY_FIREWALL_CONFIGURATION_INVALID', authority:'SECURITY_FIREWALL' });
    }
    const fw = firewallEvaluate({
      method: req.method,
      path: (req.url || '/').split('?')[0],
      url: req.url || '/',
      headers: req.headers || {},
      protocol: req.socket && req.socket.encrypted ? 'https' : '',
      remoteAddress: req.socket && req.socket.remoteAddress
    }, process.env);
    if (!fw.allow) {
      res.setHeader('X-FiberOS-Firewall', fw.code || 'REJECTED');
      return send(res, fw.status || 400, { ok:false, error: fw.code || 'FIREWALL_REJECTED', authority:'SECURITY_FIREWALL' });
    }
    const kernelBoundaryRequired = String(process.env.FIBEROS_KERNEL_BOUNDARY_REQUIRED || '').toLowerCase() === 'true';
    if (kernelBoundaryRequired && requestBoundaryPath !== '/health') {
      const kernel = sovereignBoundary.evaluate({ method:req.method, path:requestBoundaryPath, headers:req.headers || {} }, process.env);
      if (!kernel.allow) {
        for (const [name, value] of Object.entries(kernel.securityHeaders || {})) res.setHeader(name, value);
        return send(res, kernel.status || 401, { ok:false, error:'KERNEL_BOUNDARY_REJECTED', authority:'SECURITY_FIREWALL' });
      }
    }
    const framing = validateHttpFraming(req);
    if (!framing.ok) return send(res, 400, { ok:false, error:'HTTP_FRAMING_REJECTED', failures:framing.failures, authority:'HTTP_SECURITY_ENFORCEMENT' });
    const abuse = validateRequestAbuseBoundary(req, process.env);
    if (!abuse.ok) return send(res, 400, { ok:false, error:'REQUEST_ABUSE_REJECTED', failures:abuse.failures, authority:'REQUEST_ABUSE_BOUNDARY' });
    const edgePath = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    const edgePolicy = securityPolicyFor(edgePath, req.method, null);
    let edgeLimit;
    try {
      edgeLimit = await edgeRateLimiter.allow(rateKey(req, null, edgePolicy), edgePolicy);
    } catch (error) {
      if (error && error.code === 'REDIS_RATE_LIMIT_STORE_UNAVAILABLE') {
        return send(res, 503, { ok:false, error:'RATE_LIMIT_STORE_UNAVAILABLE', authority:'HTTP_SECURITY_ENFORCEMENT' });
      }
      throw error;
    }
    if (!edgeLimit.allowed) {
      res.setHeader('Retry-After', String(edgeLimit.retryAfter));
      res.setHeader('X-RateLimit-Limit', String(edgeLimit.limit ?? 0));
      res.setHeader('X-RateLimit-Remaining', '0');
      return send(res, 429, { ok:false, error:'RATE_LIMIT_EXCEEDED', policy:'edge_ip', authority:'HTTP_SECURITY_ENFORCEMENT' });
    }
    if (edgeRateLimiter.configured) {
      res.setHeader('X-RateLimit-Limit', String(edgeLimit.limit ?? (securityConfigGate.config.rateLimitPerMinute + securityConfigGate.config.rateLimitBurst)));
      res.setHeader('X-RateLimit-Remaining', String(edgeLimit.remaining));
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Id, X-Kernel-Timestamp, X-Kernel-Nonce, X-Kernel-Signature, X-Content-SHA256, X-FiberOS-CSRF, X-Idempotency-Key',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin'
      });
      return res.end();
    }

    const url = parseUrl(req);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path.startsWith('/auth/oidc')) {
      const oidcResult = await handleOidcRoute(req, res, { oidcServer: oidcAuthServer, send, env: process.env });
      if (oidcResult !== null) return oidcResult;
    }

    if (path === '/health' && req.method === 'GET') {
      const health = handleHealth(runtimeGate, cfg, db, securityConfigGate, otelStatus);
      return send(res, health.statusCode, health.body);
    }

    // Authenticate before the runtime/DB gate so protected endpoints fail with
    // the correct identity error (401) rather than masking missing/invalid
    // credentials behind a database precondition (503). This does not lift the
    // runtime hold: authenticated callers still receive the hold response below.
    // Pass raw process.env, not `cfg` — see the fix note in ./auth.js.
    // `cfg` is a normalized, camelCase config object; the JWT verifier needs
    // the actual JWT_SECRET / SUPABASE_JWT_SECRET / JWT_VERIFY env var names.
    const capabilityCheck = checkCapabilityRoute(capabilityRouteIndex, req.method, path);
    if (!capabilityCheck.ok) return send(res, capabilityCheck.status, capabilityCheck.body);

    let principal = await getRequestPrincipalAsync(req, process.env);
    let sessionPrincipal = null;
    if (!principal.authenticated && oidcAuthServer && oidcAuthServer.configured) {
      sessionPrincipal = await getSessionPrincipal(req, oidcAuthServer);
      if (sessionPrincipal.present && sessionPrincipal.error) return send(res, 503, { ok: false, error: sessionPrincipal.error, authority: 'OIDC_SESSION_BOUNDARY' });
      if (sessionPrincipal.authenticated) principal = sessionPrincipal;
    }

    if (requiresAuthBeforeRuntime(path, req.method)) {
      const preRuntimeAuth = requireVerifiedPrincipal(principal, process.env);
      if (!preRuntimeAuth.ok) return send(res, preRuntimeAuth.status, preRuntimeAuth.body);
    }

    const authorizationAdmission = authorizeHttpRequest(principal, { path, method: req.method });
    if (!authorizationAdmission.ok) return send(res, authorizationAdmission.status, authorizationAdmission.body);

    if (!runtimeGate.runtimeVerified) {
      return send(res, 503, {
        ok: false,
        error: 'BLOCKED_PRECONDITION',
        status: 'BLOCKED_PRECONDITION',
        productionReady: false,
        productionHold: true,
        reason: 'RUNTIME_PRECONDITION_FAILED',
        authority: 'POSTGRESQL_REALITY_GATE'
      });
    }

    if (sessionPrincipal && sessionPrincipal.authenticated) {
      const csrf = validateSessionMutation(req, sessionPrincipal, process.env);
      if (!csrf.ok) return send(res, csrf.status, csrf.body);
    }
    if (replayProtectedRoute(path, req.method, process.env)) {
      const backend = String(process.env.FIBEROS_REPLAY_DEFENSE_BACKEND || 'PROCESS_LOCAL').toUpperCase();
      if (backend !== 'REDIS' || !replayDefense) {
        return send(res, 503, { ok: false, error: 'REPLAY_DEFENSE_NOT_AVAILABLE', authority: 'HTTP_SECURITY_ENFORCEMENT' });
      }
      const nonce = String(req.headers['x-idempotency-key'] || '').trim();
      if (!nonce) return send(res, 400, { ok: false, error: 'X_IDEMPOTENCY_KEY_REQUIRED', authority: 'REPLAY_DEFENSE' });
      const replayContext = {
        userId: principal.sub,
        tenantId: req.headers['x-tenant-id'] || null,
        operationType: `${req.method}:${path}`
      };
      let reservation;
      try {
        reservation = await replayDefense.reserve(nonce, replayContext);
      } catch (error) {
        return send(res, 503, { ok: false, error: error.code || 'REPLAY_DEFENSE_REDIS_FAILED', authority: 'REPLAY_DEFENSE' });
      }
      if (reservation.replay) return send(res, 429, { ok: false, error: 'DUPLICATE_REQUEST', authority: 'REPLAY_DEFENSE', retryAfter: Number(process.env.FIBEROS_REPLAY_TTL_SECONDS || 300) });
      // Reservation is only a concurrency lock. A failed downstream response
      // must release it so network/validation failures can be retried and
      // reach the endpoint's real idempotency contract.
      res.once('finish', function () {
        if (res.statusCode >= 400 && res.statusCode !== 429) {
          replayDefense.revoke(nonce, replayContext).catch(function (error) {
            logError('replay_reservation_release_failed', { code: error && error.code || 'REPLAY_RELEASE_FAILED' });
          });
        }
      });
    }

    const policy = securityPolicyFor(path, req.method, principal);
    if (principal && policy.scope === 'principal') {
      let principalLimit;
      try {
        principalLimit = await principalRateLimiter.allow(rateKey(req, principal, policy), policy);
      } catch (error) {
        if (error && error.code === 'REDIS_RATE_LIMIT_STORE_UNAVAILABLE') {
          return send(res, 503, { ok:false, error:'RATE_LIMIT_STORE_UNAVAILABLE', authority:'HTTP_SECURITY_ENFORCEMENT' });
        }
        throw error;
      }
      if (!principalLimit.allowed) {
        res.setHeader('Retry-After', String(principalLimit.retryAfter));
        res.setHeader('X-RateLimit-Limit', String(principalLimit.limit ?? 0));
        res.setHeader('X-RateLimit-Remaining', '0');
        return send(res, 429, { ok:false, error:'RATE_LIMIT_EXCEEDED', policy:policy.name, authority:'HTTP_SECURITY_ENFORCEMENT' });
      }
      res.setHeader('X-RateLimit-Limit', String(principalLimit.limit ?? 0));
      res.setHeader('X-RateLimit-Remaining', String(principalLimit.remaining));
      res.setHeader('X-FiberOS-RateLimit-Scope', policy.name + ':principal');
    } else {
      res.setHeader('X-FiberOS-RateLimit-Scope', policy.name + ':ip');
    }
    // This must cover EVERY path branch inside handleOperations()
    // (services/api/src/routes/operations.js), not just the ones that
    // happened to need a body when this list was last edited. A path that
    // is handled there but missing here silently gets operationBody=null on
    // POST, which made /v1/contact-center/agents/presence and
    // /v1/events/runtime/validate permanently fail — see the fix note in
    // operations.js's own route list (keep the two in sync).
    const isOperationsPath = path === '/v1/intelligence/graph' || path === '/v1/intelligence/engineering' || path === '/v1/ai/advise' || path.startsWith('/v1/call-center/') || path.startsWith('/v1/crisis/') || path === '/v1/dispatch/rank' || path === '/v1/executive/financial-snapshot' || path === '/v1/command/fabric/overview' || path === '/v1/gis/fusion/layers' || path === '/v1/contact-center/intelligence' || path === '/v1/contact-center/agents/presence' || path.startsWith('/v1/contact-center/customer-360/') || path.startsWith('/v1/operations/case-context/') || path.startsWith('/v1/network-intelligence/') || path === '/v1/events/processing/health' || path === '/v1/events/runtime/validate' || path === '/v1/events/runtime/recovery' || path === '/v1/integration/readiness' || path === '/v1/security/hardening/readiness' || path.startsWith('/v1/commercial/cost-calibration/') || path === '/v1/extensions/validate' || path.startsWith('/v1/network-intelligence/root-cause/') || path.startsWith('/v1/network-intelligence/optical-health/') || path.startsWith('/v1/network-intelligence/capacity/') || path.startsWith('/v1/operations/evidence-chain/') || path.startsWith('/v1/installations/') || path.startsWith('/v1/faults/');
    let operationBody = null;
    let operationRawBody = null;
    if (isOperationsPath && req.method === 'POST') {
      if (path === '/v1/call-center/ivr/inbound') {
        operationRawBody = await readBodyRaw(req);
        // M-6 fix (2026-09-17): an unguarded JSON.parse here threw a raw
        // SyntaxError with no statusCode, which publicError() then collapsed
        // to 500 INTERNAL_SERVER_ERROR for what is actually a client input
        // problem (malformed webhook body) — should be 400.
        if (operationRawBody) {
          try {
            operationBody = JSON.parse(operationRawBody);
          } catch (e) {
            throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400, code: 'INVALID_JSON' });
          }
        } else {
          operationBody = null;
        }
      } else {
        operationBody = await readBody(req);
      }
    }
    const deepGisResult = await handleDeepGis(req, res, { method: req.method, path, principal, db, send });
    if (deepGisResult !== null) return deepGisResult;

    const installationResult = await handleInstallation(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (installationResult !== null) return installationResult;

    const faultResult = await handleFault(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (faultResult !== null) return faultResult;

    const departmentKpiResult = await handleDepartmentKpis(req, res, { method: req.method, path, principal, db, send });
    if (departmentKpiResult !== null) return departmentKpiResult;

    {
      let fttxBody = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        try { fttxBody = await readBody(req); } catch (_) { fttxBody = {}; }
      }
      const fttxResult = await handleFttxEngineering(req, res, {
        method: req.method, path, principal, db, send, body: fttxBody
      });
      if (fttxResult !== null && fttxResult !== undefined) return fttxResult;
    }

    {
      let slotBody = null;
      if (req.method === 'POST') {
        try { slotBody = await readBody(req); } catch (_) { slotBody = {}; }
      }
      const slotResult = await handleFieldTimeSlots(req, res, {
        method: req.method, path, principal, db, send, body: slotBody
      });
      if (slotResult !== null && slotResult !== undefined) return slotResult;
    }

    const multilingualContactCenterResult = await handleMultilingualContactCenter(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (multilingualContactCenterResult !== null) return multilingualContactCenterResult;

    const operationsResult = await handleOperations(req, res, { method: req.method, path, body: operationBody, rawBody: operationRawBody, principal, db, send });
    if (operationsResult !== null) return operationsResult;

    const slaResult = await handleSla(req, res, { method: req.method, path, principal, db, send });
    if (slaResult !== null) return slaResult;

    const managementResult = await handleManagementSurfaces(req, res, { method: req.method, path, principal, db, send });
    if (managementResult !== null) return managementResult;

    const commercialResult = await handleCommercialSurfaces(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (commercialResult !== null) return commercialResult;
    if (path.startsWith('/v1/customer-portal/') || path.startsWith('/v1/contractor-commercial/')) {
      const portalBody = operationBody;
      const customerPortalResult = await handleCustomerPortal(req, res, { method: req.method, path, body: portalBody, principal, db, send });
      if (customerPortalResult !== null) return customerPortalResult;
    }

    if (path.startsWith('/v1/contractor-commercial/')) {
      const contractorCommercialResult = await handleContractorCommercial(req, res, {
        method: req.method,
        path,
        body: operationBody,
        principal,
        db,
        send
      });
      if (contractorCommercialResult !== null) return contractorCommercialResult;
    }

    const realityCommandResult = await handleRealityCommand(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (realityCommandResult !== null) return realityCommandResult;

    const assuranceResult = await handleAssurance(req, res, { method: req.method, path, principal, send });
    if (assuranceResult !== null) return assuranceResult;

    const sharedRiskLinkedResult = await handleSharedRiskLinked(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (sharedRiskLinkedResult !== null) return sharedRiskLinkedResult;

    const intelligenceResult = await handleIntelligence(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (intelligenceResult !== null) return intelligenceResult;

    const engineeringIntelligenceResult = await handleEngineeringIntelligence(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (engineeringIntelligenceResult !== null) return engineeringIntelligenceResult;

    const contactCenterIntelligenceResult = await handleContactCenterIntelligence(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (contactCenterIntelligenceResult !== null) return contactCenterIntelligenceResult;

    const aiResult = await handleAi(req, res, { method: req.method, path, body: operationBody, principal, db, send });
    if (aiResult !== null) return aiResult;

    if (req.method === 'GET' && path === '/v1/meta') {
      return send(res, 200, {
        ok: true,
        authority: 'server',
        productionHold: cfg.productionHold,
        interfaceContracts: interfaceContracts.summary(),
        endpoints: [
          'GET /health',
          'GET /v1/meta',
          'POST /v1/intelligence/graph',
          'POST /v1/intelligence/engineering',
          'POST /v1/contact-center/intelligence',
          'GET /v1/contact-center/runtime/status',
          'GET /v1/operations/department-kpis/{department}',
          'GET /v1/organization/operating-model',
          'POST /v1/ai/advise',
          'GET /v1/lifecycle/self-test',
          'POST /v1/tickets/transition',
          'POST /v1/tickets/lifecycle/step',
          'POST /v1/tickets/close-field',
          'POST /v1/evidence/submit',
          'POST /v1/optics/power-budget',
          'POST /v1/optics/measurements',
          'POST /v1/optics/validate',
          'POST /v1/engineering/{optical-budget|correlated-optical-margin|residual|reliability|weibull-mle|proportional-hazard|diagnosis|gaussian-fusion|correlated-gaussian-fusion|blast-radius|shortest-path|max-flow|edge-disjoint-paths|expected-utility|risk-adjusted-utility|cvar-loss|uncertainty-budget|mahalanobis|drift|validate-calibration}',
          'POST /v1/engineering/{shared-risk-exposure|what-if-resource-fails|critical-concentration|service-path-dependencies|shared-risk-from-service-paths|service-paths-from-trace|shared-risk-from-trace-nodes}',
          'POST /v1/reality-boundary/{optical-assurance|optical-assurance-ledger|validate-optical-evidence|pon-adapter-declaration|pon-telemetry-sample|pon-telemetry-batch|pon-correlation-keys}',
          'GET /v1/gis/fleet',
          'GET /v1/gis/network-twin',
          'POST /v1/gis/twin/impact',
          'GET /v1/noc/3d/scene',
          'POST /v1/gis/twin/simulate',
          'GET /v1/gis/twin/capacity/{assetId}',
          'POST /v1/gis/nearest-technicians','POST /v1/gis/technician-density-cluster',
          'POST /v1/gis/positions',
          'POST /v1/routing/plan',
          'POST /v1/inventory/adjust',
          'POST /v1/messaging/enqueue',
          'POST /v1/billing/invoices',
          'GET /v1/customer/tickets',
          'GET /v1/adapters',
          'POST /v1/sync/batch',
          'POST /v1/call-center/sessions',
          'POST /v1/call-center/sessions/{id}/ivr',
          'GET /v1/call-center/queue/status',
          'POST /v1/call-center/queue/assign',
          'POST /v1/call-center/queue/release',
          'POST /v1/call-center/ivr/inbound',
          'GET /v1/crisis/command-state',
          'POST /v1/crisis/incidents',
          'POST /v1/dispatch/rank',
          'GET /v1/executive/financial-snapshot',
          'GET /v1/operations/sla-command',
          'GET /v1/audit/events','GET /v1/notifications/center','GET /v1/migration-center/overview','GET /v1/workflows/overview','GET /v1/operations/workload-balance',
          'GET /v1/security/rbac/effective','GET /v1/subcontractors/overview','GET /v1/smart-inventory/overview',
          'GET /v1/enterprise/fiber-dna/{assetId}','GET /v1/operations/timeline','GET /v1/security/zero-trust/readiness',
          'GET /v1/executive/radar','GET /v1/executive/radar/report','GET /v1/executive/commercial-report',
          'GET /v1/customer-portal/bootstrap','GET /v1/customer-portal/overview','GET /v1/customer-portal/plans','GET /v1/customer-portal/work-types','GET /v1/customer-portal/subscription','GET /v1/customer-portal/members',
          'GET /v1/customer-portal/entitlements','POST /v1/customer-portal/usage/authorize','GET /v1/customer-portal/orders','POST /v1/customer-portal/orders','POST /v1/customer-portal/orders/{id}/transition','POST /v1/customer-portal/sla/clocks','POST /v1/customer-portal/sla/evaluate',
          'GET /v1/contractor-commercial/work-packages','POST /v1/contractor-commercial/links','POST /v1/contractor-commercial/work-packages/{id}/transition','POST /v1/contractor-commercial/measurements','POST /v1/contractor-commercial/measurements/{id}/transition','POST /v1/contractor-commercial/reconciliations','POST /v1/contractor-commercial/reconciliations/{id}/transition','POST /v1/contractor-commercial/sla/enforce',
          'GET /v1/reality-access/catalog','GET /v1/reality-access/policy','GET /v1/reality-access/policy/{scopeType}/{scopeKey}','POST /v1/reality-access/policy','POST /v1/reality-access/plan','POST /v1/reality-access/resolve','POST /v1/reality-access/proof/field-photo','POST /v1/reality-command/evidence','POST /v1/reality-command/evidence/link','POST /v1/reality-command/incidents/{incidentId}/links','POST /v1/reality-command/incidents/{incidentId}/impact','GET /v1/reality-command/incidents/{incidentId}/state',
          'POST /v1/customer-portal/members','POST /v1/customer-portal/subscriptions','POST /v1/customer-portal/subscriptions/{id}/cancel','POST /v1/customer-portal/subscriptions/{id}/auto-renew','POST /v1/customer-portal/subscriptions/{id}/pause','POST /v1/customer-portal/subscriptions/{id}/resume',
          'GET /v1/customer-portal/report-schedules','POST /v1/customer-portal/report-schedules','POST /v1/customer-portal/report-schedules/{id}/pause','POST /v1/customer-portal/report-schedules/{id}/resume','POST /v1/customer-portal/reports/run','GET /v1/customer-portal/reports','GET /v1/customer-portal/reports/{id}',
          'GET /v1/commercial/cost-calibration','POST /v1/commercial/cost-calibration/propose','POST /v1/commercial/cost-calibration/approve',
          'GET /v1/extensions/registry','POST /v1/extensions/validate','GET /v1/memory/recent','GET /v1/memory/query','GET /v1/security/trust/overview','GET /v1/contracts/runtime','GET /v1/company/operating-system',
          'GET /v1/cx/heatmap','GET /v1/customer/self-diagnostic/{reference}',
          'GET /v1/command/fabric/overview',
          'GET /v1/assurance/capabilities',
          'POST /v1/billing/payment-cycle',
          'POST /v1/billing/payment-cycle/{cycleId}/transition',
          'POST /v1/ops/rework-cases',
          'POST /v1/ops/rework-cases/{caseId}/close',
          'GET /v1/crisis/incidents/{incidentId}/impact',
          'GET /v1/operations/realtime/snapshot',
                    'GET /v1/contact-center/languages','POST /v1/contact-center/speech/probe','POST /v1/contact-center/speech/select','POST /v1/contact-center/conversations','GET /v1/contact-center/conversations/{id}','POST /v1/contact-center/conversations/{id}/language','POST /v1/contact-center/conversations/{id}/messages',
'GET /v1/contact-center/customer-360/{reference}',
          'GET /v1/operations/case-context/{reference}',
          'GET /v1/network-intelligence/topology/{assetId}',
          'GET /v1/network-intelligence/path/{assetId}',
          'GET /v1/network-intelligence/traverse/{assetId}',
          'GET /v1/network-intelligence/impact/{assetId}',
          'GET /v1/network-intelligence/customer-impact/{assetId}',
          'GET /v1/network-intelligence/root-cause/{assetId}',
          'GET /v1/network-intelligence/optical-health/{assetId}',
          'GET /v1/network-intelligence/capacity/{assetId}',
          'POST /v1/network-intelligence/shared-risk',
          'GET /v1/operations/evidence-chain/{ticketId}',
          'POST /v1/operations/evidence-chain/{ticketId}/certify',
          'GET /v1/events/processing/health',
          'POST /v1/events/runtime/validate',
          'GET /v1/events/runtime/recovery',
          'GET /v1/integration/readiness',
          'GET /v1/security/hardening/readiness',
          'GET /v1/gis/deep-snapshot',
          'POST /v1/gis/otdr-chain-to-map',
          'GET /v1/public/installations/tracking/{token}',
          'POST /v1/installations/intake',
          'GET /v1/installations/{id}',
          'GET /v1/installations/{id}/tracking',
          'POST /v1/installations/{id}/verify',
          'POST /v1/installations/{id}/schedule',
          'POST /v1/installations/{id}/dispatch',
          'POST /v1/installations/{id}/accept',
          'POST /v1/installations/{id}/start',
          'POST /v1/installations/{id}/evidence',
          'POST /v1/installations/{id}/feedback',
          'POST /v1/installations/{id}/complete',
          'POST /v1/faults/intake',
          'POST /v1/faults/{id}/verify',
          'POST /v1/faults/{id}/schedule',
          'POST /v1/faults/{id}/dispatch',
          'POST /v1/faults/{id}/accept',
          'POST /v1/faults/{id}/start',
          'POST /v1/faults/{id}/evidence',
          'POST /v1/faults/{id}/feedback',
          'POST /v1/faults/{id}/resolve',
          'GET /v1/public/faults/tracking/{token}'
        ]
      });
    }

    if (req.method === 'GET' && path === '/v1/lifecycle/self-test') {
      const out = handleLifecycleSelfTest();
      return send(res, out.status, out.body);
    }

    if (req.method === 'GET' && path === '/v1/adapters') {
      const adapterAuth = requireVerifiedPrincipal(principal, process.env);
      if (!adapterAuth.ok) return send(res, adapterAuth.status, adapterAuth.body);
      return send(res, 200, {
        ok: true,
        adapters: registry.list().map(function (a) {
          return { vendorId: a.vendorId, displayName: a.displayName, capabilities: a.capabilities };
        })
      });
    }

    if (req.method === 'POST' && path === '/v1/tickets/transition') {
      const p = guardWrite(principal, res);
      if (!p) return;
      const body = await readBody(req);
      const out = await handleTicketTransition(body, p, db);
      return send(res, out.status, out.body);
    }

    if (req.method === 'POST' && path === '/v1/tickets/lifecycle/step') {
      const p = guardWrite(principal, res);
      if (!p) return;
      const body = await readBody(req);
      // Lifecycle authorization is DB-authoritative. Do not duplicate the
      // target-state role decision here; PostgreSQL validates the current state,
      // tenant, role, lock, and allowed transition atomically.
      const out = await handleLifecycleStep(body, p, db);
      return send(res, out.status, out.body);
    }

    if (req.method === 'POST' && path === '/v1/tickets/close-field') {
      const p = guardWrite(principal, res);
      if (!p) return;
      const body = await readBody(req);
      const out = await handleFieldClose(body, p, db, cfg);
      return send(res, out.status, out.body);
    }

    if (req.method === 'POST' && path === '/v1/evidence/submit') {
      const p = guardWrite(principal, res);
      if (!p) return;
      const body = await readBody(req);
      const out = await handleEvidenceSubmit(body, p, db, cfg);
      return send(res, out.status, out.body);
    }

    if (req.method === 'POST' && path === '/v1/sync/batch') {
      const p = guardWrite(principal, res);
      if (!p) return;
      const body = await readBody(req);
      const out = await handleSyncBatch(body, p, db);
      return send(res, out.status, out.body);
    }

    if (path.startsWith('/v1/gis/') || path === '/v1/routing/plan' || path === '/v1/inventory/adjust' || path === '/v1/messaging/enqueue' || path === '/v1/billing/invoices' || path === '/v1/billing/payment-cycle' || (path.startsWith('/v1/billing/payment-cycle/') && path.endsWith('/transition')) || path === '/v1/customer/tickets' || path === '/v1/ops/rework-cases' || (path.startsWith('/v1/ops/rework-cases/') && path.endsWith('/close'))) {
      const productBody = req.method === 'POST' ? await readBody(req) : null;
      const productizationResult = await handleProductization(req, res, { method: req.method, path, body: productBody, principal, db, send });
      if (productizationResult !== null) return productizationResult;
    }


    if (req.method === 'POST' && path.startsWith('/v1/reality-boundary/')) {
      const auth = requireVerifiedPrincipal(principal, process.env);
      if (!auth.ok) return send(res, auth.status, auth.body);
      const body = await readBody(req);
      const out = await handleRealityBoundary(path, body);
      return send(res, out.status, out.body);
    }

    if (req.method === 'POST' && path.startsWith('/v1/engineering/')) {
      // Engineering calculations are advisory and non-persistent, but they are
      // still a privileged API surface: require a verified principal so the
      // endpoint cannot be used anonymously as an internal compute oracle.
      const auth = requireVerifiedPrincipal(principal, process.env);
      if (!auth.ok) return send(res, auth.status, auth.body);
      const body = await readBody(req);
      const out = handleEngineering(path, body);
      return send(res, out.status, out.body);
    }

    if (req.method === 'POST' && path === '/v1/optics/validate') {
      // H-6 fix (2026-09-17): previously reachable with no principal at all.
      // Now gated by requiresAuthBeforeRuntime()/requireVerifiedPrincipal()
      // above (routeAuthPolicy.js no longer exempts this path), consistent
      // with /v1/engineering/* — advisory/compute-only endpoints still
      // require a verified principal so they cannot be used anonymously as
      // a free compute-oracle / resource-exhaustion surface.
      const body = await readBody(req);
      const out = await handleOpticsValidateOnly(body);
      return send(res, out.status, out.body);
    }

    if (req.method === 'POST' && path === '/v1/optics/measurements') {
      const p = guardWrite(principal, res);
      if (!p) return;
      const body = await readBody(req);
      const out = await handleOpticsMeasurementSubmit(body, p, db);
      return send(res, out.status, out.body);
    }

    if (req.method === 'POST' && path === '/v1/optics/power-budget') {
      // Auth required (H-6). Primary engine: odnPowerBudget (versioned class windows).
      // Optional body.legacySimple=true keeps domain/ftthRates helper as secondary advisory.
      const auth = requireVerifiedPrincipal(principal, process.env);
      if (!auth.ok) return send(res, auth.status, auth.body);
      const body = await readBody(req) || {};
      try {
        if (body.legacySimple === true) {
          const simple = powerBudget(body);
          return send(res, 200, {
            ok: true,
            result: simple,
            engine: 'domain/ftthRates.powerBudget',
            engineVersion: 'legacy-simple',
            calculatedNotMeasured: true,
            authority: 'CALCULATED_NOT_MEASURED',
            decision: 'ADVISORY_ONLY'
          });
        }
        const odn = evaluateOdnPowerBudget(body);
        const statusCode = odn.rejected || odn.blocked ? 422 : 200;
        return send(res, statusCode, {
          ok: odn.accepted === true,
          result: odn,
          engine: 'engineering/odnPowerBudget.evaluateOdnPowerBudget',
          engineVersion: odn.engineVersion,
          calculatedNotMeasured: true,
          authority: 'CALCULATED_NOT_MEASURED'
        });
      } catch (e) {
        return send(res, e.statusCode || 400, {
          ok: false,
          error: e.code || e.message,
          calculatedNotMeasured: true
        });
      }
    }

    if (req.method === 'POST' && (path.startsWith('/v1/ftth-advisory/') || path.startsWith('/v1/ftth/'))) {
      // Advisory FTTH surfaces (A–F). Authenticated like engineering compute.
      const auth = requireVerifiedPrincipal(principal, process.env);
      if (!auth.ok) return send(res, auth.status, auth.body);
      const body = await readBody(req);
      const out = handleFtthAdvisory(path, body);
      return send(res, out.status, out.body);
    }

    return notFound(res);
  } catch (e) {
    const out = publicError(e);
    logError('api_request_error', { status: out.status, code: e && e.code ? String(e.code) : undefined });
    send(res, out.status, out.body);
  } finally {
    ddosGuard.release(ddosToken);
  }
});


// Explicit transport time bounds prevent slow-client resource pinning while
// keeping the defaults configurable for deployment-specific envelopes.
const serverRequestTimeoutMs = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 120000);
const serverHeadersTimeoutMs = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 30000);
const serverKeepAliveTimeoutMs = Number(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS || 5000);
const serverMaxHeadersCount = Number(process.env.SERVER_MAX_HEADERS_COUNT || 100);
if (Number.isInteger(serverRequestTimeoutMs) && serverRequestTimeoutMs > 0) server.requestTimeout = serverRequestTimeoutMs;
if (Number.isInteger(serverHeadersTimeoutMs) && serverHeadersTimeoutMs > 0) server.headersTimeout = serverHeadersTimeoutMs;
if (Number.isInteger(serverKeepAliveTimeoutMs) && serverKeepAliveTimeoutMs > 0) server.keepAliveTimeout = serverKeepAliveTimeoutMs;
if (Number.isInteger(serverMaxHeadersCount) && serverMaxHeadersCount >= 0) server.maxHeadersCount = serverMaxHeadersCount;


async function bootstrap() {
  runtimeGate = Object.freeze(await verifyRuntimeGate(db));
  logInfo('runtime_gate', {
    status: runtimeGate.status,
    productionReady: runtimeGate.productionReady,
    productionHold: runtimeGate.productionHold,
    reason: runtimeGate.reason || null
  });

  server.listen(cfg.apiPort, resolveBindHost(process.env), function () {
    logInfo('fiberos_api_listening', {
      port: cfg.apiPort,
      productionReady: runtimeGate.productionReady,
      productionHold: runtimeGate.productionHold,
      database: db.configured,
      jwtSecretConfigured: !!(process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET),
      msg: 'listening'
    });
  });
}

bootstrap().catch(function (e) {
  runtimeGate = Object.freeze({
    status: 'BLOCKED_PRECONDITION',
    productionReady: false,
    productionHold: true,
    reason: e && e.message ? String(e.message) : 'RUNTIME_GATE_BOOTSTRAP_FAILED',
    checks: []
  });
  logError('runtime_gate_bootstrap_failed', { error: runtimeGate.reason });
  server.listen(cfg.apiPort, resolveBindHost(process.env), function () {
    logInfo('fiberos_api_listening_blocked', {
      port: cfg.apiPort,
      productionReady: false,
      productionHold: true,
      database: db.configured,
      msg: 'listening_blocked'
    });
  });
});

function shutdown() {
  server.close(function () {
    Promise.allSettled([
      Promise.resolve(db.end && db.end()),
      Promise.resolve(replayDefense && replayDefense.close()),
      Promise.resolve(oidcSessionStore && oidcSessionStore.close())
    ]).finally(function () { process.exit(0); });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
