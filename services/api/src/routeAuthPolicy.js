'use strict';

/**
 * Central pre-runtime identity policy.
 *
 * A signed provider webhook is authenticated by its timestamped HMAC and
 * provider mapping inside the route handler, not by an end-user JWT. Keep
 * These exceptions are explicit and narrow; every other /v1 route is deny-by-default
 * before the database/runtime gate.
 */
function requiresAuthBeforeRuntime(path, method) {
  const p = String(path || '/');
  const m = String(method || 'GET').toUpperCase();
  if (p === '/health' || p === '/v1/meta' || p === '/v1/lifecycle/self-test') return false;
  if (m === 'POST' && p === '/v1/call-center/ivr/inbound') return false;
  if (m === 'GET' && p.startsWith('/v1/public/installations/tracking/')) return false;
  if (m === 'GET' && p.startsWith('/v1/public/faults/tracking/')) return false;
  if (p === '/v1/adapters') return true;
  if (p === '/v1/contact-center/runtime/status') return true;
  return p.startsWith('/v1/');
}

module.exports = { requiresAuthBeforeRuntime };