'use strict';

const { parseCookies, cookie, appendSetCookie } = require('../../auth/oidcAuthServer');

function originAllowed(req, env) {
  const expected = String(env.FIBEROS_OPS_WEB_ORIGIN || '').trim();
  if (!expected) return true;
  const origin = String(req.headers.origin || '').trim();
  return !origin || origin === expected;
}

async function handleOidcRoute(req, res, { oidcServer, send, env = process.env } = {}) {
  const url = new URL(req.url || '/', 'http://fiberos.local');
  const method = String(req.method || 'GET').toUpperCase();
  const path = url.pathname;
  const secureCookie = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!oidcServer || !oidcServer.configured) return send(res, 503, { ok: false, error: oidcServer && oidcServer.error ? oidcServer.error : 'OIDC_NOT_CONFIGURED' });

  if (path === '/auth/oidc/login' && (method === 'GET' || method === 'POST')) {
    try {
      const { url: location, state } = await oidcServer.signIn(url.searchParams.get('returnTo') || '/dashboard');
      appendSetCookie(res, cookie('fiberos_oidc_state', state, { maxAge: 600, path: '/auth/oidc/callback', httpOnly: true, secure: secureCookie, sameSite: 'Lax' }));
      res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
      return res.end();
    } catch (error) {
      return send(res, error.status || 503, { ok: false, error: error.code || 'OIDC_LOGIN_FAILED' });
    }
  }

  if (path === '/auth/oidc/callback' && method === 'GET') {
    const code = String(url.searchParams.get('code') || '');
    const state = String(url.searchParams.get('state') || '');
    const cookies = parseCookies(req);
    try {
      if (!code || !state || cookies.fiberos_oidc_state !== state) throw Object.assign(new Error('OIDC_STATE_INVALID'), { code: 'OIDC_STATE_INVALID', status: 401 });
      const result = await oidcServer.callback(code, state);
      appendSetCookie(res, cookie('fiberos_oidc_state', '', { maxAge: 0, path: '/auth/oidc/callback', httpOnly: true, secure: secureCookie, sameSite: 'Lax' }));
      appendSetCookie(res, cookie('fiberos_sid', result.sessionId, { maxAge: Math.max(0, Math.floor((result.session.expiresAt - Date.now()) / 1000)), path: '/', httpOnly: true, secure: secureCookie, sameSite: 'Lax' }));
      res.writeHead(302, { Location: result.returnTo, 'Cache-Control': 'no-store' });
      return res.end();
    } catch (error) {
      appendSetCookie(res, cookie('fiberos_oidc_state', '', { maxAge: 0, path: '/auth/oidc/callback', httpOnly: true, secure: secureCookie, sameSite: 'Lax' }));
      return send(res, error.status || 401, { ok: false, error: error.code || 'OIDC_CALLBACK_FAILED' });
    }
  }

  if (path === '/auth/oidc/session' && method === 'GET') {
    try {
      const session = await oidcServer.getSession(parseCookies(req).fiberos_sid);
      if (!session) return send(res, 401, { ok: false, authenticated: false });
      return send(res, 200, { ok: true, authenticated: true, principal: { sub: session.sub, email: session.email, role: session.role }, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
    } catch (error) {
      return send(res, 503, { ok: false, error: error.code || 'SESSION_STORE_UNAVAILABLE' });
    }
  }

  if (path === '/auth/oidc/logout' && method === 'POST') {
    if (!originAllowed(req, env)) return send(res, 403, { ok: false, error: 'CSRF_ORIGIN_REJECTED' });
    try {
      const sessionId = parseCookies(req).fiberos_sid;
      const session = await oidcServer.getSession(sessionId);
      if (session && String(req.headers['x-fiberos-csrf'] || '') !== String(session.csrfToken)) return send(res, 403, { ok: false, error: 'CSRF_TOKEN_REQUIRED' });
      await oidcServer.logout(sessionId);
      appendSetCookie(res, cookie('fiberos_sid', '', { maxAge: 0, path: '/', httpOnly: true, secure: secureCookie, sameSite: 'Lax' }));
      return send(res, 200, { ok: true, authenticated: false });
    } catch (error) {
      return send(res, 503, { ok: false, error: error.code || 'LOGOUT_FAILED' });
    }
  }

  return null;
}

module.exports = { handleOidcRoute };
