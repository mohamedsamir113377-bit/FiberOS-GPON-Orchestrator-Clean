'use strict';

const crypto = require('node:crypto');
const { verifyBearerTokenAsync } = require('../../../../packages/security/src/jwt');
const {
  parseAttestedOutboundUrl,
  resolveAttestedOutboundTarget,
  joinAttestedPath,
  requestAttestedJson
} = require('../../../../packages/security/src/outboundPolicy');

function codedError(code, status = 500) { const error = new Error(code); error.code = code; error.status = status; return error; }
function normalizeIssuer(value) { return String(value || '').trim().replace(/\/+$/, ''); }
function safeRedirectPath(value, fallback) { const text = String(value || ''); return /^\/[^/]/.test(text) && !text.includes('\\') && !text.includes('\r') && !text.includes('\n') ? text : fallback; }
function b64urlDecodeJson(part) { return JSON.parse(Buffer.from(String(part).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(part).length % 4) % 4), 'base64').toString('utf8')); }
function parseJwtPayload(token) { const parts = String(token || '').split('.'); if (parts.length !== 3) throw codedError('OIDC_ID_TOKEN_MALFORMED', 401); try { return b64urlDecodeJson(parts[1]); } catch (_) { throw codedError('OIDC_ID_TOKEN_INVALID', 401); } }
function parseCookies(req) {
  const out = Object.create(null);
  const raw = String((req && req.headers && req.headers.cookie) || '');
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(key)) out[key] = decodeURIComponent(value);
  }
  return out;
}
function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}
function appendSetCookie(res, value) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current.slice() : [String(current)]) : [];
  values.push(value);
  res.setHeader('Set-Cookie', values);
}

function createOidcAuthServer(options = {}) {
  const env = options.env || process.env;
  const issuerUrl = normalizeIssuer(options.issuerUrl || env.FIBEROS_OIDC_ISSUER_URL);
  const clientId = String(options.clientId || env.FIBEROS_OIDC_CLIENT_ID || '').trim();
  const clientSecret = String(options.clientSecret || env.FIBEROS_OIDC_CLIENT_SECRET || '').trim();
  const redirectUri = String(options.redirectUri || `${String(env.FIBEROS_OPS_API_BASE_URL || '').replace(/\/$/, '')}/auth/oidc/callback`).trim();
  const dashboardUrl = String(options.dashboardUrl || env.FIBEROS_OPS_WEB_DASHBOARD_URL || '/').trim();
  const sessionStore = options.sessionStore || null;
  const stateTtlSeconds = Number(env.FIBEROS_OIDC_STATE_TTL_SECONDS || 600);
  const sessionTtlSeconds = Number(env.FIBEROS_OIDC_SESSION_TTL_SECONDS || 3600);
  let discoveryPromise = null;

  if (!issuerUrl || !clientId || !clientSecret || !redirectUri) {
    return Object.freeze({ configured: false, error: 'OIDC_INTERACTIVE_CONFIG_INCOMPLETE' });
  }
  if (!sessionStore) return Object.freeze({ configured: false, error: 'OIDC_SESSION_STORE_REQUIRED' });
  if (!Number.isInteger(stateTtlSeconds) || stateTtlSeconds < 60 || stateTtlSeconds > 900) return Object.freeze({ configured: false, error: 'OIDC_STATE_TTL_INVALID' });
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 300 || sessionTtlSeconds > 86400) return Object.freeze({ configured: false, error: 'OIDC_SESSION_TTL_INVALID' });

  async function discover() {
    if (discoveryPromise) return discoveryPromise;
    discoveryPromise = (async () => {
      const discoveryRaw = String(env.FIBEROS_OIDC_DISCOVERY_URL || '').trim();
      const discoveryUrl = discoveryRaw || joinAttestedPath(parseAttestedOutboundUrl(issuerUrl, {
        env: { ...process.env, ...env }, envName: 'FIBEROS_OIDC_ISSUER_URL', codePrefix: 'OIDC',
        allowedHostsEnv: 'OIDC_JWKS_ALLOWED_HOSTS', cidrsEnv: 'OIDC_JWKS_ALLOWED_CIDRS', productionPort443: true
      }), '/.well-known/openid-configuration').toString();
      const parsed = parseAttestedOutboundUrl(discoveryUrl, {
        env: { ...process.env, ...env }, envName: 'FIBEROS_OIDC_DISCOVERY_URL', codePrefix: 'OIDC_DISCOVERY',
        allowedHostsEnv: 'OIDC_JWKS_ALLOWED_HOSTS', cidrsEnv: 'OIDC_JWKS_ALLOWED_CIDRS', productionPort443: true
      });
      const target = await resolveAttestedOutboundTarget(parsed, {
        env: { ...process.env, ...env }, codePrefix: 'OIDC_DISCOVERY',
        allowedHostsEnv: 'OIDC_JWKS_ALLOWED_HOSTS', cidrsEnv: 'OIDC_JWKS_ALLOWED_CIDRS'
      });
      const response = await requestAttestedJson(parsed, target, { codePrefix: 'OIDC_DISCOVERY', method: 'GET', timeoutMs: 5000, maxResponseBytes: 262144, headers: { Accept: 'application/json' } });
      if (response.status !== 200 || !response.data) throw codedError('OIDC_DISCOVERY_FAILED', 502);
      const data = response.data;
      if (normalizeIssuer(data.issuer) !== issuerUrl) throw codedError('OIDC_ISSUER_DISCOVERY_MISMATCH', 502);
      for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (typeof data[key] !== 'string' || !data[key]) throw codedError(`OIDC_DISCOVERY_${key.toUpperCase()}_MISSING`, 502);
      return Object.freeze(data);
    })().catch(error => { discoveryPromise = null; throw error; });
    return discoveryPromise;
  }

  async function authorizationUrl(returnTo = '/') {
    const discovery = await discover();
    const state = sessionStore.newId();
    const nonce = sessionStore.newCsrfToken();
    const verifier = sessionStore.newCsrfToken() + sessionStore.newCsrfToken();
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const safeReturnTo = safeRedirectPath(returnTo, '/dashboard');
    await sessionStore.createTransaction(state, { nonce, codeVerifier: verifier, returnTo: safeReturnTo, createdAt: Date.now() }, stateTtlSeconds);
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }).toString();
    return { url: url.toString(), state };
  }

  async function exchangeCode(code, verifier) {
    const discovery = await discover();
    const parsed = parseAttestedOutboundUrl(discovery.token_endpoint, {
      env: { ...process.env, ...env }, envName: 'FIBEROS_OIDC_TOKEN_ENDPOINT', codePrefix: 'OIDC_TOKEN',
      allowedHostsEnv: 'OIDC_JWKS_ALLOWED_HOSTS', cidrsEnv: 'OIDC_JWKS_ALLOWED_CIDRS', productionPort443: true
    });
    const target = await resolveAttestedOutboundTarget(parsed, {
      env: { ...process.env, ...env }, codePrefix: 'OIDC_TOKEN',
      allowedHostsEnv: 'OIDC_JWKS_ALLOWED_HOSTS', cidrsEnv: 'OIDC_JWKS_ALLOWED_CIDRS'
    });
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: verifier }).toString();
    const response = await requestAttestedJson(parsed, target, { codePrefix: 'OIDC_TOKEN', method: 'POST', timeoutMs: 7000, maxResponseBytes: 524288, body, headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (response.status < 200 || response.status >= 300 || !response.data) throw codedError('OIDC_CODE_EXCHANGE_FAILED', 401);
    if (typeof response.data.id_token !== 'string' || !response.data.id_token) throw codedError('OIDC_ID_TOKEN_REQUIRED', 401);
    return response.data;
  }

  async function validateIdToken(idToken, transaction) {
    const discovery = await discover();
    const verifierEnv = {
      ...process.env, ...env,
      NODE_ENV: env.NODE_ENV,
      OIDC_JWKS_URL: discovery.jwks_uri,
      OIDC_ISSUER: issuerUrl,
      OIDC_AUDIENCE: clientId
    };
    const result = await verifyBearerTokenAsync(idToken, verifierEnv);
    if (!result.ok || !result.verified) throw codedError('OIDC_ID_TOKEN_VALIDATION_FAILED', 401);
    const claims = parseJwtPayload(idToken);
    if (claims.nonce !== transaction.nonce) throw codedError('OIDC_NONCE_MISMATCH', 401);
    if (claims.auth_time != null && !Number.isFinite(Number(claims.auth_time))) throw codedError('OIDC_AUTH_TIME_INVALID', 401);
    return claims;
  }

  async function signIn(returnTo) {
    const result = await authorizationUrl(returnTo);
    return result;
  }

  async function callback(code, state) {
    if (!code || !state) throw codedError('OIDC_CALLBACK_PARAMETERS_REQUIRED', 400);
    const transaction = await sessionStore.consumeTransaction(state);
    if (!transaction) throw codedError('OIDC_STATE_INVALID_OR_EXPIRED', 401);
    const tokenSet = await exchangeCode(code, transaction.codeVerifier);
    const claims = await validateIdToken(tokenSet.id_token, transaction);
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) throw codedError('OIDC_SUB_REQUIRED', 401);
    const sessionId = sessionStore.newId();
    const csrfToken = sessionStore.newCsrfToken();
    const session = { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : null, role: claims.app_metadata && typeof claims.app_metadata.role === 'string' ? claims.app_metadata.role : (typeof claims.role === 'string' ? claims.role : null), csrfToken, issuer: issuerUrl, audience: clientId, createdAt: Date.now(), expiresAt: Date.now() + sessionTtlSeconds * 1000 };
    await sessionStore.setSession(sessionId, session, sessionTtlSeconds);
    return { sessionId, session, returnTo: safeRedirectPath(transaction.returnTo, '/dashboard') };
  }

  async function logout(sessionId) {
    if (sessionId) await sessionStore.deleteSession(sessionId);
  }

  async function getSession(sessionId) {
    if (!sessionId) return null;
    const session = await sessionStore.getSession(sessionId);
    if (!session || session.expiresAt <= Date.now()) { if (session) await sessionStore.deleteSession(sessionId); return null; }
    return session;
  }

  return Object.freeze({ configured: true, clientId, issuerUrl, redirectUri, dashboardUrl, authorizationUrl, signIn, callback, logout, getSession, parseCookies, cookie, appendSetCookie });
}

module.exports = Object.freeze({ createOidcAuthServer, parseCookies, cookie, appendSetCookie });
