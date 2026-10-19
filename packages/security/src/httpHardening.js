'use strict';

const crypto = require('crypto');
const net = require('node:net');
const { createRedisRateLimitStore, readRedisUrl } = require('./redisRateLimit');

function envBool(env, name, fallback) {
  const v = String((env || process.env)[name] ?? '').trim().toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

function securityConfig(env) {
  env = env || process.env;
  const nodeEnv = String(env.NODE_ENV || 'development').toLowerCase();
  const production = nodeEnv === 'production';
  const configuredLimit = Number(env.SECURITY_RATE_LIMIT_PER_MINUTE);
  const configuredBurst = Number(env.SECURITY_RATE_LIMIT_BURST);
  const baseLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 0;
  const baseBurst = Number.isInteger(configuredBurst) && configuredBurst > 0 ? configuredBurst : 0;
  const classValue = (suffix, fallback) => {
    const n = Number(env[suffix]);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return Object.freeze({
    production,
    headersEnabled: envBool(env, 'SECURITY_HEADERS_ENABLED', true),
    rateLimitEnabled: Number.isInteger(configuredLimit) && configuredLimit > 0,
    rateLimitPerMinute: baseLimit,
    rateLimitBurst: baseBurst,
    rateLimitClasses: Object.freeze({
      low: Object.freeze({ perMinute: classValue('SECURITY_RATE_LIMIT_LOW_PER_MINUTE', baseLimit), burst: classValue('SECURITY_RATE_LIMIT_LOW_BURST', baseBurst) }),
      normal: Object.freeze({ perMinute: classValue('SECURITY_RATE_LIMIT_NORMAL_PER_MINUTE', baseLimit), burst: classValue('SECURITY_RATE_LIMIT_NORMAL_BURST', baseBurst) }),
      strict: Object.freeze({ perMinute: classValue('SECURITY_RATE_LIMIT_STRICT_PER_MINUTE', baseLimit), burst: classValue('SECURITY_RATE_LIMIT_STRICT_BURST', baseBurst) })
    }),
    maxKeys: (Number.isInteger(Number(env.SECURITY_RATE_LIMIT_MAX_KEYS)) && Number(env.SECURITY_RATE_LIMIT_MAX_KEYS) >= 100) ? Number(env.SECURITY_RATE_LIMIT_MAX_KEYS) : 10000,
    rateLimitBackend: String(env.SECURITY_RATE_LIMIT_BACKEND || 'PROCESS_LOCAL').toUpperCase(),
    expectedInstances: Number(env.SECURITY_RATE_LIMIT_EXPECTED_INSTANCES || 1),
    trustProxy: envBool(env, 'TRUST_PROXY', false),
    trustProxyCidr: String(env.TRUST_PROXY_CIDR || '').trim(),
    hstsEnabled: production && envBool(env, 'SECURITY_HSTS_ENABLED', true),
    csp: String(env.SECURITY_CSP || "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"),
    replayDefenseBackend: String(env.FIBEROS_REPLAY_DEFENSE_BACKEND || 'PROCESS_LOCAL').toUpperCase(),
    replayDefenseRequired: envBool(env, 'FIBEROS_REPLAY_DEFENSE_REQUIRED', production),
  });
}

function corsConfiguration(env) {
  const raw = String((env || process.env).CORS_ORIGIN || '').trim();
  if (!raw) return Object.freeze({ wildcard: false, origins: Object.freeze([]), invalid: Object.freeze([]) });
  if (raw === '*') return Object.freeze({ wildcard: true, origins: Object.freeze([]), invalid: Object.freeze([]) });
  const origins = [];
  const invalid = [];
  for (const entry of raw.split(',').map(x => x.trim()).filter(Boolean)) {
    try {
      const url = new URL(entry);
      if (!['http:', 'https:'].includes(url.protocol) ||
          url.username || url.password || url.pathname !== '/' ||
          url.search || url.hash) {
        invalid.push(entry);
        continue;
      }
      const origin = url.origin;
      if (!origins.includes(origin)) origins.push(origin);
    } catch (e) {
      invalid.push(entry);
    }
  }
  return Object.freeze({
    wildcard: false,
    origins: Object.freeze(origins),
    invalid: Object.freeze(invalid)
  });
}

/**
 * Validate and apply the exact CORS origin. A comma-separated origin list
 * cannot be emitted as one ACAO value; reflect only the matching origin.
 */
function applyCorsHeaders(res, req, env) {
  const configured = corsConfiguration(env);
  const requestOrigin = String((req && req.headers && (req.headers.origin || req.headers.Origin)) || '').trim();
  if (!requestOrigin) return { allowed: true, allowOrigin: null, configured };
  if (configured.wildcard) {
    if (envBool(env, 'CORS_ALLOW_CREDENTIALS', false)) return { allowed: false, allowOrigin: null, configured, code: 'CORS_WILDCARD_CREDENTIALS_FORBIDDEN' };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Vary', 'Origin');
    return { allowed: true, allowOrigin: '*', configured };
  }
  if (!configured.origins.includes(requestOrigin)) {
    res.setHeader('Vary', 'Origin');
    return { allowed: false, allowOrigin: null, configured, code: 'CORS_ORIGIN_NOT_ALLOWED' };
  }
  res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  res.setHeader('Vary', 'Origin');
  if (envBool(env, 'CORS_ALLOW_CREDENTIALS', false)) res.setHeader('Access-Control-Allow-Credentials', 'true');
  return { allowed: true, allowOrigin: requestOrigin, configured };
}

function ipv4ToInt(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4 || parts.some(x => !/^\d+$/.test(x) || Number(x) > 255)) return null;
  return parts.reduce((n, x) => ((n * 256) + Number(x)) >>> 0, 0);
}

function ipv4InCidr(ip, cidr) {
  const [base, bitsRaw] = String(cidr || '').trim().split('/');
  const bits = Number(bitsRaw);
  const value = ipv4ToInt(ip), network = ipv4ToInt(base);
  if (value === null || network === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (network & mask);
}


function ipv6ToBytes(ip) {
  let value = String(ip || '').trim().toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1,-1);
  if (value.includes('%')) value = value.split('%',1)[0];
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const v4 = lastColon >= 0 ? value.slice(lastColon+1) : value;
    const v4int = ipv4ToInt(v4);
    if (v4int === null) return null;
    value = value.slice(0,lastColon+1) + ((v4int>>>16)&0xffff).toString(16) + ':' + (v4int&0xffff).toString(16);
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length===2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  if (left.length + right.length > 8) return null;
  const groups = halves.length===2 ? left.concat(new Array(8-left.length-right.length).fill('0'), right) : left;
  if (groups.length !== 8 || groups.some(g=>!/^[0-9a-f]{1,4}$/.test(g))) return null;
  const out = Buffer.alloc(16);
  groups.forEach((g,i)=>out.writeUInt16BE(parseInt(g,16),i*2));
  return out;
}

function ipInCidr(ip, cidr) {
  const parts = String(cidr || '').trim().split('/');
  if (parts.length !== 2) return false;
  const prefix = Number(parts[1]);
  if (!Number.isInteger(prefix)) return false;
  const v4 = ipv4ToInt(String(ip||'').replace(/^::ffff:/i,''));
  const n4 = ipv4ToInt(parts[0]);
  if (v4 !== null && n4 !== null) {
    if (prefix < 0 || prefix > 32) return false;
    if (prefix === 0) return true;
    const mask = (0xffffffff << (32-prefix)) >>> 0;
    return (v4 & mask) === (n4 & mask);
  }
  const v6 = ipv6ToBytes(ip), n6 = ipv6ToBytes(parts[0]);
  if (!v6 || !n6 || prefix < 0 || prefix > 128) return false;
  const full = Math.floor(prefix/8), rem = prefix%8;
  for (let i=0;i<full;i++) if (v6[i] !== n6[i]) return false;
  if (rem) { const mask = 0xff << (8-rem); if ((v6[full] & mask)!==(n6[full] & mask)) return false; }
  return true;
}

function isValidCidr(cidr) {
  const [base,bits] = String(cidr || '').trim().split('/');
  if (!base || bits === undefined) return false;
  const n = Number(bits);
  const v4 = ipv4ToInt(base);
  if (v4 !== null) return Number.isInteger(n) && n >= 0 && n <= 32;
  return !!ipv6ToBytes(base) && Number.isInteger(n) && n >= 0 && n <= 128;
}

function rawHeaderValues(rawHeaders, name) {
  const out=[]; const target=String(name).toLowerCase();
  for(let i=0;i<rawHeaders.length;i+=2) if(String(rawHeaders[i]).toLowerCase()===target) out.push(String(rawHeaders[i+1]??''));
  return out;
}

function validateHttpFraming(req) {
  const failures=[];
  const headers=req && req.headers ? req.headers : {};
  const raw=Array.isArray(req && req.rawHeaders) ? req.rawHeaders : [];
  const cls=rawHeaderValues(raw,'content-length');
  const tes=rawHeaderValues(raw,'transfer-encoding');
  const clHeader = headers['content-length'];
  if (tes.length && (clHeader !== undefined || cls.length)) failures.push('CONTENT_LENGTH_TRANSFER_ENCODING_CONFLICT');
  if (cls.length > 1) {
    const normalized=cls.map(v=>v.trim());
    if (normalized.some(v=>!/^[0-9]+$/.test(v))) failures.push('INVALID_CONTENT_LENGTH');
    else if (new Set(normalized).size !== 1) failures.push('MULTIPLE_CONTENT_LENGTH_MISMATCH');
    else failures.push('DUPLICATE_CONTENT_LENGTH_HEADER');
  }
  if (tes.length > 1) failures.push('DUPLICATE_TRANSFER_ENCODING_HEADER');
  if (clHeader !== undefined && !/^\d+$/.test(String(clHeader).trim())) failures.push('INVALID_CONTENT_LENGTH');
  return { ok: failures.length===0, failures };
}

function clientAddress(req, cfg) {
  const remote = String((req.socket && req.socket.remoteAddress) || 'unknown').trim().replace(/^::ffff:/i, '');
  const proxyTrusted = cfg && cfg.trustProxy && cfg.trustProxyCidr && ipInCidr(remote, cfg.trustProxyCidr);
  if (!proxyTrusted) return remote.slice(0, 128);

  // X-Forwarded-For is a hop-by-hop chain. When the immediate peer is trusted,
  // walk from right to left and return the first address that is not itself a
  // trusted proxy. Taking element 0 would allow a client to spoof its identity
  // by prepending an arbitrary address before the trusted proxy appends its hop.
  const forwarded = String((req.headers && req.headers['x-forwarded-for']) || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (!forwarded.length) return remote.slice(0, 128);
  for (let i = forwarded.length - 1; i >= 0; i--) {
    const candidate = forwarded[i].replace(/^::ffff:/i, '');
    if (candidate.length > 128) continue;
    // A trusted proxy boundary must not turn an arbitrary X-Forwarded-For
    // string into a new attacker-controlled rate-limit identity. Only accept
    // syntactically valid IP addresses from the forwarded chain.
    if (net.isIP(candidate) === 0) continue;
    if (!ipInCidr(candidate, cfg.trustProxyCidr)) return candidate;
  }
  // If every supplied hop is inside the trusted CIDR, there is no independently
  // attributable client address in the header chain. Fail closed to the direct
  // peer instead of trusting a left-most value that cannot be proven client-owned.
  return remote.slice(0, 128);
}

function rateKey(req, principal, policy, cfg) {
  const subject = principal && principal.sub ? String(principal.sub) : '';
  const address = clientAddress(req, cfg || securityConfig(process.env));
  const tenant = principal && principal.tenant_id ? String(principal.tenant_id) : '';
  const scope = policy && policy.scope ? String(policy.scope) : (subject ? 'principal' : 'anonymous');
  const material = scope + '|tenant:' + tenant + '|sub:' + subject + '|ip:' + address;
  return crypto.createHash('sha256').update(material).digest('hex');
}

function securityPolicyFor(path, method, principal) {
  const p = String(path || '/');
  const m = String(method || 'GET').toUpperCase();
  if (p === '/health' || p === '/v1/meta') return { name: 'health', scope: 'ip', limitClass: 'low' };
  if (p.startsWith('/v1/engineering/')) return { name: 'engineering', scope: principal ? 'principal' : 'ip', limitClass: 'strict' };
  if (m === 'POST') return { name: 'write', scope: principal ? 'principal' : 'ip', limitClass: 'strict' };
  return { name: 'read', scope: principal ? 'principal' : 'ip', limitClass: 'normal' };
}

function abusePolicy(env) {
  env = env || process.env;
  const maxBody = Number(env.SECURITY_MAX_BODY_BYTES || 1048576);
  const maxUrl = Number(env.SECURITY_MAX_URL_BYTES || 8192);
  const maxHeader = Number(env.SECURITY_MAX_HEADER_BYTES || 16384);
  return Object.freeze({
    maxBodyBytes: Number.isInteger(maxBody) && maxBody > 0 ? maxBody : 1048576,
    maxUrlBytes: Number.isInteger(maxUrl) && maxUrl > 0 ? maxUrl : 8192,
    maxHeaderBytes: Number.isInteger(maxHeader) && maxHeader > 0 ? maxHeader : 16384,
    rejectUnexpectedContentLength: envBool(env, 'SECURITY_REJECT_UNEXPECTED_CONTENT_LENGTH', true)
  });
}

function validateRequestAbuseBoundary(req, env) {
  const cfg = abusePolicy(env);
  const failures = [];
  const urlBytes = Buffer.byteLength(String(req.url || ''), 'utf8');
  if (urlBytes > cfg.maxUrlBytes) failures.push('URL_TOO_LARGE');
  let headerBytes = 0;
  for (const [k, v] of Object.entries(req.headers || {})) headerBytes += Buffer.byteLength(String(k), 'utf8') + Buffer.byteLength(Array.isArray(v) ? v.join(',') : String(v || ''), 'utf8') + 4;
  if (headerBytes > cfg.maxHeaderBytes) failures.push('HEADERS_TOO_LARGE');
  const cl = req.headers && req.headers['content-length'];
  if (cl !== undefined && !/^\d+$/.test(String(cl))) failures.push('INVALID_CONTENT_LENGTH');
  if (cl !== undefined && Number(cl) > cfg.maxBodyBytes) failures.push('BODY_TOO_LARGE');
  if (cfg.rejectUnexpectedContentLength && ['POST','PUT','PATCH'].includes(String(req.method || '').toUpperCase()) && cl === undefined) failures.push('CONTENT_LENGTH_REQUIRED_FOR_MUTATION');
  return { ok: failures.length === 0, failures, config: cfg };
}

function createRateLimiter(env, nowFn) {
  const cfg = securityConfig(env);
  if (!['PROCESS_LOCAL', 'REDIS'].includes(cfg.rateLimitBackend)) {
    throw new Error(
      'RATE_LIMIT_BACKEND_UNSUPPORTED: SECURITY_RATE_LIMIT_BACKEND must be PROCESS_LOCAL or REDIS'
    );
  }
  if (cfg.production && cfg.rateLimitBackend === 'PROCESS_LOCAL' && cfg.expectedInstances > 1) {
    throw new Error(
      'PROCESS_LOCAL_RATE_LIMIT_UNSAFE_FOR_MULTI_INSTANCE: production requires a real shared rate-limit store when SECURITY_RATE_LIMIT_EXPECTED_INSTANCES > 1'
    );
  }
  if (!Number.isInteger(cfg.expectedInstances) || cfg.expectedInstances < 1) {
    throw new Error('SECURITY_RATE_LIMIT_EXPECTED_INSTANCES_INVALID');
  }
  const redisStore = cfg.rateLimitBackend === 'REDIS' && cfg.rateLimitEnabled
    ? createRedisRateLimitStore(env)
    : null;
  const now = nowFn || (() => Date.now());
  const buckets = new Map();
  const windowMs = 60000;

  function limitsFor(policy) {
    const limitClass = policy && policy.limitClass ? String(policy.limitClass) : 'normal';
    return cfg.rateLimitClasses[limitClass] || cfg.rateLimitClasses.normal;
  }

  function cleanup(ts) {
    for (const [key, b] of buckets) {
      if (ts - b.lastSeen > windowMs * 2) buckets.delete(key);
    }
    if (buckets.size <= cfg.maxKeys) return;
    const entries = Array.from(buckets.entries()).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    const remove = buckets.size - cfg.maxKeys;
    for (let i = 0; i < remove; i++) buckets.delete(entries[i][0]);
  }

  if (cfg.rateLimitBackend === 'REDIS') {
    return {
      configured: cfg.rateLimitEnabled,
      scope: 'SHARED_REDIS',
      async allow(key, policy) {
        if (!cfg.rateLimitEnabled) return { allowed: true, remaining: null, retryAfter: null, limit: null };
        const limits = limitsFor(policy);
        return redisStore.consume(key, { ...limits, limitClass: policy && policy.limitClass || 'normal' });
      },
      async close() { if (redisStore) await redisStore.close(); },
      size() { return null; }
    };
  }

  return {
    configured: cfg.rateLimitEnabled,
    scope: 'PROCESS_LOCAL',
    allow(key, policy) {
      if (!cfg.rateLimitEnabled) return { allowed: true, remaining: null, retryAfter: null, limit: null };
      const limits = limitsFor(policy);
      const capacity = limits.perMinute + limits.burst;
      const refillPerMs = limits.perMinute / windowMs;
      const ts = now();
      cleanup(ts);
      let b = buckets.get(key);
      if (!b) { b = { tokens: capacity, lastSeen: ts }; buckets.set(key, b); cleanup(ts); b = buckets.get(key) || { tokens: capacity, lastSeen: ts }; if (!b.lastSeen) buckets.set(key, b); }
      const elapsed = Math.max(0, ts - b.lastSeen);
      b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
      b.lastSeen = ts;
      if (b.tokens < 1) {
        return { allowed: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000)), limit: capacity };
      }
      b.tokens -= 1;
      return { allowed: true, remaining: Math.max(0, Math.floor(b.tokens)), retryAfter: null, limit: capacity };
    },
    async close() {},
    size() { return buckets.size; }
  };
}

function applySecurityHeaders(res, env) {
  const cfg = securityConfig(env);
  if (!cfg.headersEnabled || res.headersSent) return;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', cfg.csp);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (cfg.hstsEnabled) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function replayProtectedRoute(path, method, env) {
  const configured = String((env || process.env).FIBEROS_REPLAY_PROTECTED_ROUTES ||
    '/v1/tickets/close-field,POST;/v1/evidence/submit,POST;/v1/sync/batch,POST;/v1/billing/invoices,POST;/v1/billing/payment-cycle,POST;/v1/ops/rework-cases,POST').trim();
  const target = `${String(path || '/').replace(/\/+$/, '') || '/'},${String(method || 'GET').toUpperCase()}`;
  return configured.split(';').map(v => v.trim()).filter(Boolean).includes(target);
}

function validateSecurityConfiguration(env) {
  env = env || process.env;
  const cfg = securityConfig(env);
  const failures = [];
  if (cfg.production && !cfg.headersEnabled) failures.push('SECURITY_HEADERS_DISABLED_IN_PRODUCTION');
  if (cfg.production && !cfg.rateLimitEnabled) failures.push('SECURITY_RATE_LIMIT_NOT_CONFIGURED');
  if (!['PROCESS_LOCAL', 'REDIS'].includes(cfg.rateLimitBackend)) failures.push('RATE_LIMIT_BACKEND_UNSUPPORTED');
  if (!Number.isInteger(cfg.expectedInstances) || cfg.expectedInstances < 1) failures.push('SECURITY_RATE_LIMIT_EXPECTED_INSTANCES_INVALID');
  if (cfg.production && !String(env.CORS_ORIGIN || '').trim()) failures.push('CORS_ORIGIN_REQUIRED_IN_PRODUCTION');
  if (cfg.production && String(env.CORS_ORIGIN || '').trim() === '*') failures.push('CORS_WILDCARD_FORBIDDEN_IN_PRODUCTION');
  const cors = corsConfiguration(env);
  if (cors.invalid.length) failures.push('CORS_ORIGIN_INVALID');
  if (String(env.CORS_ORIGIN || '').trim() && !cors.wildcard && !cors.origins.length) failures.push('CORS_ORIGIN_INVALID');
  if (cfg.production && cfg.trustProxy && !String(env.TRUST_PROXY_CIDR || '').trim()) failures.push('TRUST_PROXY_CIDR_REQUIRED');
  if (cfg.trustProxy && String(env.TRUST_PROXY_CIDR || '').trim() && !isValidCidr(String(env.TRUST_PROXY_CIDR))) failures.push('TRUST_PROXY_CIDR_INVALID');
  if (cfg.production && cfg.rateLimitBackend === 'PROCESS_LOCAL' && cfg.expectedInstances > 1) failures.push('PROCESS_LOCAL_RATE_LIMIT_UNSAFE_FOR_MULTI_INSTANCE');
  if (cfg.replayDefenseRequired && cfg.replayDefenseBackend !== 'REDIS') failures.push('REPLAY_DEFENSE_REDIS_REQUIRED');
  if (cfg.replayDefenseBackend === 'REDIS') {
    try { readRedisUrl(env); } catch (error) { failures.push(error.code || 'REPLAY_DEFENSE_REDIS_CONFIGURATION_INVALID'); }
  }
  if (cfg.production && envBool(env, 'CORS_ALLOW_CREDENTIALS', false) && (!String(env.CORS_ORIGIN || '').trim() || String(env.CORS_ORIGIN).trim() === '*')) failures.push('CORS_CREDENTIALS_REQUIRE_EXACT_ORIGIN');
  if (cfg.rateLimitBackend === 'REDIS' && cfg.rateLimitEnabled) {
    try { readRedisUrl(env); } catch (error) { failures.push(error.code || 'REDIS_RATE_LIMIT_CONFIGURATION_INVALID'); }
  }
  if (cfg.production && !['true', 'false'].includes(String(env.FIBEROS_KERNEL_BOUNDARY_REQUIRED || '').trim().toLowerCase())) failures.push('KERNEL_BOUNDARY_MODE_MUST_BE_EXPLICIT_IN_PRODUCTION');
  if (cfg.production && String(env.FIBEROS_KERNEL_BOUNDARY_REQUIRED || '').trim().toLowerCase() === 'true') {
    const secret = String(env.FIBEROS_KERNEL_HMAC_SECRET || env.SIGNING_HMAC_SECRET || '').trim();
    if (Buffer.byteLength(secret, 'utf8') < 32) failures.push('KERNEL_BOUNDARY_HMAC_SECRET_TOO_WEAK');
    if (cfg.expectedInstances > 1 && cfg.replayDefenseBackend !== 'REDIS') failures.push('KERNEL_BOUNDARY_REPLAY_STORE_PROCESS_LOCAL_FOR_MULTI_INSTANCE');
  }
  if (cfg.production && /unsafe-(?:inline|eval)/i.test(cfg.csp)) failures.push('INSECURE_CSP_DIRECTIVE_IN_PRODUCTION');
  if (env.SECURITY_MAX_BODY_BYTES != null &&
      (!Number.isInteger(Number(env.SECURITY_MAX_BODY_BYTES)) || Number(env.SECURITY_MAX_BODY_BYTES) <= 0 || Number(env.SECURITY_MAX_BODY_BYTES) > 50 * 1024 * 1024)) {
    failures.push('SECURITY_MAX_BODY_BYTES_INVALID');
  }
  if (cfg.production && String(env.CORS_ORIGIN || '').trim() && String(env.CORS_ORIGIN).trim() !== '*') {
    const origins = String(env.CORS_ORIGIN).split(',').map(x => x.trim()).filter(Boolean);
    if (origins.some(x => { try { const u = new URL(x); return u.protocol !== 'https:'; } catch (e) { return true; } })) failures.push('CORS_ORIGIN_MUST_USE_HTTPS');
  }
  if (!Number.isInteger(cfg.maxKeys) || cfg.maxKeys < 100) failures.push('SECURITY_RATE_LIMIT_MAX_KEYS_INVALID');
  return { ok: failures.length === 0, failures, config: cfg };
}

module.exports = { securityConfig, corsConfiguration, applyCorsHeaders, createRateLimiter, applySecurityHeaders, validateSecurityConfiguration, rateKey, clientAddress, securityPolicyFor, abusePolicy, validateRequestAbuseBoundary, validateHttpFraming, isValidCidr, ipInCidr, replayProtectedRoute };
