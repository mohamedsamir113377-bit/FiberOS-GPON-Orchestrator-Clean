#!/usr/bin/env node
'use strict';
/**
 * Production migrations require MIGRATOR_DATABASE_URL and execute under
 * fiberos_owner through an explicit SET ROLE on a single migration session.
 * Local/dev may use DATABASE_URL and may opt into the local auth stub.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createPool } = require('../packages/db/src/index');
const { resolveDatabaseUrl } = require('../packages/db/src/databaseUrl');

function resolveMigrationUrl(env, production) {
  const primaryName = production ? 'MIGRATOR_DATABASE_URL' : 'DATABASE_URL';
  const primary = resolveDatabaseUrl(env, primaryName);
  if (primary.configured) return primary.url;
  if (!production) {
    const service = resolveDatabaseUrl(env, 'DATABASE_SERVICE_URL');
    if (service.configured) return service.url;
  }
  return '';
}

async function main() {
  const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  let migratorUrl = '';
  try { migratorUrl = resolveMigrationUrl(process.env, production); }
  catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.code || 'MIGRATOR_DATABASE_URL_INVALID' }));
    process.exitCode = 1;
    return;
  }
  const db = createPool(Object.assign({}, process.env, { DATABASE_URL: migratorUrl }));
  if (!db.configured) {
    console.error(JSON.stringify({ ok: false, error: db.reason || 'DB_NOT_CONFIGURED' }));
    process.exitCode = 1;
    return;
  }

  const dir = path.join(__dirname, '..', 'sql', 'migrations');
  const manifest = path.join(dir, 'PRODUCTION_MIGRATIONS.txt');
  const localStubs = String(process.env.FIBEROS_APPLY_LOCAL_AUTH_STUBS || '').toLowerCase() === 'true';
  let files;
  let checksums = new Map();
  if (production) {
    if (!fs.existsSync(manifest)) throw new Error('PRODUCTION_MIGRATION_MANIFEST_MISSING');
    const checksumFile = path.join(dir, 'PRODUCTION_MIGRATIONS.sha256');
    if (!fs.existsSync(checksumFile)) throw new Error('PRODUCTION_MIGRATION_CHECKSUM_MANIFEST_MISSING');
    // Extension ledger: migrations 117+ are covered by the append-only extension
    // checksum ledger; the legacy ledger only covers 001-116. Both are required,
    // and both are verified byte-for-byte before any migration executes.
    const extensionChecksumFile = path.join(dir, 'PRODUCTION_MIGRATIONS.extra.sha256');
    if (!fs.existsSync(extensionChecksumFile)) throw new Error('PRODUCTION_MIGRATION_EXTENSION_CHECKSUM_MANIFEST_MISSING');
    const EXTENSION_CHECKSUM_LEDGER = extensionChecksumFile;
    files = fs.readFileSync(manifest, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
    if (files.includes('000_local_auth_stubs.sql')) throw new Error('LOCAL_AUTH_STUB_FORBIDDEN');
    const checksumLines = fs.readFileSync(checksumFile, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    for (const line of checksumLines) {
      const m = /^([a-f0-9]{64})\s+(\S+)$/.exec(line);
      if (!m) throw new Error('INVALID_MIGRATION_CHECKSUM_LINE:' + line);
      if (m[2] === '000_local_auth_stubs.sql') throw new Error('LOCAL_AUTH_CHECKSUM_FORBIDDEN');
      checksums.set(m[2], m[1]);
    }
    const extensionChecksumLines = fs.readFileSync(EXTENSION_CHECKSUM_LEDGER, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    for (const line of extensionChecksumLines) {
      const m = /^([a-f0-9]{64})\s+(\S+)$/.exec(line);
      if (!m) throw new Error('INVALID_MIGRATION_EXTENSION_CHECKSUM_LINE:' + line);
      checksums.set(m[2], m[1]);
    }
    const actualSql = fs.readdirSync(dir).filter(f => /^\d{3}_.+\.sql$/.test(f) && f !== '000_local_auth_stubs.sql').sort();
    const unexpected = actualSql.filter(f => !files.includes(f));
    const missing = files.filter(f => !actualSql.includes(f));
    if (unexpected.length) throw new Error('UNEXPECTED_UNLISTED_MIGRATIONS:' + unexpected.join(','));
    if (missing.length) throw new Error('MANIFEST_MIGRATION_MISSING:' + missing.join(','));
    const missingHashes = files.filter(f => !checksums.has(f));
    const extraHashes = [...checksums.keys()].filter(f => !files.includes(f));
    if (missingHashes.length) throw new Error('MIGRATION_CHECKSUM_MISSING:' + missingHashes.join(','));
    if (extraHashes.length) throw new Error('MIGRATION_CHECKSUM_UNEXPECTED:' + extraHashes.join(','));
  } else {
    files = fs.readdirSync(dir).filter(function (f) {
      return f.endsWith('.sql') && (f !== '000_local_auth_stubs.sql' || localStubs);
    }).sort();
  }

  const client = await db.pool.connect();
  try {
    if (production) {
      await client.query('set role fiberos_owner');
      const role = await client.query("select current_user as current_user, session_user as session_user");
      if (role.rows[0].current_user !== 'fiberos_owner' || role.rows[0].session_user === 'fiberos_owner') {
        throw new Error('MIGRATOR_OWNER_ROLE_REQUIRED');
      }
    }
    if (production) {
      await client.query(`
        create table if not exists public.fiberos_migration_history (
          migration_name text primary key,
          sha256 text not null,
          applied_at timestamptz not null default now()
        )
      `);
      await client.query('revoke all on public.fiberos_migration_history from public, fiberos_runtime, fiberos_worker, fiberos_app');
      await client.query('grant select on public.fiberos_migration_history to fiberos_migrator');
    }

    console.log(JSON.stringify({
      applying: files.length,
      mode: production ? 'PRODUCTION_MANIFEST' : 'NON_PRODUCTION',
      migrationCredential: production ? 'MIGRATOR_DATABASE_URL' : 'DATABASE_URL_OR_SERVICE',
      executionRole: production ? 'fiberos_owner' : 'DATABASE_URL_ROLE',
      history: production ? 'ENABLED' : 'DISABLED'
    }));

    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      if (production) {
        const digest = crypto.createHash('sha256').update(sql).digest('hex');
        if (digest !== checksums.get(f)) throw new Error('MIGRATION_CHECKSUM_MISMATCH:' + f);
        const prior = await client.query('select sha256 from public.fiberos_migration_history where migration_name=$1', [f]);
        if (prior.rowCount) {
          if (prior.rows[0].sha256 !== digest) throw new Error('APPLIED_MIGRATION_MODIFIED:' + f);
          console.log('→ ' + f + ' ... SKIP_ALREADY_APPLIED');
          continue;
        }
      }
      if (f === '001_extensions.sql') {
        const ext = await client.query("select extname from pg_extension where extname in ('postgis','pgcrypto') order by extname");
        const installed = new Set(ext.rows.map(function (row) { return row.extname; }));
        if (installed.has('postgis') && installed.has('pgcrypto')) {
          console.log('→ ' + f + ' ... SKIP_ALREADY_BOOTSTRAPPED_EXTENSIONS');
          if (production) {
            const digest = checksums.get(f);
            const prior = await client.query('select sha256 from public.fiberos_migration_history where migration_name=$1', [f]);
            if (!prior.rowCount) {
              await client.query('insert into public.fiberos_migration_history(migration_name,sha256) values($1,$2)', [f, digest]);
            } else if (prior.rows[0].sha256 !== digest) {
              throw new Error('APPLIED_MIGRATION_MODIFIED:' + f);
            }
          }
          continue;
        }
      }
      process.stdout.write('→ ' + f + ' ... ');
      try {
        await client.query(sql);
        if (production) {
          const digest = checksums.get(f);
          await client.query('insert into public.fiberos_migration_history(migration_name,sha256) values($1,$2)', [f, digest]);
        }
        console.log('OK');
      } catch (e) {
        console.log('FAIL');
        console.error(String(e.message || e));
        process.exitCode = 1;
        return;
      }
    }
    console.log(JSON.stringify({ ok: true, applied: files.length, executionRole: production ? 'fiberos_owner' : 'DATABASE_URL_ROLE', history: production ? 'ENABLED' : 'DISABLED' }));
  } finally {
    client.release();
    await db.end();
  }
}

main().catch(e => {
  console.error(String(e && e.message || e));
  process.exitCode = 1;
});
