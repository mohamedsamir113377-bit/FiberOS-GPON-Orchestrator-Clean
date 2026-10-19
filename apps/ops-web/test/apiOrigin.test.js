'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../public/api-origin');

const page = 'https://ops.example/index.html';

test('same-origin HTTPS is the default and resolves only approved API paths', () => {
  assert.equal(policy.normalizeApiBase('', page), 'https://ops.example');
  assert.equal(policy.resolveApiUrl('https://ops.example', '/v1/tickets/123'), 'https://ops.example/v1/tickets/123');
  assert.equal(policy.resolveApiUrl('https://ops.example', '/health'), 'https://ops.example/health');
});

test('remote APIs require exact HTTPS allowlisting and reject credentials, query, and base paths', () => {
  assert.equal(policy.normalizeApiBase('https://api.example', page, ['https://api.example']), 'https://api.example');
  for (const candidate of [
    'https://attacker.example',
    'http://api.example',
    'https://user:secret@api.example',
    'https://api.example/?next=attacker',
    'https://api.example/v1'
  ]) assert.throws(() => policy.normalizeApiBase(candidate, page, ['https://api.example']), /API_/);
});

test('cleartext API origins are limited to the documented local development case', () => {
  assert.equal(policy.normalizeApiBase('http://127.0.0.1:8080', 'http://localhost:8088/', []), 'http://127.0.0.1:8080');
  assert.equal(policy.normalizeApiBase('http://localhost:3000', 'http://localhost:3000/', []), 'http://localhost:3000');
  assert.throws(() => policy.normalizeApiBase('http://192.168.1.20:8080', 'http://localhost:8088/', []), /API_ORIGIN_NOT_ALLOWED/);
  assert.throws(() => policy.normalizeApiBase('http://ops.example', 'http://ops.example/', []), /API_ORIGIN_NOT_ALLOWED/);
});

test('API path builder blocks protocol-relative, admin, query, backslash, and traversal paths', () => {
  for (const path of ['//attacker.example/v1/x', '/admin/delete', '/v1/../admin', '/v1/%2e%2e/admin', '/v1/x?redirect=attacker', '/v1\\\\admin']) {
    assert.throws(() => policy.resolveApiUrl('https://ops.example', path), /API_PATH_INVALID/);
  }
});

test('OIDC auth URL builder allows only the internal auth namespace', () => {
  assert.equal(policy.resolveAuthUrl('https://api.example', '/auth/oidc/login'), 'https://api.example/auth/oidc/login');
  assert.throws(() => policy.resolveAuthUrl('https://api.example', '/auth/logout'), /AUTH_PATH_INVALID/);
});
