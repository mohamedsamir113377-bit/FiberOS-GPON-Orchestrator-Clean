'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireVerifiedPrincipal, identityConfigured, isLabMode } = require('../src/requireAuth');
const { requiresAuthBeforeRuntime } = require('../src/routeAuthPolicy');

test('production identity requires the complete OIDC/JWKS contract', () => {
  const base = {
    NODE_ENV: 'production',
    OIDC_JWKS_URL: 'https://id.example.test/.well-known/jwks.json',
    OIDC_ISSUER: 'https://id.example.test/',
    OIDC_AUDIENCE: 'fiberos',
    OIDC_JWKS_ALLOWED_HOSTS: 'id.example.test'
  };
  assert.equal(identityConfigured(base), true);
  assert.equal(identityConfigured({ ...base, OIDC_AUDIENCE: '' }), false);
  assert.equal(identityConfigured({ ...base, OIDC_JWKS_ALLOWED_HOSTS: '' }), false);
});

test('lab mode is explicit and never authenticates an anonymous write principal', () => {
  const env = { NODE_ENV: 'development', JWT_VERIFY: 'false', FIBEROS_LAB_MODE: 'true' };
  assert.equal(isLabMode(env), true);
  const denied = requireVerifiedPrincipal(null, env);
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 401);
  const allowedForLabTesting = requireVerifiedPrincipal({ authenticated: true, verified: false }, env);
  assert.equal(allowedForLabTesting.ok, true);
  assert.equal(allowedForLabTesting.mode, 'LAB_UNVERIFIED');
});

test('production rejects an unverified principal even when a legacy HMAC secret exists', () => {
  const env = {
    NODE_ENV: 'production',
    JWT_SECRET: 'legacy-test-secret',
    OIDC_JWKS_URL: 'https://id.example.test/.well-known/jwks.json',
    OIDC_ISSUER: 'https://id.example.test/',
    OIDC_AUDIENCE: 'fiberos',
    OIDC_JWKS_ALLOWED_HOSTS: 'id.example.test'
  };
  const result = requireVerifiedPrincipal({ authenticated: true, verified: false }, env);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'JWT_NOT_VERIFIED');
});

test('pre-runtime authentication is deny-by-default for /v1 except the narrow webhook exception', () => {
  assert.equal(requiresAuthBeforeRuntime('/v1/tickets/transition', 'POST'), true);
  assert.equal(requiresAuthBeforeRuntime('/v1/contact-center/runtime/status', 'GET'), true);
  assert.equal(requiresAuthBeforeRuntime('/v1/call-center/ivr/inbound', 'POST'), false);
  assert.equal(requiresAuthBeforeRuntime('/v1/call-center/ivr/inbound', 'GET'), true);
  assert.equal(requiresAuthBeforeRuntime('/health', 'GET'), false);
});
