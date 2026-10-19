'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { requireVerifiedPrincipal } = require('../src/requireAuth');

test('JWT verification failures never expose internal verifier or configuration details', () => {
  const productionEnv = {
    NODE_ENV: 'production',
    OIDC_JWKS_URL: 'https://idp.example.test/.well-known/jwks.json',
    OIDC_ISSUER: 'https://idp.example.test',
    OIDC_AUDIENCE: 'fiberos-api',
    OIDC_JWKS_ALLOWED_HOSTS: 'idp.example.test'
  };

  const result = requireVerifiedPrincipal(
    {
      authenticated: true,
      verified: false,
      error: 'OIDC_JWKS_HOST_NOT_ALLOWLISTED',
      reason: 'INTERNAL_CONFIGURATION_DETAIL'
    },
    productionEnv
  );

  assert.deepEqual(result, {
    ok: false,
    status: 401,
    body: { ok: false, error: 'JWT_NOT_VERIFIED' }
  });
});
