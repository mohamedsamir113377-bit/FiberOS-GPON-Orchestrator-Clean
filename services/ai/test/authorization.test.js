'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeAiRequest } = require('../src/authorization');
const env = { NODE_ENV: 'production' };
const principal = role => ({ authenticated: true, verified: true, role });

test('standalone AI uses the exact central /v1/ai/advise role policy', () => {
  for (const role of ['technician', 'team_lead', 'dispatcher', 'call_center', 'ops_manager', 'area_supervisor', 'exec', 'sysadmin', 'qc']) {
    assert.equal(authorizeAiRequest(principal(role), env).ok, true, `${role} should be admitted`);
  }
  for (const role of ['warehouse', 'cfo']) {
    const result = authorizeAiRequest(principal(role), env);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  }
  assert.equal(authorizeAiRequest({ ...principal('technician'), verified: false }, env).status, 401);
  assert.equal(authorizeAiRequest(principal('technician'), env, '/v1/advise').ok, true, 'legacy path must map to the same canonical policy');
  assert.equal(authorizeAiRequest(principal('technician'), env, '/v1/unrelated').status, 404);
});
