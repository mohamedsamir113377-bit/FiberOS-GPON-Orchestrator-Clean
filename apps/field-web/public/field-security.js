'use strict';
(function attachFieldSecurity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FiberOSFieldSecurity = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFieldSecurity() {
  'use strict';

  function isLoopback(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || host.startsWith('127.');
  }

  function parseAllowedOrigin(value) {
    let url;
    try { url = new URL(String(value)); } catch (_) { throw new Error('FIELD_API_ORIGIN_INVALID'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' && !isLoopback(url.hostname))) {
      throw new Error('FIELD_API_ORIGIN_INVALID');
    }
    return url.origin;
  }

  function normalizeApiBase(input, pageHref, allowedOrigins) {
    let page;
    try { page = new URL(String(pageHref)); } catch (_) { throw new Error('FIELD_PAGE_ORIGIN_INVALID'); }
    const raw = String(input || '').trim();
    let target;
    try { target = new URL(raw || page.origin, page.origin); } catch (_) { throw new Error('FIELD_API_BASE_INVALID'); }
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) {
      throw new Error('FIELD_API_BASE_INVALID');
    }
    if (target.protocol !== 'https:' && !(isLoopback(target.hostname) && isLoopback(page.hostname))) {
      throw new Error('FIELD_API_HTTPS_REQUIRED');
    }
    const allowed = new Set([page.origin]);
    for (const origin of allowedOrigins || []) allowed.add(parseAllowedOrigin(origin));
    if (!allowed.has(target.origin)) throw new Error('FIELD_API_ORIGIN_NOT_ALLOWED');
    return target.origin + target.pathname.replace(/\/+$/, '');
  }

  function resolveApiUrl(base, path, pageHref, allowedOrigins) {
    const normalizedBase = normalizeApiBase(base, pageHref, allowedOrigins);
    const endpointPath = String(path || '');
    if (!/^\/v1\/[A-Za-z0-9/_-]+$/.test(endpointPath) || endpointPath.includes('//') || endpointPath.split('/').includes('..')) {
      throw new Error('FIELD_API_PATH_INVALID');
    }
    const baseUrl = new URL(normalizedBase);
    const url = new URL(baseUrl.pathname.replace(/\/+$/, '') + endpointPath, baseUrl.origin);
    if (url.origin !== baseUrl.origin) throw new Error('FIELD_API_ORIGIN_NOT_ALLOWED');
    return url.href;
  }

  return Object.freeze({ isLoopback, parseAllowedOrigin, normalizeApiBase, resolveApiUrl });
}));
