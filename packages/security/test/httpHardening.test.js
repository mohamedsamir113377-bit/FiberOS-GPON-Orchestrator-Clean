'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { clientAddress, rateKey } = require('../src/httpHardening');

function request(remoteAddress, xForwardedFor) {
  return {
    socket: { remoteAddress },
    headers: xForwardedFor == null ? {} : { 'x-forwarded-for': xForwardedFor }
  };
}

test('trusted proxy X-Forwarded-For accepts only valid client IPs', () => {
  const cfg = { trustProxy: true, trustProxyCidr: '10.0.0.0/8' };
  assert.equal(
    clientAddress(request('10.0.0.2', '203.0.113.9, not-an-ip, 10.0.0.3'), cfg),
    '203.0.113.9'
  );
});

test('trusted proxy X-Forwarded-For falls back to peer when no valid non-proxy IP exists', () => {
  const cfg = { trustProxy: true, trustProxyCidr: '10.0.0.0/8' };
  assert.equal(
    clientAddress(request('10.0.0.2', 'not-an-ip, 10.0.0.3'), cfg),
    '10.0.0.2'
  );
});

test('IPv4-mapped forwarded client address is normalized without losing IP identity', () => {
  const cfg = { trustProxy: true, trustProxyCidr: '10.0.0.0/8' };
  const req = request('10.0.0.2', '::ffff:203.0.113.9, 10.0.0.3');
  assert.equal(clientAddress(req, cfg), '203.0.113.9');
  const key = rateKey(req, { sub: 'user-a', tenant_id: 'tenant-a' }, { scope: 'principal' }, cfg);
  assert.equal(typeof key, 'string');
  assert.equal(key.length, 64);
});
