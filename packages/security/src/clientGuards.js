/**
 * Client guards — defensive UX only. Server RLS is the authority.
 */
'use strict';

function isPlaceholderUrl(url) {
  const u = String(url || '');
  return !u || /YOUR_PROJECT|YOUR_SUPABASE|localhost\/?$/i.test(u) || !/^https:\/\//i.test(u);
}

function isPlaceholderKey(key) {
  const k = String(key || '');
  return !k || k.length < 20 || /REPLACE|YOUR_|ANON_KEY|example/i.test(k);
}

function isCloudConfigured(cfg) {
  cfg = cfg || {};
  return !isPlaceholderUrl(cfg.supabaseUrl) && !isPlaceholderKey(cfg.supabaseAnonKey);
}

/** UI role from localStorage must never be treated as trusted */
function readUiRole() {
  try {
    return localStorage.getItem('fiberos_role') || localStorage.getItem('userRole') || null;
  } catch (e) {
    return null;
  }
}

function trustedRoleFromSession(session) {
  if (!session || !session.user) return null;
  const meta = session.user.app_metadata || {};
  return meta.role || null;
}

function assertNoClientElevation(session) {
  const ui = readUiRole();
  const trusted = trustedRoleFromSession(session);
  if (ui && ui !== trusted && /sysadmin|ops_manager/i.test(String(ui))) {
    return {
      ok: false,
      reason: 'UI_ROLE_NOT_TRUSTED',
      uiRole: ui,
      trustedRole: trusted
    };
  }
  return { ok: true, trustedRole: trusted, uiRole: ui };
}

module.exports = {
  isPlaceholderUrl,
  isPlaceholderKey,
  isCloudConfigured,
  readUiRole,
  trustedRoleFromSession,
  assertNoClientElevation
};

if (typeof window !== 'undefined') {
  window.FiberOSSecurity = window.FiberOSSecurity || {};
  Object.assign(window.FiberOSSecurity, {
    isPlaceholderUrl,
    isPlaceholderKey,
    isCloudConfigured,
    readUiRole,
    trustedRoleFromSession,
    assertNoClientElevation
  });
}
