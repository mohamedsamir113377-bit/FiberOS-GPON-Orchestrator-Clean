(function attachSessionAuth(root) {
  'use strict';
  let session = null;
  let csrfToken = '';

  function apiBase() {
    try {
      const configured = (() => { try { return root.localStorage.getItem('fiberos_api'); } catch (_) { return ''; } })() || root.location.origin;
      return root.FiberOSApiOrigin.normalizeApiBase(configured, root.location.href, root.__FIBEROS_ALLOWED_API_ORIGINS__ || []);
    } catch (_) { return root.location.origin; }
  }
  function authUrl(path) {
    return root.FiberOSApiOrigin.resolveAuthUrl(apiBase(), path);
  }
  function updateStatus(message) {
    const status = root.document && root.document.getElementById('sessionAuthStatus');
    if (!status) return;
    status.textContent = message || (session ? `Signed in: ${session.email || session.sub}` : 'Not signed in.');
    status.dataset.connected = session ? 'true' : 'false';
  }
  async function refresh() {
    try {
      const response = await root.fetch(authUrl('/auth/oidc/session'), { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) { session = null; csrfToken = ''; updateStatus(); return { ok: false, authenticated: false }; }
      const body = await response.json();
      session = body && body.authenticated ? body.principal || null : null;
      csrfToken = body && body.authenticated ? String(body.csrfToken || '') : '';
      updateStatus();
      return { ok: true, authenticated: Boolean(session) };
    } catch (_) {
      session = null; csrfToken = ''; updateStatus('Authentication service is unavailable.');
      return { ok: false, authenticated: false };
    }
  }
  function login(returnTo) { root.location.assign(authUrl('/auth/oidc/login') + `?returnTo=${encodeURIComponent(returnTo || root.location.pathname || '/')}`); }
  async function logout() {
    const response = await root.fetch(authUrl('/auth/oidc/logout'), { method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json', 'X-FiberOS-CSRF': csrfToken } });
    if (!response.ok) throw new Error(`LOGOUT_HTTP_${response.status}`);
    session = null; csrfToken = ''; updateStatus();
  }
  function getSession() { return session; }
  function getCsrfToken() { return csrfToken; }

  root.FiberOSSessionAuth = Object.freeze({ refresh, login, logout, getSession, getCsrfToken });
  if (root.document) {
    root.document.addEventListener('click', (event) => {
      const button = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-session-action]') : null;
      if (!button) return;
      const action = button.dataset.sessionAction;
      if (action === 'login') login(root.location.pathname);
      else if (action === 'logout') logout().catch(() => updateStatus('Logout failed.'));
    });
    refresh().catch(() => {});
  }
})(window);
