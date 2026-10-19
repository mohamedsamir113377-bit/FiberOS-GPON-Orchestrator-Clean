#!/usr/bin/env node
'use strict';

/**
 * Adversarial release gate — live DB required for PASS.
 * Without DATABASE_URL: exit 2 (no live proof). Never claims Production Ready.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const url = String(process.env.DATABASE_URL || '').trim();

function section(title) {
  console.log('\n== ' + title + ' ==');
}

if (!url) {
  section('NO LIVE DATABASE');
  console.log(JSON.stringify({
    schema: 'fiberos.adversarial-release-gate.v1',
    status: 'NO_LIVE_PROOF',
    productionReadyClaim: false,
    reason: 'DATABASE_URL not set',
    next: 'Provision PostgreSQL+PostGIS, set DATABASE_URL, re-run this script',
  }, null, 2));
  process.exit(2);
}

async function main() {
  let pg;
  try {
    pg = require('pg');
  } catch (_) {
    console.error('pg driver not installed in this workspace; run from an environment with pg and DATABASE_URL');
    process.exit(2);
  }

  const { Client } = pg;
  const client = new Client({ connectionString: url });
  const report = {
    schema: 'fiberos.adversarial-release-gate.v1',
    productionReadyClaim: false,
    checks: [],
  };

  function pass(id, detail) {
    report.checks.push({ id, ok: true, detail });
    console.log('PASS', id, detail || '');
  }
  function fail(id, detail) {
    report.checks.push({ id, ok: false, detail });
    console.error('FAIL', id, detail || '');
  }

  try {
    await client.connect();
    pass('db.connect', 'connected');

    const postgis = await client.query("SELECT extname FROM pg_extension WHERE extname = 'postgis'");
    if (postgis.rowCount) pass('postgis', 'extension present');
    else fail('postgis', 'postgis extension missing');

    const migrationsDir = path.join(ROOT, 'sql/migrations');
    const migrations = fs.readdirSync(migrationsDir)
      .filter(f => /^\d{3}_.+\.sql$/.test(f) && f !== '000_local_auth_stubs.sql')
      .sort();
    const migFile = path.join(migrationsDir, 'PRODUCTION_MIGRATIONS.txt');
    const listed = fs.readFileSync(migFile, 'utf8').trim().split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const migrationTip = migrations.at(-1) || '';
    const migrationTipNum = Number(migrationTip.slice(0, 3));
    const chainAligned =
      listed.length === migrations.length &&
      listed.every((name, i) => name === migrations[i]) &&
      Number.isFinite(migrationTipNum) &&
      migrationTipNum === migrations.length &&
      listed.at(-1) === migrationTip;
    if (chainAligned) {
      pass('migration.list.tip', 'PRODUCTION_MIGRATIONS.txt and SQL chain align at ' + migrationTip);
    } else {
      fail('migration.list.tip', JSON.stringify({
        listedCount: listed.length,
        fileCount: migrations.length,
        listedTip: listed.at(-1),
        fileTip: migrationTip
      }));
    }

    // Presence of installation tables (after migrations applied by operator)
    const tables = await client.query(`
      SELECT relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND relname IN ('installation_jobs','installation_evidence','installation_events')
    `);
    const names = new Set(tables.rows.map((r) => r.relname));
    if (names.size === 3) pass('installation.tables', 'present');
    else fail('installation.tables', 'missing ' + ['installation_jobs','installation_evidence','installation_events'].filter((x) => !names.has(x)).join(','));

    // RLS enabled + forced on installation_jobs if table exists
    if (names.has('installation_jobs')) {
      const rls = await client.query(`
        SELECT c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'installation_jobs'
      `);
      const row = rls.rows[0];
      if (row && row.relrowsecurity && row.relforcerowsecurity) {
        pass('installation_jobs.force_rls', 'ENABLE+FORCE RLS');
      } else {
        fail('installation_jobs.force_rls', JSON.stringify(row || {}));
      }
    }

    // Public tracking policy name (best-effort)
    if (names.has('installation_jobs')) {
      const pol = await client.query(`
        SELECT polname FROM pg_policy
        WHERE polrelid = 'public.installation_jobs'::regclass
          AND polname = 'installation_jobs_public_tracking_select'
      `);
      if (pol.rowCount) pass('installation.public_tracking_policy', 'present');
      else fail('installation.public_tracking_policy', 'missing policy installation_jobs_public_tracking_select');
    }

    section('NOTE');
    console.log('Cross-tenant INSERT/SELECT probes require seeded tenants + JWT/DB principals.');
    console.log('Extend this gate with your lab seed; do not mark Production Ready on schema presence alone.');

  } catch (err) {
    fail('db.runtime', String(err && err.message ? err.message : err));
  } finally {
    try { await client.end(); } catch (_) {}
  }

  const failed = report.checks.filter((c) => !c.ok).length;
  report.status = failed ? 'LIVE_CHECKS_FAILED' : 'LIVE_SCHEMA_GATES_PASSED';
  report.failed = failed;
  console.log('\n' + JSON.stringify(report, null, 2));
  process.exit(failed ? 1 : 0);
}

main();
