/**
 * JWT boundary for FiberOS API.
 *
 * Modes:
 *  - JWT_SECRET set → HS256 verify (common Supabase legacy JWT secret)
 *  - JWT_VERIFY=false → decode only (LAB); principal.verified=false
 *  - missing secret + JWT_VERIFY not false → reject authenticated claims
 *
 * Never trusts localStorage. Role from app_metadata.role only.
 */
'use strict';

function b64urlToBuf(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function decodePart(part) {
  return JSON.parse(b64urlToBuf(part).toString('utf8'));
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  if (typeof require('crypto').timingSafeEqual === 'function') {
    return require('crypto').timingSafeEqual(ba, bb);
  }
  var out = 0;
  for (var i = 0; i < ba.length; i++) out |= ba[i] ^ bb[i];
  return out === 0;
}

function signHs256(input, secret) {
  return require('crypto').createHmac('sha256', secret).update(input).digest('base64url');
}

/**
 * @returns {{ok:boolean, verified:boolean, principal?:object, error?:string}}
 */
function verifyBearerToken(token, env) {
  env = env || process.env;
  if (!token) {
    return { ok: true, verified: false, principal: { authenticated: false, role: null, sub: null, reason: 'NO_BEARER' } };
  }
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  if (production) return { ok:false, verified:false, error:'PRODUCTION_HS256_FORBIDDEN' };
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    return { ok: false, verified: false, error: 'MALFORMED_JWT' };
  }

  var header, payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch (e) {
    return { ok: false, verified: false, error: 'JWT_DECODE_FAILED' };
  }

  const secret = env.JWT_SECRET || env.SUPABASE_JWT_SECRET || '';
  const forceLab = String(env.JWT_VERIFY || 'true').toLowerCase() === 'false';
  const explicitLab = String(env.FIBEROS_LAB_MODE || '').toLowerCase() === 'true';
  if (forceLab && (!explicitLab || production)) {
    return { ok: false, verified: false, error: 'LAB_AUTH_MODE_FORBIDDEN' };
  }

  var verified = false;
  if (secret) {
    if (production && Buffer.byteLength(String(secret), 'utf8') < 32) {
      return { ok: false, verified: false, error: 'JWT_SECRET_TOO_WEAK' };
    }
    const alg = header && header.alg;
    // RFC 7515 requires a JOSE `alg` header. Never infer a signing
    // algorithm from a missing field; inference can turn malformed tokens
    // into valid tokens when the signature happens to use the local default.
    if (typeof alg !== 'string' || alg !== 'HS256') {
      return { ok: false, verified: false, error: 'UNSUPPORTED_ALG', alg: alg };
    }
    const data = parts[0] + '.' + parts[1];
    const expected = signHs256(data, secret);
    if (!timingSafeEqual(expected, parts[2])) {
      return { ok: false, verified: false, error: 'INVALID_SIGNATURE' };
    }
    verified = true;
  } else if (forceLab) {
    verified = false;
  } else {
    return {
      ok: false,
      verified: false,
      error: 'JWT_SECRET_REQUIRED',
      note: 'Set JWT_SECRET or SUPABASE_JWT_SECRET; decode-only mode requires explicit FIBEROS_LAB_MODE=true and is forbidden in production'
    };
  }

  /* Registered-time claims: malformed values fail closed. */
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp != null) {
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp)) return { ok: false, verified: verified, error: 'EXP_INVALID' };
    if (exp <= now) return { ok: false, verified: verified, error: 'TOKEN_EXPIRED' };
  }
  if (payload.nbf != null) {
    const nbf = Number(payload.nbf);
    if (!Number.isFinite(nbf)) return { ok: false, verified: verified, error: 'NBF_INVALID' };
    if (nbf > now) return { ok: false, verified: verified, error: 'TOKEN_NOT_ACTIVE' };
  }

  if (env.JWT_ISSUER != null && String(env.JWT_ISSUER) !== '') {
    if (payload.iss !== env.JWT_ISSUER) return { ok: false, verified: verified, error: 'ISSUER_MISMATCH' };
  }
  if (env.JWT_AUDIENCE != null && String(env.JWT_AUDIENCE) !== '') {
    const expectedAud = String(env.JWT_AUDIENCE);
    const actualAud = payload.aud;
    const audienceOk = Array.isArray(actualAud) ? actualAud.includes(expectedAud) : actualAud === expectedAud;
    if (!audienceOk) return { ok: false, verified: verified, error: 'AUDIENCE_MISMATCH' };
  }

  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    return { ok: false, verified: verified, error: 'SUB_REQUIRED' };
  }
  const roleClaim = payload.app_metadata && payload.app_metadata.role;
  if (roleClaim != null && typeof roleClaim !== 'string') {
    return { ok: false, verified: verified, error: 'ROLE_CLAIM_INVALID' };
  }
  const role = roleClaim || null;

  return {
    ok: true,
    verified: verified,
    principal: {
      authenticated: true,
      verified: verified,
      role: role,
      sub: payload.sub || null,
      email: payload.email || null,
      raw: forceLab ? undefined : undefined
    }
  };
}

function parseBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function getRequestPrincipal(req, env) {
  const token = parseBearer(req);
  const result = verifyBearerToken(token, env);
  if (!result.ok) {
    return {
      authenticated: false,
      verified: false,
      role: null,
      sub: null,
      error: result.error,
      note: result.note
    };
  }
  return result.principal;
}

/** Test helper: mint HS256 token when secret known */
function mintHs256(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = signHs256(header + '.' + body, secret);
  return header + '.' + body + '.' + sig;
}


const oidcJwksCache = new Map();
const negativeKidRefresh = new Map();
const net = require('net');
const { parseAttestedOutboundUrl, resolveAttestedOutboundTarget, requestAttested } = require('./outboundPolicy');

function normalizeJwksUrl(env) {
  const raw = String((env || process.env).OIDC_JWKS_URL || '').trim();
  return raw;
}

function configuredHostAllowlist(env) {
  return String((env || process.env).OIDC_JWKS_ALLOWED_HOSTS || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedJwksHost(hostname, allowlist) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return !!host && allowlist.includes(host);
}


async function fetchJwks(url, env) {
  env = env || process.env;
  let u;
  try { u = new URL(url); } catch (e) { throw new Error('OIDC_JWKS_URL_INVALID'); }
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  if (u.username || u.password) throw new Error('OIDC_JWKS_CREDENTIALS_FORBIDDEN');
  if (u.protocol !== 'https:' && production) throw new Error('OIDC_JWKS_HTTPS_REQUIRED');
  const allowlist = configuredHostAllowlist(env);
  if (production && !allowlist.length) throw new Error('OIDC_JWKS_HOST_ALLOWLIST_REQUIRED');
  if (production && !isAllowedJwksHost(u.hostname, allowlist)) throw new Error('OIDC_JWKS_HOST_NOT_ALLOWLISTED');
  if (!production && !allowlist.includes(u.hostname.toLowerCase().replace(/\.$/, ''))) throw new Error('OIDC_JWKS_HOST_NOT_ALLOWLISTED');
  const ttl = Math.max(1000, Number(env.OIDC_JWKS_CACHE_TTL_MS || 300000));
  const cached = oidcJwksCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const timeoutMs=Math.min(10000,Math.max(500,Number(env.OIDC_JWKS_TIMEOUT_MS||5000)));
  const maxBytes=Math.min(1024*1024,Math.max(4096,Number(env.OIDC_JWKS_MAX_BYTES||262144)));
  let raw;
  try {
    const base = parseAttestedOutboundUrl(url, {
      env:{...process.env, ...env}, envName:'OIDC_JWKS_URL', codePrefix:'OIDC_JWKS',
      allowedHostsEnv:'OIDC_JWKS_ALLOWED_HOSTS', cidrsEnv:'OIDC_JWKS_ALLOWED_CIDRS',
      productionPort443:true
    });
    const target = await resolveAttestedOutboundTarget(base, {
      env:{...process.env, ...env}, codePrefix:'OIDC_JWKS',
      allowedHostsEnv:'OIDC_JWKS_ALLOWED_HOSTS', cidrsEnv:'OIDC_JWKS_ALLOWED_CIDRS'
    });
    const response = await requestAttested(base, target, { codePrefix:'OIDC_JWKS', method:'GET', timeoutMs, maxResponseBytes:maxBytes, headers:{Accept:'application/json'} });
    if (response.status !== 200) throw new Error('OIDC_JWKS_FETCH_FAILED:' + response.status);
    raw=response.body.toString('utf8');
  } catch (e) {
    throw e;
  }
  let body; try { body=JSON.parse(raw); } catch { throw new Error('OIDC_JWKS_INVALID_JSON'); }
  if (!body || !Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 64) throw new Error('OIDC_JWKS_INVALID');
  const kids=new Set();
  for (const key of body.keys) {
    if (!key || typeof key !== 'object' || key.kty !== 'RSA' || typeof key.kid !== 'string' || !key.n || !key.e) throw new Error('OIDC_JWKS_KEY_INVALID');
    if (kids.has(key.kid)) throw new Error('OIDC_JWKS_DUPLICATE_KID');
    kids.add(key.kid);
    if (key.use != null && key.use !== 'sig') throw new Error('OIDC_JWKS_KEY_USE_INVALID');
    if (key.alg != null && key.alg !== 'RS256') throw new Error('OIDC_JWKS_KEY_ALG_INVALID');
    if (Array.isArray(key.key_ops) && !key.key_ops.includes('verify')) throw new Error('OIDC_JWKS_KEY_OPS_INVALID');
  }
  oidcJwksCache.set(url, { keys: body.keys, expiresAt: Date.now() + ttl });
  return body.keys;
}

function verifyRs256WithJwk(data, signaturePart, jwk) {
  if (!jwk || jwk.kty !== 'RSA' || jwk.n == null || jwk.e == null) return false;
  const key = require('crypto').createPublicKey({ key: jwk, format: 'jwk' });
  const verify = require('crypto').createVerify('RSA-SHA256');
  verify.update(data);
  verify.end();
  return verify.verify(key, b64urlToBuf(signaturePart));
}

/**
 * Async production identity boundary for OIDC/JWKS.
 * Synchronous verifyBearerToken intentionally remains HMAC-only for existing
 * offline/unit callers. API request handling uses this async boundary.
 */
async function verifyBearerTokenAsync(token, env) {
  env = env || process.env;
  if (!token) return { ok:true, verified:false, principal:{authenticated:false, role:null, sub:null, reason:'NO_BEARER'} };
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const jwksUrl = normalizeJwksUrl(env);
  if (production && !jwksUrl) return { ok:false, verified:false, error:'OIDC_JWKS_URL_REQUIRED_IN_PRODUCTION' };
  if (!jwksUrl) return verifyBearerToken(token, env);
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false, verified: false, error: 'MALFORMED_JWT' };
  let header, payload;
  try { header = decodePart(parts[0]); payload = decodePart(parts[1]); }
  catch (e) { return { ok: false, verified: false, error: 'JWT_DECODE_FAILED' }; }
  if (!header || header.alg !== 'RS256') return { ok: false, verified: false, error: 'UNSUPPORTED_ALG', alg: header && header.alg };
  if (!header.kid) return { ok: false, verified: false, error: 'KID_REQUIRED' };
  try {
    const keys = await fetchJwks(jwksUrl, env);
    let jwk = keys.find(k => k && k.kid === header.kid && k.use !== 'enc');
    if (!jwk) {
      const nowMs=Date.now();
      const key=String(jwksUrl)+'\0'+String(header.kid);
      const minRefreshMs=Math.max(1000,Number(env.OIDC_JWKS_UNKNOWN_KID_REFRESH_MS||10000));
      const last=negativeKidRefresh.get(key)||0;
      if (nowMs-last < minRefreshMs) return {ok:false,verified:false,error:'OIDC_JWKS_UNKNOWN_KID_REFRESH_THROTTLED'};
      negativeKidRefresh.set(key,nowMs);
      if (negativeKidRefresh.size>2048) { for (const [k,t] of negativeKidRefresh) if (nowMs-t>minRefreshMs*6) negativeKidRefresh.delete(k); }
      // One bounded forced refresh handles normal key rotation without allowing attacker-controlled refresh storms.
      oidcJwksCache.delete(jwksUrl);
      jwk = (await fetchJwks(jwksUrl, env)).find(k => k && k.kid === header.kid && k.use !== 'enc');
    }
    if (!jwk) return { ok: false, verified: false, error: 'JWKS_KID_NOT_FOUND' };
    if (!verifyRs256WithJwk(parts[0] + '.' + parts[1], parts[2], jwk)) {
      return { ok: false, verified: false, error: 'INVALID_SIGNATURE' };
    }
  } catch (e) {
    return { ok: false, verified: false, error: e.message || 'OIDC_VERIFICATION_FAILED' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp == null || !Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) return { ok: false, verified: true, error: payload.exp == null ? 'EXP_REQUIRED' : 'TOKEN_EXPIRED' };
  if (payload.nbf != null && (!Number.isFinite(Number(payload.nbf)) || Number(payload.nbf) > now)) return { ok: false, verified: true, error: payload.nbf == null ? 'NBF_INVALID' : 'TOKEN_NOT_ACTIVE' };
  const issuer = String(env.OIDC_ISSUER || env.JWT_ISSUER || '');
  if (!issuer) return { ok: false, verified: true, error: 'OIDC_ISSUER_REQUIRED' };
  if (payload.iss !== issuer) return { ok: false, verified: true, error: 'ISSUER_MISMATCH' };
  const expectedAud = String(env.OIDC_AUDIENCE || env.JWT_AUDIENCE || '');
  if (!expectedAud) return { ok: false, verified: true, error: 'OIDC_AUDIENCE_REQUIRED' };
  const aud = payload.aud;
  const audienceOk = Array.isArray(aud) ? aud.includes(expectedAud) : aud === expectedAud;
  if (!audienceOk) return { ok: false, verified: true, error: 'AUDIENCE_MISMATCH' };
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) return { ok: false, verified: true, error: 'SUB_REQUIRED' };
  const roleClaim = payload.app_metadata && payload.app_metadata.role;
  if (roleClaim != null && typeof roleClaim !== 'string') return { ok: false, verified: true, error: 'ROLE_CLAIM_INVALID' };
  const role = roleClaim || null;
  return { ok: true, verified: true, principal: { authenticated: true, verified: true, role, sub: payload.sub, email: payload.email || null } };
}

async function getRequestPrincipalAsync(req, env) {
  const token = parseBearer(req);
  const result = await verifyBearerTokenAsync(token, env || process.env);
  if (!result.ok) return { authenticated: false, verified: false, role: null, sub: null, error: result.error, note: result.note };
  return result.principal;
}

module.exports = {
  verifyBearerToken,
  parseBearer,
  getRequestPrincipal,
  mintHs256,
  verifyBearerTokenAsync,
  getRequestPrincipalAsync,
  signHs256
};
