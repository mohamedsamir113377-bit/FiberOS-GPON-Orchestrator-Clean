#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createDdosGuard } = require('../src/ddosGuard');

describe('ddosGuard concurrency and rate limits', () => {
  it('admits under per-IP concurrency and releases', () => {
    const g = createDdosGuard({
      SECURITY_DDOS_GUARD_ENABLED: 'true',
      SECURITY_DDOS_MAX_CONCURRENT_PER_IP: '2',
      SECURITY_DDOS_MAX_GLOBAL_CONCURRENT: '10',
      SECURITY_DDOS_MAX_REQUESTS_PER_WINDOW: '1000'
    });
    const a = g.admit('10.0.0.1');
    const b = g.admit('10.0.0.1');
    assert.equal(a.allow, true);
    assert.equal(b.allow, true);
    const c = g.admit('10.0.0.1');
    assert.equal(c.allow, false);
    assert.equal(c.code, 'DDOS_IP_CONCURRENCY');
    g.release(a);
    const d = g.admit('10.0.0.1');
    assert.equal(d.allow, true);
    g.release(b);
    g.release(d);
    assert.equal(g.stats().global, 0);
  });

  it('enforces global concurrency across IPs', () => {
    const g = createDdosGuard({
      SECURITY_DDOS_GUARD_ENABLED: 'true',
      SECURITY_DDOS_MAX_CONCURRENT_PER_IP: '50',
      SECURITY_DDOS_MAX_GLOBAL_CONCURRENT: '2',
      SECURITY_DDOS_MAX_REQUESTS_PER_WINDOW: '1000'
    });
    const a = g.admit('10.0.0.1');
    const b = g.admit('10.0.0.2');
    const c = g.admit('10.0.0.3');
    assert.equal(a.allow, true);
    assert.equal(b.allow, true);
    assert.equal(c.allow, false);
    assert.equal(c.code, 'DDOS_GLOBAL_CONCURRENCY');
    g.release(a);
    g.release(b);
  });

  it('enforces short-window request rate per IP', () => {
    let t = 1_000_000;
    const g = createDdosGuard(
      {
        SECURITY_DDOS_GUARD_ENABLED: 'true',
        SECURITY_DDOS_MAX_CONCURRENT_PER_IP: '100',
        SECURITY_DDOS_MAX_GLOBAL_CONCURRENT: '100',
        SECURITY_DDOS_MAX_REQUESTS_PER_WINDOW: '3',
        SECURITY_DDOS_RATE_WINDOW_MS: '1000'
      },
      () => t
    );
    assert.equal(g.admit('10.0.0.9').allow, true);
    assert.equal(g.admit('10.0.0.9').allow, true);
    assert.equal(g.admit('10.0.0.9').allow, true);
    const blocked = g.admit('10.0.0.9');
    assert.equal(blocked.allow, false);
    assert.equal(blocked.code, 'DDOS_IP_RATE');
  });

  it('can be disabled', () => {
    const g = createDdosGuard({ SECURITY_DDOS_GUARD_ENABLED: 'false' });
    const a = g.admit('10.0.0.1');
    assert.equal(a.allow, true);
    assert.equal(a.skipped, true);
  });
});
