'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'server.js'),
  'utf8'
);

test('public API boundary does not expose internal security/runtime failure details', () => {
  assert.equal(
    serverSource.includes('failures:securityConfigGate.failures'),
    false,
    'security configuration failures must remain server-side'
  );
  assert.equal(
    serverSource.includes('failures:firewallConfigGate.failures'),
    false,
    'firewall configuration failures must remain server-side'
  );
  assert.equal(
    serverSource.includes("reason: runtimeGate.reason || 'RUNTIME_GATE_NOT_INITIALIZED'"),
    false,
    'runtime diagnostic reason must not be returned to API callers'
  );
  assert.match(
    serverSource,
    /reason:\s*'RUNTIME_PRECONDITION_FAILED'/
  );
});

test('health exception is path-based and /v1/meta does not disclose auth configuration state', () => {
  assert.match(
    serverSource,
    /const requestBoundaryPath = String\(req\.url \|\| '\/'\)\.split\('\?'\)\[0\] \|\| '\/';/
  );
  assert.match(
    serverSource,
    /requestBoundaryPath !== '\/health'/
  );
  assert.equal(
    serverSource.includes('writeAuth:'),
    false,
    'public metadata must not disclose the active authentication configuration'
  );
});
