'use strict';

/**
 * FiberOS Security Firewall (request boundary)
 * ============================================
 * Fail-closed request sanitization layer for production API.
 * Complements packages/security httpHardening (headers + rate limit).
 *
 * Design rules:
 * - No silent acceptance of oversized / unexpected content types.
 * - Path traversal and null-byte rejection.
 * - Configurable body size by route class.
 * - Pure decision functions + thin middleware factory.
 * - PRODUCTION_HOLD remains authoritative until RLS proven.
 */

const crypto = require('crypto');
const path = require('path');
const { ipInCidr, isValidCidr } = require('../../security/src/httpHardening');
const sovereignBoundary = require('./sovereignBoundary');

const DEFAULTS = Object.freeze({
  maxBodyBytesDefault: 256 * 1024,
  maxBodyBytesUpload: 8 * 1024 * 1024,
  maxBodyBytesJson: 512 * 1024,
  allowedJsonContentTypes: Object.freeze([
    'application/json',
    'application/json; charset=utf-8'
  ]),
  allowedUploadContentTypes: Object.freeze([
    'application/json',
    'multipart/form-data',
    'application/octet-stream',
    'image/jpeg',
    'image/png',
    'application/pdf'
  ]),
  blockedPathSegments: Object.freeze([
    '..',
    '%2e%2e',
    '%2E%2E',
    '..%2f',
    '..\\',
    '%00',
    '\0'
  ]),
  /** Common scanner/probe targets — never part of FiberOS HTTP surface. */
  blockedPathPrefixes: Object.freeze([
    '/.env',
    '/.git',
    '/.svn',
    '/.hg',
    '/.aws',
    '/wp-admin',
    '/wp-login',
    '/xmlrpc.php',
    '/phpmyadmin',
    '/adminer',
    '/actuator',
    '/server-status',
    '/server-info',
    '/cgi-bin',
    '/vendor/phpunit',
    '/etc/passwd'
  ]),
  allowedMethods: Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
  maxPathLength: 2048,
  maxHeaderValueLength: 8192,
  maxQueryLength: 4096,
  maxUrlLength: 8192
});

function envInt(env, name, fallback) {
  const n = Number((env || process.env)[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function firewallConfig(env) {
  env = env || process.env;
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const denyCidrs = String(env.SECURITY_FIREWALL_DENY_CIDRS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedHosts = String(env.SECURITY_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Object.freeze({
    production,
    enabled: String(env.SECURITY_FIREWALL_ENABLED || 'true').toLowerCase() !== 'false',
    maxBodyBytesDefault: envInt(env, 'SECURITY_MAX_BODY_BYTES', DEFAULTS.maxBodyBytesDefault),
    maxBodyBytesUpload: envInt(env, 'SECURITY_MAX_BODY_UPLOAD', DEFAULTS.maxBodyBytesUpload),
    maxBodyBytesJson: envInt(env, 'SECURITY_MAX_BODY_JSON', DEFAULTS.maxBodyBytesJson),
    maxQueryLength: envInt(env, 'SECURITY_MAX_QUERY_LENGTH', DEFAULTS.maxQueryLength),
    maxUrlLength: envInt(env, 'SECURITY_MAX_URL_LENGTH', DEFAULTS.maxUrlLength),
    requireHttps: production && String(env.SECURITY_REQUIRE_HTTPS || 'true').toLowerCase() !== 'false',
    trustProxy: String(env.TRUST_PROXY || 'false').toLowerCase() === 'true' || String(env.TRUST_PROXY || '').trim() === '1',
    trustProxyCidr: String(env.TRUST_PROXY_CIDR || '').trim(),
    denyCidrs: Object.freeze(denyCidrs),
    allowedHosts: Object.freeze(allowedHosts),
    blockNullBytes: true
  });
}

function normalizePath(p) {
  if (p == null) return '/';
  let s = String(p);
  if (s.length > DEFAULTS.maxPathLength) return null;
  // Reject null bytes early
  if (s.indexOf('\0') !== -1) return null;
  // Decode once carefully — reject double-encoding attacks that reintroduce ..
  try {
    if (/%2e|%2f|%5c/i.test(s)) {
      const decoded = decodeURIComponent(s);
      if (decoded.indexOf('\0') !== -1) return null;
      s = decoded;
    }
  } catch (e) {
    return null;
  }
  const lower = s.toLowerCase();
  for (const seg of DEFAULTS.blockedPathSegments) {
    if (lower.indexOf(seg.toLowerCase()) !== -1) return null;
  }
  // Normalize and ensure absolute
  const norm = path.posix.normalize('/' + s.replace(/\\/g, '/').replace(/^\/+/, ''));
  if (norm.indexOf('..') !== -1) return null;
  return norm;
}

function contentTypeBase(ct) {
  if (!ct) return '';
  return String(ct).split(';')[0].trim().toLowerCase();
}

function isJsonContentType(ct) {
  const base = contentTypeBase(ct);
  return base === 'application/json' || base.endsWith('+json');
}

function isUploadPath(pathname) {
  return (
    pathname.indexOf('/evidence') !== -1 ||
    pathname.indexOf('/upload') !== -1 ||
    pathname.indexOf('/sor') !== -1 ||
    pathname.indexOf('/photo') !== -1
  );
}

/**
 * Pure decision: should this request be rejected at the firewall?
 * Returns { allow: true } or { allow: false, code, status, detail }
 */
function evaluateRequest(reqMeta, env) {
  const cfg = firewallConfig(env);
  if (!cfg.enabled) return { allow: true, skipped: true };

  const method = String(reqMeta.method || 'GET').toUpperCase();
  const rawPath = reqMeta.path || reqMeta.url || '/';
  const pathname = normalizePath(rawPath.split('?')[0]);
  if (pathname == null) {
    return {
      allow: false,
      code: 'PATH_TRAVERSAL_OR_INVALID',
      status: 400,
      detail: 'path rejected by firewall'
    };
  }

  // HTTP method allow-list (block TRACE/TRACK/CONNECT and non-API verbs)
  if (!DEFAULTS.allowedMethods.includes(method)) {
    return {
      allow: false,
      code: 'METHOD_NOT_ALLOWED',
      status: 405,
      detail: method
    };
  }

  // Probe / scanner path prefixes (fail closed; never part of product surface)
  const pathLower = pathname.toLowerCase();
  for (const prefix of DEFAULTS.blockedPathPrefixes) {
    if (pathLower === prefix || pathLower.startsWith(prefix + '/') || pathLower.startsWith(prefix + '.')) {
      return {
        allow: false,
        code: 'PROBE_PATH_BLOCKED',
        status: 404,
        detail: prefix
      };
    }
  }

  // URL / query length bounds (full raw URL when provided)
  const rawUrl = String(reqMeta.url || rawPath || '');
  if (rawUrl.length > cfg.maxUrlLength) {
    return {
      allow: false,
      code: 'URL_TOO_LONG',
      status: 414,
      detail: { limit: cfg.maxUrlLength, length: rawUrl.length }
    };
  }
  const qIndex = rawUrl.indexOf('?');
  if (qIndex !== -1) {
    const qs = rawUrl.slice(qIndex + 1);
    if (qs.length > cfg.maxQueryLength) {
      return {
        allow: false,
        code: 'QUERY_TOO_LONG',
        status: 414,
        detail: { limit: cfg.maxQueryLength, length: qs.length }
      };
    }
    if (qs.indexOf('\0') !== -1) {
      return {
        allow: false,
        code: 'QUERY_NULL_BYTE',
        status: 400,
        detail: 'null byte in query'
      };
    }
  }

  // Optional Host allow-list (production multi-tenant edge)
  if (cfg.allowedHosts.length > 0) {
    const hostHeader = String(
      (reqMeta.headers && (reqMeta.headers.host || reqMeta.headers.Host)) || ''
    )
      .split(',')[0]
      .trim()
      .toLowerCase()
      .split(':')[0];
    if (!hostHeader || !cfg.allowedHosts.includes(hostHeader)) {
      return {
        allow: false,
        code: 'HOST_NOT_ALLOWED',
        status: 421,
        detail: hostHeader || 'missing'
      };
    }
  }

  // Optional deny-list CIDRs (edge firewall / known abusive ranges)
  if (cfg.denyCidrs.length > 0) {
    const remote = String(reqMeta.remoteAddress || '').replace(/^::ffff:/i, '').trim();
    if (remote) {
      for (const cidr of cfg.denyCidrs) {
        if (isValidCidr(cidr) && ipInCidr(remote, cidr)) {
          return {
            allow: false,
            code: 'SOURCE_IP_DENIED',
            status: 403,
            detail: 'denied by SECURITY_FIREWALL_DENY_CIDRS'
          };
        }
      }
    }
  }

  // HTTPS enforcement is fail-closed. A client-controlled X-Forwarded-Proto
  // must never be trusted unless the immediate peer is explicitly allowlisted
  // as the TLS-terminating proxy. Direct production HTTP requests are rejected.
  if (cfg.requireHttps) {
    const remote = String(reqMeta.remoteAddress || '').replace(/^::ffff:/i, '').trim();
    const peerIsTrustedProxy = cfg.trustProxy && cfg.trustProxyCidr && isValidCidr(cfg.trustProxyCidr) && ipInCidr(remote, cfg.trustProxyCidr);
    const directProtocol = String(reqMeta.protocol || '').toLowerCase();
    const forwarded = reqMeta.headers && (reqMeta.headers['x-forwarded-proto'] || reqMeta.headers['X-Forwarded-Proto']);
    const forwardedProtocol = String(forwarded || '').split(',')[0].trim().toLowerCase();
    const forwardedHeaderPresent = forwarded != null && String(forwarded).trim() !== '';
    const proto = peerIsTrustedProxy ? forwardedProtocol : directProtocol;
    if (proto !== 'https') {
      // A forwarded-proto header sent by an untrusted peer is a spoofing attempt
      // (UNTRUSTED_PROXY_HEADER). A request with no forwarded header at all is just
      // a plain direct client not using HTTPS (HTTPS_REQUIRED) — these are different
      // situations and must not share one error code, or ops will chase a proxy
      // spoofing incident that never happened.
      const untrustedForwardedHeader = !peerIsTrustedProxy && forwardedHeaderPresent;
      return {
        allow: false,
        code: untrustedForwardedHeader ? 'UNTRUSTED_PROXY_HEADER' : 'HTTPS_REQUIRED',
        status: 403,
        detail: untrustedForwardedHeader ? 'forwarded protocol is not trusted from this peer' : 'HTTPS required in production'
      };
    }
  }

  // Header length bound
  const headers = reqMeta.headers || {};
  for (const k of Object.keys(headers)) {
    const v = headers[k];
    if (v != null && String(v).length > DEFAULTS.maxHeaderValueLength) {
      return {
        allow: false,
        code: 'HEADER_TOO_LARGE',
        status: 431,
        detail: k
      };
    }
  }

  // Body size & content-type for mutating methods
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const cl = Number(
      (headers['content-length'] != null
        ? headers['content-length']
        : headers['Content-Length']) || 0
    );
    const ct = headers['content-type'] || headers['Content-Type'] || '';
    const upload = isUploadPath(pathname);
    const limit = upload ? cfg.maxBodyBytesUpload : cfg.maxBodyBytesJson;

    if (Number.isFinite(cl) && cl > limit) {
      return {
        allow: false,
        code: 'BODY_TOO_LARGE',
        status: 413,
        detail: { limit, contentLength: cl }
      };
    }

    if (ct) {
      const base = contentTypeBase(ct);
      const allowed = upload
        ? DEFAULTS.allowedUploadContentTypes
        : DEFAULTS.allowedJsonContentTypes;
      const ok = allowed.some((a) => contentTypeBase(a) === base || (upload && base.startsWith('multipart/')));
      if (!ok && method !== 'GET') {
        // Strict JSON APIs: reject unknown content-types on non-upload routes
        if (!upload && !isJsonContentType(ct)) {
          return {
            allow: false,
            code: 'UNSUPPORTED_CONTENT_TYPE',
            status: 415,
            detail: base
          };
        }
      }
    }
  }

  return {
    allow: true,
    path: pathname,
    method
  };
}

/**
 * Express/Connect-style middleware factory.
 * Uses only the decision function above — no hidden side effects.
 */
function createFirewallMiddleware(env) {
  const cfg = firewallConfig(env);
  return function fiberosFirewall(req, res, next) {
    if (!cfg.enabled) return next();
    const meta = {
      method: req.method,
      path: req.path || (req.url && req.url.split('?')[0]) || '/',
      url: req.url,
      headers: req.headers || {},
      protocol: req.protocol,
      secure: req.secure
    };
    const decision = evaluateRequest(meta, env);
    if (!decision.allow) {
      if (!res.headersSent) {
        res.statusCode = decision.status || 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-FiberOS-Firewall', decision.code || 'REJECTED');
        res.end(
          JSON.stringify({
            error: decision.code || 'FIREWALL_REJECTED',
            status: decision.status || 400
          })
        );
      }
      return;
    }
    // Expose normalized path for downstream
    req.fiberosNormalizedPath = decision.path;
    return next();
  };
}

function validateFirewallConfiguration(env) {
  const cfg = firewallConfig(env);
  const failures = [];
  if (cfg.production && !cfg.enabled) failures.push('SECURITY_FIREWALL_DISABLED_IN_PRODUCTION');
  if (cfg.maxBodyBytesDefault < 1024) failures.push('SECURITY_MAX_BODY_BYTES_TOO_SMALL');
  if (cfg.maxBodyBytesUpload < cfg.maxBodyBytesDefault) {
    failures.push('SECURITY_MAX_BODY_UPLOAD_LESS_THAN_DEFAULT');
  }
  for (const cidr of cfg.denyCidrs) {
    if (!isValidCidr(cidr)) failures.push('SECURITY_FIREWALL_DENY_CIDR_INVALID:' + cidr);
  }
  if (cfg.trustProxyCidr && !isValidCidr(cfg.trustProxyCidr)) {
    failures.push('TRUST_PROXY_CIDR_INVALID');
  }
  return { ok: failures.length === 0, failures, config: cfg };
}

module.exports = Object.freeze({
  DEFAULTS,
  firewallConfig,
  normalizePath,
  evaluateRequest,
  createFirewallMiddleware,
  validateFirewallConfiguration,
  isJsonContentType,
  contentTypeBase,
  MAX_SKEW_MS: sovereignBoundary.MAX_SKEW_MS,
  canonicalRequest: sovereignBoundary.canonicalRequest,
  expectedSignature: sovereignBoundary.expectedSignature,
  createSovereignBoundary: sovereignBoundary.createSovereignBoundary
});
