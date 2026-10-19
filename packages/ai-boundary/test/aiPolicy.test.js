'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveAiPolicy, assertAiEnabled, ENABLE_VARS, INFERENCE_URL_VARS } = require('../src/aiPolicy');
const boundary = require('../src/index');

test('P1.2-01 absence of an enable flag means disabled', () => {
  const p = resolveAiPolicy({});
  assert.equal(p.aiEnabled, false);
  assert.equal(p.inferenceConfigured, false);
  assert.deepEqual(p.declaredBy, []);
});

test('P1.2-02 both documented enable variables are honoured', () => {
  assert.equal(ENABLE_VARS.includes('AI_ENABLED'), true);
  assert.equal(ENABLE_VARS.includes('FIBEROS_AI_ENABLED'), true);
  assert.equal(resolveAiPolicy({ AI_ENABLED: 'true' }).aiEnabled, true);
  assert.equal(resolveAiPolicy({ FIBEROS_AI_ENABLED: 'TRUE' }).aiEnabled, true);
  assert.equal(resolveAiPolicy({ AI_ENABLED: 'false' }).aiEnabled, false);
});

test('P1.2-03 conflicting enable flags fail closed as disabled', () => {
  const p = resolveAiPolicy({ AI_ENABLED: 'true', FIBEROS_AI_ENABLED: 'false' });
  assert.equal(p.aiEnabled, false);
  assert.equal(p.conflict, true);
  assert.equal(assertThrowsCode(() => assertAiEnabled({ AI_ENABLED: 'true', FIBEROS_AI_ENABLED: 'false' })), 'AI_ENABLE_FLAGS_CONFLICT');
});

test('P1.2-04 a configured inference URL is never treated as proof of locality', () => {
  const p = resolveAiPolicy({ AI_ENABLED: 'true', FIBEROS_AI_INFERENCE_URL: 'http://127.0.0.1:11434/v1' });
  assert.equal(p.aiEnabled, true);
  assert.equal(p.inferenceConfigured, true);
  assert.equal(p.localityEvidence, 'NONE_FROM_CONFIGURATION');
  assert.equal(p.requiredAttestation, 'FIBEROS_SELF_HOSTED_HOSTS_OR_CIDRS');
});

test('P1.2-04b conflicting inference endpoint variables fail closed', () => {
  const p = resolveAiPolicy({
    AI_ENABLED: 'true',
    FIBEROS_AI_INFERENCE_URL: 'https://internal-a.example.invalid',
    AI_UPSTREAM_URL: 'https://internal-b.example.invalid'
  });
  assert.equal(p.inferenceConflict, true);
  assert.deepEqual(p.inferenceEnvNames, ['FIBEROS_AI_INFERENCE_URL', 'AI_UPSTREAM_URL']);
});

test('P1.2-05 the boundary re-exports exactly one enablement policy', () => {
  for (const name of ['resolveAiPolicy', 'assertAiEnabled', 'ENABLE_VARS', 'INFERENCE_URL_VARS']) {
    assert.equal(typeof boundary[name] !== 'undefined', true, `ai-boundary must export ${name}`);
  }
  assert.equal(boundary.FORBIDDEN_ACTIONS.length > 0, true);
  assert.equal(INFERENCE_URL_VARS.includes('FIBEROS_AI_INFERENCE_URL'), true);
  assert.equal(INFERENCE_URL_VARS.includes('AI_UPSTREAM_URL'), true);
});

test('P1.2-06 inference paths use shared AI policy gate', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const runtime = path.join(root, 'packages', 'web-intelligence-core', 'src', 'runtime.js');
  const source = require('node:fs').readFileSync(runtime, 'utf8');
  assert.match(source, /resolveAiPolicy\(process\.env\)/);
  assert.match(source, /error:'AI_DISABLED'/);
  assert.match(source, /function isAiEnabled\(env = process\.env\)\s*\{\s*return resolveAiPolicy\(env\)\.aiEnabled;\s*\}/);
  assert.doesNotMatch(source, /process\.env\.(?:AI_ENABLED|FIBEROS_AI_ENABLED)/);
  execFileSync(process.execPath, ['--check', runtime], { stdio: 'pipe' });
});

test('P1.2-07 advise() refuses to infer when AI is disabled (integration at module boundary)', async () => {
  const { advise } = require('../../web-intelligence-core/src/runtime');
  const out = await advise({ question: 'status?', context: { ticketId: 't-1' } });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'AI_DISABLED');
  assert.equal(out.executionAuthorized, false);
  assert.equal(out.authority, 'ADVISORY_ONLY');
});

function assertThrowsCode(fn) {
  try { fn(); return null; } catch (e) { return e.code; }
}
