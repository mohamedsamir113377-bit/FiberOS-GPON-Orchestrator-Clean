'use strict';

const fs = require('fs');
const path = require('path');
const { canClaimProductionReady } = require('../../../packages/core/src/productionHold');

function loadCanonicalRlsInventory() {
  const file = path.join(__dirname, '../../../config/rls-tenant-sensitive-inventory.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc || doc.schema !== 'fiberos.r14.1.rls-tenant-sensitive-inventory.v1' || !Array.isArray(doc.tables) || !Number.isInteger(doc.tableCount) || doc.tableCount !== doc.tables.length) {
    throw new Error('CANONICAL_RLS_INVENTORY_INVALID');
  }
  const names = doc.tables.map(x => x && x.table).filter(Boolean);
  if (names.length !== new Set(names).size || names.some(n => !/^[a-z_][a-z0-9_]*$/.test(n))) {
    throw new Error('CANONICAL_RLS_INVENTORY_INVALID_TABLE_NAMES');
  }
  return Object.freeze(names.slice().sort());
}

const REQUIRED_RLS_TABLES = loadCanonicalRlsInventory();

function blocked(reason, checks) {
  return {
    status: 'BLOCKED_PRECONDITION',
    runtimeVerified: false,
    databaseReady: false,
    productionReady: false,
    reason: String(reason || 'RUNTIME_PRECONDITION_FAILED'),
    checks: checks || []
  };
}

async function verifyRuntimeGate(db) {
  const checks = [];
  if (!db || !db.configured || !db.pool) {
    return blocked(db && db.reason ? db.reason : 'DATABASE_NOT_CONFIGURED', checks);
  }

  let client;
  try {
    client = await db.pool.connect();

    await client.query('SELECT 1');
    checks.push({ name: 'database_select_1', status: 'PASS' });

    const server = await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             current_setting('server_version_num')::int AS server_version_num,
             current_setting('server_version') AS server_version
    `);
    const serverVersionNum = Number(server.rows[0].server_version_num);
    const major = Math.floor(serverVersionNum / 10000);
    const minimumSecurityBaseline = 180006;
    if (major !== 18) {
      return blocked('POSTGRESQL_18_REQUIRED', checks.concat([{
        name: 'postgresql_major',
        status: 'FAIL',
        observed: major,
        requiredMajor: 18
      }]));
    }
    checks.push({
      name: 'postgresql_major',
      status: 'PASS',
      observed: major
    });
    if (serverVersionNum < minimumSecurityBaseline) {
      return blocked('POSTGRESQL_18_6_REQUIRED', checks.concat([{
        name: 'postgresql_security_baseline',
        status: 'FAIL',
        observed: server.rows[0].server_version,
        observedVersionNum: serverVersionNum,
        minimumVersion: '18.6'
      }]));
    }
    checks.push({
      name: 'postgresql_security_baseline',
      status: 'PASS',
      observed: server.rows[0].server_version,
      observedVersionNum: serverVersionNum,
      minimumVersion: '18.6'
    });

    const postgis = await client.query(`
      SELECT postgis_lib_version() AS lib_version,
             postgis_full_version() AS full_version
    `);
    const postgisVersion = String(postgis.rows[0].lib_version || '');
    if (!/^3\.6\./.test(postgisVersion)) {
      return blocked('POSTGIS_3_6_REQUIRED', checks.concat([{
        name: 'postgis_version',
        status: 'FAIL',
        observed: postgisVersion,
        fullVersion: postgis.rows[0].full_version
      }]));
    }
    checks.push({
      name: 'postgis_version',
      status: 'PASS',
      observed: postgisVersion,
      fullVersion: postgis.rows[0].full_version
    });

    const rls = await client.query(`
      SELECT c.relname,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS force_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
    `, [REQUIRED_RLS_TABLES]);

    const observed = new Map(rls.rows.map(function (row) {
      return [row.relname, row];
    }));
    const missing = REQUIRED_RLS_TABLES.filter(function (name) {
      const row = observed.get(name);
      return !row || !row.rls_enabled || !row.force_rls;
    });
    const unexpected = rls.rows.map(r => r.relname).filter(name => !REQUIRED_RLS_TABLES.includes(name));
    if (missing.length) {
      return blocked('RLS_FORCE_RUNTIME_VERIFICATION_FAILED', checks.concat([{
        name: 'required_rls_force',
        status: 'FAIL',
        missing
      }]));
    }
    checks.push({ name: 'required_rls_force', status: 'PASS', tables: REQUIRED_RLS_TABLES.slice(), canonicalInventory: 'config/rls-tenant-sensitive-inventory.json', tableCount: REQUIRED_RLS_TABLES.length, unexpected: unexpected.length ? unexpected : [] });

    const migration057 = await client.query(`
      SELECT to_regclass('public.payment_cycles') IS NOT NULL AS payment_cycles_present,
             to_regclass('public.payment_cycle_events') IS NOT NULL AS payment_events_present,
             to_regclass('public.rework_cases') IS NOT NULL AS rework_cases_present,
             to_regclass('public.rework_case_events') IS NOT NULL AS rework_events_present,
             to_regprocedure('public.fiberos_start_payment_cycle(uuid,text)') IS NOT NULL AS start_payment_function,
             to_regprocedure('public.fiberos_transition_payment_cycle(uuid,text,text,text)') IS NOT NULL AS transition_function
    `);
    const m = migration057.rows[0];
    if (!m.payment_cycles_present || !m.payment_events_present ||
        !m.rework_cases_present || !m.rework_events_present ||
        !m.start_payment_function || !m.transition_function) {
      return blocked('MIGRATION_057_RUNTIME_VERIFICATION_FAILED', checks.concat([{
        name: 'migration_057',
        status: 'FAIL',
        observed: m
      }]));
    }
    checks.push({ name: 'migration_057', status: 'PASS' });

    const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const hold = canClaimProductionReady(process.env);
    if (production && !hold.ok) {
      return blocked(hold.reason || 'PRODUCTION_HOLD_ACTIVE', checks.concat([{
        name: 'production_hold',
        status: 'BLOCKED',
        productionHold: true,
        required: hold.required || hold.missing || undefined
      }]));
    }

    return {
      status: 'VERIFIED_RUNTIME',
      runtimeVerified: true,
      databaseReady: true,
      productionReady: production && hold.ok,
      productionHold: production ? !hold.ok : true,
      reason: production
        ? 'PRODUCTION_RUNTIME_VERIFIED_WITH_BUYER_ATTESTATION'
        : 'DATABASE_RUNTIME_VERIFIED_PRODUCTION_HOLD_REMAINS_ACTIVE',
      checks,
      observed: {
        database: server.rows[0].database,
        role: server.rows[0].role,
        serverVersion: server.rows[0].server_version,
        postgisVersion: postgisVersion
      }
    };
  } catch (err) {
    return blocked(err && err.code ? String(err.code) : (err && err.message ? String(err.message) : String(err)), checks);
  } finally {
    if (client) client.release();
  }
}

module.exports = { REQUIRED_RLS_TABLES, verifyRuntimeGate };
