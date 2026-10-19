#!/usr/bin/env node
'use strict';

/**
 * Application-layer DDoS / flood guard (software).
 *
 * Controls:
 * 1) Concurrent in-flight requests per source IP
 * 2) Concurrent in-flight requests process-wide
 * 3) Short-window request rate per source IP (HTTP flood after edge)
 *
 * NOT a substitute for edge/CDN volumetric (L3/L4) mitigation
 * (Cloudflare, AWS Shield, Azure DDoS, Netlify edge). See:
 * docs/runbooks/VOLUMETRIC_DDOS_EDGE_PROTECTION.md
 * deploy/nginx/api-edge-ddos.conf
 */

function envInt(env, name, fallback) {
  const n = Number((env || process.env)[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function normalizeIp(remoteAddress) {
  return String(remoteAddress || '')
    .replace(/^::ffff:/i, '')
    .trim() || 'unknown';
}

function createDdosGuard(env, nowFn) {
  env = env || process.env;
  const now = typeof nowFn === 'function' ? nowFn : () => Date.now();
  const enabled = String(env.SECURITY_DDOS_GUARD_ENABLED || 'true').toLowerCase() !== 'false';
  const maxPerIp = envInt(env, 'SECURITY_DDOS_MAX_CONCURRENT_PER_IP', 32);
  const maxGlobal = envInt(env, 'SECURITY_DDOS_MAX_GLOBAL_CONCURRENT', 512);
  const maxRatePerIp = envInt(env, 'SECURITY_DDOS_MAX_REQUESTS_PER_WINDOW', 120);
  const windowMs = envInt(env, 'SECURITY_DDOS_RATE_WINDOW_MS', 1000);
  const inFlight = new Map();
  /** @type {Map<string, { count: number, windowStart: number }>} */
  const rateWindows = new Map();
  let global = 0;

  function checkRate(ip) {
    const ts = now();
    let w = rateWindows.get(ip);
    if (!w || ts - w.windowStart >= windowMs) {
      w = { count: 0, windowStart: ts };
      rateWindows.set(ip, w);
    }
    w.count += 1;
    if (w.count > maxRatePerIp) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (ts - w.windowStart)) / 1000));
      return {
        allow: false,
        code: 'DDOS_IP_RATE',
        status: 429,
        retryAfter,
        ip
      };
    }
    // opportunistic cleanup of stale windows
    if (rateWindows.size > 20000) {
      for (const [k, v] of rateWindows) {
        if (ts - v.windowStart >= windowMs * 4) rateWindows.delete(k);
      }
    }
    return { allow: true };
  }

  function admit(remoteAddress) {
    if (!enabled) return { allow: true, skipped: true, ip: normalizeIp(remoteAddress) };
    const ip = normalizeIp(remoteAddress);

    const rate = checkRate(ip);
    if (!rate.allow) return rate;

    if (global >= maxGlobal) {
      return {
        allow: false,
        code: 'DDOS_GLOBAL_CONCURRENCY',
        status: 503,
        retryAfter: 1,
        ip
      };
    }
    const cur = inFlight.get(ip) || 0;
    if (cur >= maxPerIp) {
      return {
        allow: false,
        code: 'DDOS_IP_CONCURRENCY',
        status: 429,
        retryAfter: 1,
        ip
      };
    }
    inFlight.set(ip, cur + 1);
    global += 1;
    return { allow: true, ip, admitted: true };
  }

  function release(token) {
    if (!token || !token.admitted || !token.ip) return;
    const cur = inFlight.get(token.ip) || 0;
    if (cur <= 1) inFlight.delete(token.ip);
    else inFlight.set(token.ip, cur - 1);
    if (global > 0) global -= 1;
  }

  return Object.freeze({
    admit,
    release,
    stats() {
      return Object.freeze({
        enabled,
        global,
        distinctIps: inFlight.size,
        rateWindows: rateWindows.size,
        maxPerIp,
        maxGlobal,
        maxRatePerIp,
        windowMs
      });
    },
    config: Object.freeze({
      enabled,
      maxPerIp,
      maxGlobal,
      maxRatePerIp,
      windowMs
    })
  });
}

module.exports = { createDdosGuard };
