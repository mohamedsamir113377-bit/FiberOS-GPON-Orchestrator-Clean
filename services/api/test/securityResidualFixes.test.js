'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createRateLimiter, validateSecurityConfiguration } = require('../../../packages/security/src/httpHardening');
const { isInternalNetworkAddress, hasOnlyInternalNetworkTargets } = require('../../../packages/security/src/outboundPolicy');
const { advise, isAiEnabled } = require('../../../packages/web-intelligence-core/src/runtime');
const { assessEvidence, assessDecisionSafety } = require('../../../packages/enterprise-kernel/src/decisionSafety');

test('production PROCESS_LOCAL limiter fails closed when multiple instances are declared', () => {
  assert.throws(
    () => createRateLimiter({
      NODE_ENV: 'production',
      SECURITY_RATE_LIMIT_PER_MINUTE: '60',
      SECURITY_RATE_LIMIT_BURST: '10',
      SECURITY_RATE_LIMIT_BACKEND: 'PROCESS_LOCAL',
      SECURITY_RATE_LIMIT_EXPECTED_INSTANCES: '2'
    }),
    /PROCESS_LOCAL_RATE_LIMIT_UNSAFE_FOR_MULTI_INSTANCE/
  );
});

test('unsupported rate-limit backend fails closed', () => {
  assert.throws(
    () => createRateLimiter({
      SECURITY_RATE_LIMIT_PER_MINUTE: '60',
      SECURITY_RATE_LIMIT_BURST: '10',
      SECURITY_RATE_LIMIT_BACKEND: 'UNKNOWN'
    }),
    /RATE_LIMIT_BACKEND_UNSUPPORTED/
  );
});

test('production requires an explicit sovereign-boundary mode with no Compose fallback', () => {
  const result = validateSecurityConfiguration({ NODE_ENV: 'production', FIBEROS_KERNEL_BOUNDARY_REQUIRED: '' });
  assert.ok(result.failures.includes('KERNEL_BOUNDARY_MODE_MUST_BE_EXPLICIT_IN_PRODUCTION'));
  const compose = fs.readFileSync(path.resolve(__dirname, '../../../deploy/docker-compose.app.yml'), 'utf8');
  assert.match(compose, /FIBEROS_KERNEL_BOUNDARY_REQUIRED:\s*\$\{FIBEROS_KERNEL_BOUNDARY_REQUIRED:\?set explicitly to true or false\}/);
  assert.doesNotMatch(compose, /FIBEROS_KERNEL_BOUNDARY_REQUIRED:\s*\$\{FIBEROS_KERNEL_BOUNDARY_REQUIRED:-false\}/);
});

test('simulated-only evidence is blocked by default', () => {
  const result = assessEvidence({
    evidence: [{ id: 'x', source: 'ai_simulated', observedAt: new Date().toISOString() }]
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'SIMULATED_ONLY');
});

test('decision safety persists the non-simulated evidence requirement', () => {
  const result = assessDecisionSafety({
    evidence: [{ id: 'x', source: 'ai_simulated', observedAt: new Date().toISOString() }],
    confidence: 0.99,
    riskScore: 0.1,
    maxEvidenceAgeSeconds: 300,
    approvalRiskThreshold: 0.35,
    autonomousConfidenceThreshold: 0.95,
    capabilityOk: true,
    policyOk: true,
    autonomousAllowed: true,
    rollbackPossible: true,
    rollbackPlan: { rollbackVerified: true }
  });
  assert.equal(result.state, 'UNCERTAIN');
  assert.equal(result.reason, 'SIMULATED_ONLY');
});

test('internal AI address policy admits only loopback, RFC1918 and IPv6 ULA addresses', () => {
  for (const address of [
    '127.0.0.1', '10.12.4.7', '172.16.0.1', '172.31.255.254',
    '192.168.1.10', '::1', 'fc00::1', 'fd12:3456::7',
    '::ffff:192.168.1.10'
  ]) assert.equal(isInternalNetworkAddress(address), true, address);

  for (const address of [
    '8.8.8.8', '1.1.1.1', '169.254.169.254', '100.64.0.1',
    '224.0.0.1', '0.0.0.0', '2001:4860:4860::8888', 'fe80::1', 'ff02::1'
  ]) assert.equal(isInternalNetworkAddress(address), false, address);
});

test('AI target policy fails closed for missing, public, and mixed DNS answers', () => {
  assert.equal(hasOnlyInternalNetworkTargets(null), false);
  assert.equal(hasOnlyInternalNetworkTargets({ addresses: [] }), false);
  assert.equal(hasOnlyInternalNetworkTargets({ addresses: [{ address: '10.20.0.8' }] }), true);
  assert.equal(hasOnlyInternalNetworkTargets({ addresses: [{ address: '10.20.0.8' }, { address: '8.8.8.8' }] }), false);
  assert.equal(hasOnlyInternalNetworkTargets({ addresses: [{ address: '2001:4860:4860::8888' }] }), false);
});

test('AI enablement requires an explicit true value', () => {
  assert.equal(isAiEnabled({ AI_ENABLED: 'true' }), true);
  assert.equal(isAiEnabled({ AI_ENABLED: 'TRUE' }), true);
  assert.equal(isAiEnabled({ AI_ENABLED: ' true ' }), true);
  assert.equal(isAiEnabled({ AI_ENABLED: 'false' }), false);
  assert.equal(isAiEnabled({ AI_ENABLED: '1' }), false);
  assert.equal(isAiEnabled({}), false);
});

test('direct AI inference returns AI_DISABLED before requiring an endpoint', async () => {
  const previous = process.env.AI_ENABLED;
  delete process.env.AI_ENABLED;
  try {
    const result = await advise({ question: 'status', context: {} });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'AI_DISABLED');
    assert.equal(result.authority, 'ADVISORY_ONLY');
    assert.equal(result.executionAuthorized, false);
  } finally {
    if (previous === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previous;
  }
});
