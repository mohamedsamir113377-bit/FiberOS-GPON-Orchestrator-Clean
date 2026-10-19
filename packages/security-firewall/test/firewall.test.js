#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRequest, validateFirewallConfiguration } = require('../src/index');

const baseEnv = {
  NODE_ENV: 'production',
  SECURITY_FIREWALL_ENABLED: 'true',
  SECURITY_REQUIRE_HTTPS: 'false',
};

function meta(over = {}) {
  return {
    method: 'GET',
    path: '/v1/health',
    url: '/v1/health',
    headers: { host: 'api.example' },
    protocol: 'https',
    remoteAddress: '203.0.113.10',
    ...over,
  };
}

describe('security-firewall edge guards', () => {
  it('rejects TRACE method', () => {
    const d = evaluateRequest(meta({ method: 'TRACE' }), baseEnv);
    assert.equal(d.allow, false);
    assert.equal(d.code, 'METHOD_NOT_ALLOWED');
  });

  it('blocks probe path /.env', () => {
    const d = evaluateRequest(meta({ path: '/.env', url: '/.env' }), baseEnv);
    assert.equal(d.allow, false);
    assert.equal(d.code, 'PROBE_PATH_BLOCKED');
  });

  it('blocks path traversal', () => {
    const d = evaluateRequest(meta({ path: '/v1/../etc/passwd', url: '/v1/../etc/passwd' }), baseEnv);
    assert.equal(d.allow, false);
    assert.equal(d.code, 'PATH_TRAVERSAL_OR_INVALID');
  });

  it('rejects oversized query string', () => {
    const qs = 'x=' + 'a'.repeat(5000);
    const d = evaluateRequest(
      meta({ path: '/v1/tickets', url: '/v1/tickets?' + qs }),
      baseEnv
    );
    assert.equal(d.allow, false);
    assert.equal(d.code, 'QUERY_TOO_LONG');
  });

  it('enforces SECURITY_ALLOWED_HOSTS', () => {
    const env = { ...baseEnv, SECURITY_ALLOWED_HOSTS: 'api.fiberos.example' };
    const bad = evaluateRequest(meta({ headers: { host: 'evil.example' } }), env);
    assert.equal(bad.allow, false);
    assert.equal(bad.code, 'HOST_NOT_ALLOWED');
    const ok = evaluateRequest(meta({ headers: { host: 'api.fiberos.example' } }), env);
    assert.equal(ok.allow, true);
  });

  it('denies source IP in SECURITY_FIREWALL_DENY_CIDRS', () => {
    const env = { ...baseEnv, SECURITY_FIREWALL_DENY_CIDRS: '203.0.113.0/24' };
    const d = evaluateRequest(meta({ remoteAddress: '203.0.113.55' }), env);
    assert.equal(d.allow, false);
    assert.equal(d.code, 'SOURCE_IP_DENIED');
  });

  it('allows healthy GET when guards pass', () => {
    const d = evaluateRequest(meta(), baseEnv);
    assert.equal(d.allow, true);
  });

  it('validateFirewallConfiguration rejects bad deny CIDR in production', () => {
    const v = validateFirewallConfiguration({
      NODE_ENV: 'production',
      SECURITY_FIREWALL_ENABLED: 'true',
      SECURITY_FIREWALL_DENY_CIDRS: 'not-a-cidr',
    });
    assert.equal(v.ok, false);
    assert.ok(v.failures.some((f) => String(f).includes('DENY_CIDR_INVALID')));
  });
});
