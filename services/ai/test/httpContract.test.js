'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  AI_ADVISE_PATH,
  LEGACY_AI_ADVISE_PATH,
  canonicalAiPath,
  publicAiHealthResponse,
  aiPrincipalRateKey
} = require('../src/httpContract');
const { loadServerConfig } = require('../../../packages/core/src/config');

test('public AI health response exposes no internal bind address or enablement setting', () => {
  const health = publicAiHealthResponse();
  assert.deepEqual(health, {
    ok: true,
    service: 'fiberos-ai',
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false
  });
  assert.equal(Object.hasOwn(health, 'bindHost'), false);
  assert.equal(Object.hasOwn(health, 'enabled'), false);
});

test('canonical AI route matches the central API policy while the old route is an explicit alias', () => {
  assert.equal(AI_ADVISE_PATH, '/v1/ai/advise');
  assert.equal(canonicalAiPath(AI_ADVISE_PATH), AI_ADVISE_PATH);
  assert.equal(canonicalAiPath(LEGACY_AI_ADVISE_PATH), AI_ADVISE_PATH);
  assert.equal(canonicalAiPath('/v1/elsewhere'), null);
});

test('authenticated rate-limit identity is stable across source IPs and distinct by tenant/subject', () => {
  const a = aiPrincipalRateKey({ sub: 'user-1', tenant_id: 'tenant-a' });
  assert.equal(a, aiPrincipalRateKey({ sub: 'user-1', tenant_id: 'tenant-a' }));
  assert.notEqual(a, aiPrincipalRateKey({ sub: 'user-2', tenant_id: 'tenant-a' }));
  assert.notEqual(a, aiPrincipalRateKey({ sub: 'user-1', tenant_id: 'tenant-b' }));
  assert.throws(() => aiPrincipalRateKey({ tenant_id: 'tenant-a' }), /AI_RATE_LIMIT_PRINCIPAL_REQUIRED/);
});

test('AI gateway uses the shared fail-closed enablement policy, not its legacy config flag', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(source, /resolveAiPolicy\(process\.env\)/);
  assert.match(source, /if \(!aiPolicy\.aiEnabled \|\| !upstream\)/);
  assert.doesNotMatch(source, /cfg\.aiEnabled/);
});

test('core config consumes the shared AI policy and canonical database resolver', () => {
  const cfg = loadServerConfig({
    AI_ENABLED: ' true ',
    FIBEROS_AI_INFERENCE_URL: 'https://internal.example.invalid/v1',
    DATABASE_URL_FILE: '/run/secrets/runtime_database_url'
  });
  assert.equal(cfg.aiEnabled, true);
  assert.equal(cfg.aiUpstreamUrl, 'https://internal.example.invalid/v1');
  assert.equal(cfg.databaseUrlConfigured, false);
  assert.equal(cfg.databaseUrlSource, 'INVALID');
});

test('AI server keeps pre-auth IP abuse limiting and adds a separate post-auth principal quota', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  const ipLimitAt = source.indexOf("rateLimiter.allow(rateKey(req, null, { scope:'ip' }))");
  const authAt = source.indexOf('requireVerifiedPrincipal(principal, process.env)');
  const principalLimitAt = source.indexOf('rateLimiter.allow(aiPrincipalRateKey(principal)');
  assert.ok(ipLimitAt >= 0 && authAt > ipLimitAt && principalLimitAt > authAt);
  assert.match(source, /canonicalAiPath\(path\)/);
  assert.match(source, /publicAiHealthResponse\(\)/);
  const healthStart = source.indexOf("if (req.method === 'GET' && path === '/health')");
  const adviseStart = source.indexOf("if (req.method === 'POST'", healthStart);
  assert.ok(healthStart >= 0 && adviseStart > healthStart);
  assert.doesNotMatch(source.slice(healthStart, adviseStart), /enabled|bindHost/);
});
