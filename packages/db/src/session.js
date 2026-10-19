/**
 * Apply JWT principal to a Postgres client for RLS (local/supabase-compatible claims).
 */
'use strict';

const { error: logError } = require('../../observability/src/logger');

async function applyPrincipal(client, principal) {
  principal = principal || {};
  const sub = principal.sub || '';
  const appRole = principal.role || '';
  const tenantId = principal.tenant_id || '';
  const claims = JSON.stringify({
    sub: sub || null,
    role: 'authenticated',
    app_metadata: { role: appRole || null, tenant_id: tenantId || null }
  });
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
  // Supabase-compatible role claim is the database session role, not the application role.
  // Application authorization belongs in app_metadata.role; auth.role() must remain 'authenticated'.
  await client.query(`select set_config('request.jwt.claim.role', $1, true)`, ['authenticated']);
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
  // ECL tenant context: migration 188 RLS reads app.tenant_id. Install it from the
  // authenticated principal so ECL rows are isolated per tenant. Empty value fails closed.
  await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
  /* Production authorization MUST execute as the constrained app role.
   * Failing open to a superuser/session role would bypass the very RLS
   * boundary this function is responsible for installing. */
  try {
    await client.query(`set local role fiberos_app`);
  } catch (e) {
    const err = new Error('FIBEROS_APP_ROLE_REQUIRED');
    err.code = 'FIBEROS_APP_ROLE_REQUIRED';
    err.statusCode = 503;
    throw err;
  }
}

/**
 * Run fn(client) inside a transaction with principal applied.
 */
async function withPrincipal(db, principal, fn) {
  if (!db || !db.configured || !db.pool) {
    throw new Error(db && db.reason ? db.reason : 'DB_NOT_CONFIGURED');
  }
  const client = await db.pool.connect();
  try {
    await client.query('begin');
    await applyPrincipal(client, principal);
    const statementTimeoutMs = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15000);
    const lockTimeoutMs = Number(process.env.PG_LOCK_TIMEOUT_MS || 5000);
    const idleInTransactionTimeoutMs = Number(process.env.PG_IDLE_IN_TRANSACTION_TIMEOUT_MS || 60000);
    if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs <= 0 ||
        !Number.isInteger(lockTimeoutMs) || lockTimeoutMs <= 0 ||
        !Number.isInteger(idleInTransactionTimeoutMs) || idleInTransactionTimeoutMs <= 0) {
      throw Object.assign(new Error('PG_TIMEOUT_CONFIGURATION_INVALID'), { code: 'PG_TIMEOUT_CONFIGURATION_INVALID' });
    }
    await client.query(`select set_config('statement_timeout',$1,true), set_config('lock_timeout',$2,true), set_config('idle_in_transaction_session_timeout',$3,true)`,
      [String(statementTimeoutMs), String(lockTimeoutMs), String(idleInTransactionTimeoutMs)]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch (e2) {
      // M-7 fix (2026-09-17): a failed rollback was previously silent, so a
      // connection could be released back to the pool in an unknown
      // transaction state with zero trace of why. Log it (without masking
      // the original error `e`, which is what actually gets rethrown).
      logError('db_rollback_failed', { error: String(e2 && e2.message || e2) });
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { applyPrincipal, withPrincipal };
