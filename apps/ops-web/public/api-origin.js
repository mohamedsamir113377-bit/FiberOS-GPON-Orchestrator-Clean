(function attachApiOrigin(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FiberOSApiOrigin = api;
})(typeof window === 'undefined' ? globalThis : window, function createApiOriginPolicy() {
  'use strict';

  const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

  function normalizeApiBase(candidate, pageHref, allowedOrigins = []) {
    const page = new URL(pageHref);
    const url = new URL(candidate || page.origin, page.origin);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      throw Object.assign(new Error('API_BASE_INVALID'), { code: 'API_BASE_INVALID' });
    }

    const localPage = page.protocol === 'http:' && LOOPBACK.has(page.hostname);
    if (url.origin === page.origin && (url.protocol === 'https:' || localPage)) return url.origin;

    const localDev = page.protocol === 'http:' && page.hostname === 'localhost' && page.port === '8088'
      && url.origin === 'http://127.0.0.1:8080';
    if (localDev) return url.origin;

    if (url.protocol === 'https:' && Array.isArray(allowedOrigins) && allowedOrigins.includes(url.origin)) {
      return url.origin;
    }
    throw Object.assign(new Error('API_ORIGIN_NOT_ALLOWED'), { code: 'API_ORIGIN_NOT_ALLOWED' });
  }

  function resolveAuthUrl(apiBase, authPath) {
    const base = new URL(apiBase);
    if (base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) {
      throw Object.assign(new Error('API_BASE_INVALID'), { code: 'API_BASE_INVALID' });
    }
    if (typeof authPath !== 'string' || !authPath.startsWith('/auth/oidc/') || authPath.includes('\\') || authPath.includes('#')) {
      throw Object.assign(new Error('AUTH_PATH_INVALID'), { code: 'AUTH_PATH_INVALID' });
    }
    const url = new URL(authPath, base.origin);
    if (url.origin !== base.origin || !url.pathname.startsWith('/auth/oidc/')) {
      throw Object.assign(new Error('AUTH_PATH_INVALID'), { code: 'AUTH_PATH_INVALID' });
    }
    return url.href;
  }

  function resolveApiUrl(apiBase, apiPath) {
    const base = new URL(apiBase);
    if (base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) {
      throw Object.assign(new Error('API_BASE_INVALID'), { code: 'API_BASE_INVALID' });
    }
    if (typeof apiPath !== 'string' || !(/^\/v1\//.test(apiPath) || apiPath === '/health')
      || apiPath.startsWith('//') || apiPath.includes('\\') || apiPath.includes('?') || apiPath.includes('#')) {
      throw Object.assign(new Error('API_PATH_INVALID'), { code: 'API_PATH_INVALID' });
    }
    let decoded;
    try { decoded = decodeURIComponent(apiPath); }
    catch (_) { throw Object.assign(new Error('API_PATH_INVALID'), { code: 'API_PATH_INVALID' }); }
    if (decoded.split('/').some(part => part === '.' || part === '..')) {
      throw Object.assign(new Error('API_PATH_INVALID'), { code: 'API_PATH_INVALID' });
    }
    const url = new URL(apiPath, base.origin);
    if (url.origin !== base.origin || !(/^\/v1\//.test(url.pathname) || url.pathname === '/health')) {
      throw Object.assign(new Error('API_PATH_INVALID'), { code: 'API_PATH_INVALID' });
    }
    return url.href;
  }

  return Object.freeze({ normalizeApiBase, resolveApiUrl, resolveAuthUrl });
});
