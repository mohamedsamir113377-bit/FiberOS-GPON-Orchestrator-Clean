'use strict';
const { getRequestPrincipal, getRequestPrincipalAsync, parseBearer, verifyBearerToken, verifyBearerTokenAsync } = require('../../../packages/security/src/jwt');

/**
 * REAL BUG FIXED HERE (found during review, not before):
 * server.js calls `getRequestPrincipal(req, cfg)` passing the object from
 * `loadServerConfig()`, clearly intending JWT verification to use it. This
 * wrapper silently discarded that argument and used `process.env` instead —
 * and `loadServerConfig()` doesn't even expose JWT_SECRET/JWT_VERIFY (they're
 * camelCase-normalized elsewhere, not raw env var names), so `packages/security/src/jwt.js`
 * — which expects raw `env.JWT_SECRET` / `env.SUPABASE_JWT_SECRET` / `env.JWT_VERIFY`
 * keys — could never have worked correctly if fed that cfg object as-is.
 * It happened to work only because the bug (ignoring cfg) accidentally
 * cancelled out the mismatch. The moment someone "fixed" this wrapper to
 * actually use the passed cfg, auth would have silently broken.
 * Fix: stop pretending a second parameter is used. Call sites must pass
 * process.env explicitly (or another raw-env-shaped object for tests) —
 * never a normalized config object with different key names.
 *
 * H-3 hardening: relying on every future call site to "remember" to pass
 * process.env is exactly the kind of silent-convention dependency that
 * created this bug in the first place. assertRawEnvShape() below makes the
 * mistake impossible instead of merely documented: loadServerConfig()
 * (packages/core/src/config.js) always returns an Object.freeze()'d object
 * with camelCase keys (nodeEnv, apiPort, ...) and never the raw
 * NODE_ENV/JWT_SECRET keys jwt.js actually reads. If anyone passes that cfg
 * object here again, this throws immediately at startup/request time
 * instead of silently degrading into LAB_AUTH_MODE_FORBIDDEN or an
 * unverified principal.
 */
function assertRawEnvShape(env) {
  if (!env) return;
  const looksNormalized = Object.isFrozen(env) && env.nodeEnv !== undefined && env.NODE_ENV === undefined;
  if (looksNormalized) {
    throw new Error(
      'AUTH_ENV_SHAPE_MISMATCH: received a normalized config object (from loadServerConfig()) ' +
      'where a raw environment object (process.env-shaped, with JWT_SECRET/NODE_ENV/JWT_VERIFY keys) ' +
      'was required. Pass process.env explicitly at the call site.'
    );
  }
}

module.exports = {
  parseBearer: parseBearer,
  getRequestPrincipal: function (req, env) {
    assertRawEnvShape(env);
    return getRequestPrincipal(req, env || process.env);
  },
  verifyBearerToken: function (token, env) {
    assertRawEnvShape(env);
    return verifyBearerToken(token, env || process.env);
  },
  verifyBearerTokenAsync: function (token, env) {
    assertRawEnvShape(env);
    return verifyBearerTokenAsync(token, env || process.env);
  },
  getRequestPrincipalAsync: function (req, env) {
    assertRawEnvShape(env);
    return getRequestPrincipalAsync(req, env || process.env);
  }
};
