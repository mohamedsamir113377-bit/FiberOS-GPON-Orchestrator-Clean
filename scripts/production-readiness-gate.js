#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { createRedisRateLimitStore } = require('../packages/security/src/redisRateLimit');
const { resolveDatabaseUrl } = require('../packages/db/src');
const { verifySignedControlProof, getReleaseIdentity } = require('../packages/core/src/buyerRuntimeProof');

const CONTRACT = require('../config/runtime-environment-contract.v1.json');
const { KNOWN_CHECK_NAMES, isKnownCheckName, resolveRequiredChecks, validateCheckNames } = require('./readiness-check-registry');
const REQUIRED_PROOF_CHECKS = Object.freeze([
  'identityOidcJwks', 'tlsIngress', 'secretsBoundary', 'backupRestore',
  'rateLimitBoundary', 'externalAdapters'
]);

function result(name, ok, details) { return { name, status: ok ? 'PASS' : 'FAIL', ...details }; }
function versionAtLeast(actual, required) {
  const a = String(actual).replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const r = String(required).replace(/^>=\s*/, '').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, r.length); i += 1) {
    if ((a[i] || 0) !== (r[i] || 0)) return (a[i] || 0) > (r[i] || 0);
  }
  return true;
}
function postgresVersionNumber(version) {
  const match = String(version || '').trim().match(/^(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 0 || minor < 0) return null;
  return major >= 10 ? (major * 10000) + minor : (major * 10000) + minor;
}
function postgresVersionAtLeast(actualVersionNum, requiredVersion) {
  const actual = Number(actualVersionNum);
  const required = postgresVersionNumber(requiredVersion);
  return Number.isInteger(actual) && required !== null && actual >= required;
}
function normalizedHttpsOrigin(raw, errorCode) {
  let target;
  try { target = new URL(String(raw || '').trim()); } catch (_) {
    throw new Error(errorCode);
  }
  if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error(errorCode);
  }
  return target.origin.toLowerCase();
}
function validateTlsProbeTarget(probeUrl, expectedOrigin) {
  let target;
  try { target = new URL(String(probeUrl || '').trim()); } catch (_) {
    return { ok: false, error: 'FIBEROS_TLS_PROBE_URL_INVALID' };
  }
  if (target.protocol !== 'https:') return { ok: false, error: 'TLS_PROBE_MUST_USE_HTTPS' };
  if (target.username || target.password) return { ok: false, error: 'TLS_PROBE_CREDENTIALS_FORBIDDEN' };
  let expected;
  try { expected = normalizedHttpsOrigin(expectedOrigin, 'FIBEROS_TLS_EXPECTED_ORIGIN_INVALID'); } catch (error) {
    return { ok: false, error: error.message };
  }
  if (target.origin.toLowerCase() !== expected) return { ok: false, error: 'TLS_PROBE_ORIGIN_MISMATCH', expectedOrigin: expected, observedOrigin: target.origin.toLowerCase() };
  return { ok: true, target, expectedOrigin: expected };
}
function tlsStatusAccepted(statusCode) {
  return Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300;
}
function env(name) { return String(process.env[name] || '').trim(); }
function resolveReadinessDatabaseUrl(source = process.env) {
  return resolveDatabaseUrl(source, 'DATABASE_URL');
}
function readJsonFile(name) {
  const file = env(name);
  if (!file) return { ok: false, error: `${name}_REQUIRED` };
  try { return { ok: true, file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { return { ok: false, file, error: `${name}_INVALID:${e.message}` }; }
}
function proof(name, fileEnv, requiredFields) {
  // An unknown proof name must fail closed: it would otherwise be emitted as a
  // check whose result nobody declared, and a typo could silently drop a gate.
  if (!isKnownCheckName(name)) return result(name, false, { error: 'READINESS_CHECK_NAME_UNKNOWN', knownCheckNames: KNOWN_CHECK_NAMES.slice() });
  const loaded = readJsonFile(fileEnv);
  if (!loaded.ok) return result(name, false, { error: loaded.error });
  const checked = verifySignedControlProof(loaded.data, {
    publicKeyFile: env('FIBEROS_RUNTIME_CONTROL_PROOF_PUBLIC_KEY_FILE'),
    expectedKeyId: env('FIBEROS_RUNTIME_CONTROL_PROOF_KEY_ID'),
    expectedBuyerOrganizationId: env('FIBEROS_BUYER_ORGANIZATION_ID'),
    expectedDeploymentId: env('FIBEROS_DEPLOYMENT_ID'),
    expectedRelease: getReleaseIdentity(path.resolve(__dirname, '..')),
    proofType: name, requiredFields
  });
  return result(name, checked.ok, { file: loaded.file, signed: true, keyId: checked.keyId, failures: checked.failures });
}
function isRedisHaProofRequired(backend = env('SECURITY_RATE_LIMIT_BACKEND') || 'PROCESS_LOCAL') {
  return String(backend).toUpperCase() === 'REDIS';
}
function commandVersion(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); }
  catch (e) { return `UNAVAILABLE:${e.code || e.message}`; }
}
function checkNode() {
  const actual = process.versions.node;
  return result('node', versionAtLeast(actual, CONTRACT.node.required), { observed: actual, required: CONTRACT.node.required });
}
function checkNpm() {
  const actual = commandVersion('npm', ['--version']);
  return result('npm', !actual.startsWith('UNAVAILABLE') && versionAtLeast(actual, CONTRACT.npm.required), { observed: actual, required: CONTRACT.npm.required });
}

const APPLICATION_REQUIRED_TABLES = Object.freeze([
  'fiberos_migration_history', 'tenants', 'tickets', 'technicians',
  'org_units', 'outbox_events', 'user_preferences'
]);
function migrationLedgerError(code) { const error = new Error(code); error.code = code; throw error; }

/** Validate the exact source migration list and its two byte-level SHA-256 ledgers. */
function loadExpectedMigrationLedger(root = path.resolve(__dirname, '..')) {
  const dir = path.join(root, 'sql', 'migrations');
  let names, onDisk;
  try {
    names = fs.readFileSync(path.join(dir, 'PRODUCTION_MIGRATIONS.txt'), 'utf8')
      .split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    onDisk = fs.readdirSync(dir)
      .filter((n) => /^\d{3}_.+\.sql$/.test(n) && n !== '000_local_auth_stubs.sql').sort();
  } catch (_) { migrationLedgerError('SOURCE_MIGRATION_LEDGER_UNAVAILABLE'); }
  if (!names.length || JSON.stringify(names) !== JSON.stringify(onDisk)) migrationLedgerError('SOURCE_MIGRATION_LIST_MISMATCH');
  for (let i=0;i<names.length;i++) if (names[i].slice(0,3)!==String(i+1).padStart(3,'0')) migrationLedgerError('SOURCE_MIGRATION_SEQUENCE_INVALID');

  const readLedger = (file, expectedNames, label) => {
    let lines;
    try { lines=fs.readFileSync(file,'utf8').split(/\r?\n/).map((v)=>v.trim()).filter(Boolean); }
    catch (_) { migrationLedgerError(label+'_UNAVAILABLE'); }
    if(lines.length!==expectedNames.length) migrationLedgerError(label+'_COUNT_MISMATCH');
    const entries=new Map();
    for(const line of lines){const m=/^([a-f0-9]{64})\s+(\S+)$/i.exec(line);if(!m||entries.has(m[2]))migrationLedgerError(label+'_FORMAT_INVALID');entries.set(m[2],m[1].toLowerCase());}
    if(expectedNames.some((n)=>!entries.has(n))||[...entries.keys()].some((n)=>!expectedNames.includes(n)))migrationLedgerError(label+'_FILE_SET_MISMATCH');
    for(const name of expectedNames){
      let digest;try{digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex');}
      catch(_){migrationLedgerError('SOURCE_MIGRATION_READ_FAILED');}
      if(entries.get(name)!==digest)migrationLedgerError('SOURCE_MIGRATION_CHECKSUM_MISMATCH');
    }
    return entries;
  };
  const legacyNames=names.filter((n)=>Number(n.slice(0,3))<=116);
  const extensionNames=names.filter((n)=>Number(n.slice(0,3))>=117);
  const legacy=readLedger(path.join(dir,'PRODUCTION_MIGRATIONS.sha256'),legacyNames,'SOURCE_MIGRATION_LEGACY_LEDGER');
  const extension=readLedger(path.join(dir,'PRODUCTION_MIGRATIONS.extra.sha256'),extensionNames,'SOURCE_MIGRATION_EXTENSION_LEDGER');
  const ledger=new Map([...legacy.entries(),...extension.entries()]);
  return Object.freeze({migrations:Object.freeze(names.map((migration_name)=>Object.freeze({migration_name,sha256:ledger.get(migration_name)}))),highestMigration:names[names.length-1].slice(0,3)});
}

/** A DB is not ready unless its application schema and exact applied migration history match this release. */
function validateAppliedMigrationHistory(expectedMigrations, appliedRows, missingRequiredTables = []) {
  const failures=[], expected=Array.isArray(expectedMigrations)?expectedMigrations:[];
  if(!expected.length||expected.some((r)=>!r||typeof r.migration_name!=='string'||!/^[a-f0-9]{64}$/i.test(String(r.sha256||''))))failures.push('SOURCE_MIGRATION_LEDGER_INVALID');
  const expectedByName=new Map();
  for(const row of expected){if(row&&typeof row.migration_name==='string'){if(expectedByName.has(row.migration_name))failures.push('SOURCE_MIGRATION_DUPLICATE');expectedByName.set(row.migration_name,String(row.sha256||'').toLowerCase());}}
  const missingTables=[...new Set((Array.isArray(missingRequiredTables)?missingRequiredTables:[]).map(String))].sort();
  if(missingTables.length)failures.push('APP_SCHEMA_TABLES_MISSING');
  if(!Array.isArray(appliedRows)){
    failures.push('APP_MIGRATION_HISTORY_MISSING');
    return {ok:false,failures:[...new Set(failures)],expectedMigrationCount:expected.length,appliedMigrationCount:0,missingMigrationCount:expected.length,missingMigrations:[],unexpectedMigrations:[],checksumMismatches:[],missingRequiredTables:missingTables};
  }
  const appliedByName=new Map();
  for(const row of appliedRows){
    if(!row||typeof row.migration_name!=='string'||!/^[a-f0-9]{64}$/i.test(String(row.sha256||''))){failures.push('APP_MIGRATION_HISTORY_ROW_INVALID');continue;}
    if(appliedByName.has(row.migration_name))failures.push('APP_MIGRATION_HISTORY_DUPLICATE');
    appliedByName.set(row.migration_name,String(row.sha256).toLowerCase());
  }
  const missingMigrations=[...expectedByName.keys()].filter((n)=>!appliedByName.has(n)).sort();
  const unexpectedMigrations=[...appliedByName.keys()].filter((n)=>!expectedByName.has(n)).sort();
  const checksumMismatches=[...expectedByName.keys()].filter((n)=>appliedByName.has(n)&&expectedByName.get(n)!==appliedByName.get(n)).sort();
  if(missingMigrations.length)failures.push('APP_MIGRATIONS_MISSING');
  if(unexpectedMigrations.length)failures.push('APP_MIGRATIONS_UNEXPECTED');
  if(checksumMismatches.length)failures.push('APP_MIGRATION_CHECKSUM_MISMATCH');
  return {ok:failures.length===0,failures:[...new Set(failures)],expectedMigrationCount:expected.length,appliedMigrationCount:appliedRows.length,missingMigrationCount:missingMigrations.length,missingMigrations,unexpectedMigrations,checksumMismatches,missingRequiredTables:missingTables};
}


/** Stable commitment shared with fiberos_migration_history_attestation() in SQL.
 * Migration filenames are ASCII, so code-point ordering matches COLLATE "C".
 */
function migrationHistoryFingerprint(migrations) {
  if (!Array.isArray(migrations) || !migrations.length ||
      migrations.some((row) => !row || typeof row.migration_name !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(String(row.sha256 || '')))) {
    throw new Error('EXPECTED_MIGRATION_LEDGER_INVALID');
  }
  const canonical = migrations
    .map((row) => ({ migration_name: row.migration_name, sha256: String(row.sha256).toLowerCase() }))
    .sort((a, b) => a.migration_name < b.migration_name ? -1 : (a.migration_name > b.migration_name ? 1 : 0))
    .map((row) => row.migration_name + String.fromCharCode(31) + row.sha256)
    .join('\n');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Validate the bounded, runtime-callable ledger attestation without reading raw ledger rows. */
function validateAppliedMigrationAttestation(expectedMigrations, attestation, missingRequiredTables = [], attestationError = null) {
  const failures = [];
  const expected = Array.isArray(expectedMigrations) ? expectedMigrations : [];
  const expectedValid = expected.length > 0 && expected.every((row) =>
    row && typeof row.migration_name === 'string' && /^[a-f0-9]{64}$/i.test(String(row.sha256 || '')));
  if (!expectedValid) failures.push('SOURCE_MIGRATION_LEDGER_INVALID');

  const missingTables = [...new Set((Array.isArray(missingRequiredTables) ? missingRequiredTables : []).map(String))].sort();
  if (missingTables.length) failures.push('APP_SCHEMA_TABLES_MISSING');
  if (attestationError) failures.push(attestationError);
  if (!attestation && !attestationError) failures.push('APP_MIGRATION_ATTESTATION_MISSING');

  const expectedSorted = expected.slice().sort((a, b) =>
    String(a && a.migration_name || '') < String(b && b.migration_name || '') ? -1 :
      (String(a && a.migration_name || '') > String(b && b.migration_name || '') ? 1 : 0));
  const expectedLatest = expectedSorted.length ? expectedSorted[expectedSorted.length - 1].migration_name : null;
  let expectedFingerprint = null;
  if (expectedValid) expectedFingerprint = migrationHistoryFingerprint(expected);
  let appliedCount = 0;
  let observedFingerprint = null;
  let observedLatest = null;

  if (attestation) {
    appliedCount = Number(attestation.migration_count);
    observedFingerprint = String(attestation.ledger_sha256 || '').toLowerCase();
    observedLatest = typeof attestation.latest_migration === 'string' ? attestation.latest_migration : null;
    if (!Number.isSafeInteger(appliedCount) || appliedCount < 0) {
      failures.push('APP_MIGRATION_ATTESTATION_COUNT_INVALID');
      appliedCount = 0;
    } else if (appliedCount !== expected.length) failures.push('APP_MIGRATION_COUNT_MISMATCH');
    if (observedLatest !== expectedLatest) failures.push('APP_MIGRATION_HEAD_MISMATCH');
    if (!/^[a-f0-9]{64}$/.test(observedFingerprint)) failures.push('APP_MIGRATION_ATTESTATION_FINGERPRINT_INVALID');
    else if (expectedFingerprint && observedFingerprint !== expectedFingerprint) failures.push('APP_MIGRATION_FINGERPRINT_MISMATCH');
  }

  return {
    ok: failures.length === 0,
    failures: [...new Set(failures)],
    expectedMigrationCount: expected.length,
    appliedMigrationCount: appliedCount,
    missingMigrationCount: Math.max(0, expected.length - appliedCount),
    missingMigrations: [],
    unexpectedMigrations: [],
    checksumMismatches: [],
    missingRequiredTables: missingTables,
    expectedLatestMigration: expectedLatest,
    observedLatestMigration: observedLatest,
    expectedFingerprint,
    observedFingerprint,
    attestationError
  };
}

async function checkDatabase() {
  let resolution;
  try { resolution = resolveReadinessDatabaseUrl(process.env); }
  catch (e) { return result('database', false, { error: e.code || 'DATABASE_URL_RESOLUTION_FAILED' }); }
  if (!resolution.configured) return result('database', false, { error: resolution.code || 'DATABASE_URL_OR_DATABASE_URL_FILE_REQUIRED' });
  let expectedLedger;
  try { expectedLedger = loadExpectedMigrationLedger(path.resolve(__dirname, '..')); }
  catch (e) { return result('database', false, { error: e.code || 'SOURCE_MIGRATION_LEDGER_INVALID' }); }

  const { Client } = require('pg');
  const client = new Client({ connectionString: resolution.url, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const v = (await client.query("select current_setting('server_version_num')::int as version_num, version() as version, current_user, session_user")).rows[0];
    const role = (await client.query("select rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user")).rows[0];
    const postgis = (await client.query("select extversion from pg_extension where extname='postgis'")).rows[0];
    let postgisFullVersion = null;
    if (postgis) postgisFullVersion = (await client.query("select postgis_full_version() as full_version")).rows[0]?.full_version || null;

    const schemaSql = "SELECT " + APPLICATION_REQUIRED_TABLES
      .map((name) => "to_regclass('public." + name + "') IS NOT NULL AS \"" + name + "\"")
      .join(", ");
    const schemaRow = (await client.query(schemaSql)).rows[0] || {};
    const missingRequiredTables = APPLICATION_REQUIRED_TABLES.filter((name) => schemaRow[name] !== true);
    let appliedAttestation = null;
    let attestationError = null;
    if (!missingRequiredTables.includes('fiberos_migration_history')) {
      try {
        const attestationResult = await client.query(
          'SELECT migration_count, latest_migration, ledger_sha256 FROM public.fiberos_migration_history_attestation()'
        );
        appliedAttestation = attestationResult.rows[0] || null;
      } catch (error) {
        // Keep the least-privilege table ACL intact; emit stable errors only.
        if (error.code === '42883') attestationError = 'APP_MIGRATION_ATTESTATION_FUNCTION_MISSING';
        else if (error.code === '42501') attestationError = 'APP_MIGRATION_ATTESTATION_EXECUTE_DENIED';
        else attestationError = 'APP_MIGRATION_ATTESTATION_QUERY_FAILED';
      }
    }
    const migrationHistory = validateAppliedMigrationAttestation(
      expectedLedger.migrations, appliedAttestation, missingRequiredTables, attestationError
    );
    const versionNum = Number(v.version_num), major = Math.floor(versionNum / 10000);
    const minimumVersion = CONTRACT.postgresql.minimumSecurityBaseline;
    const minimumVersionNum = postgresVersionNumber(minimumVersion);
    const postgisOk = postgis && versionAtLeast(String(postgis.extversion || '0.0.0').split(' ')[0], CONTRACT.postgresql.postgis) && Boolean(postgisFullVersion);
    const roleOk = role && role.rolname === 'fiberos_runtime' && v.session_user === 'fiberos_runtime' && !role.rolsuper && !role.rolbypassrls && !role.rolcreatedb && !role.rolcreaterole;
    const majorOk = major === CONTRACT.postgresql.requiredMajor;
    const securityBaselineOk = postgresVersionAtLeast(versionNum, minimumVersion);
    const applicationSchemaOk = migrationHistory.ok;
    const ok = majorOk && securityBaselineOk && postgisOk && roleOk && applicationSchemaOk;
    return result('database', ok, {
      observedMajor: major, requiredMajor: CONTRACT.postgresql.requiredMajor,
      observedVersionNum: versionNum, minimumSecurityBaseline: minimumVersion,
      minimumSecurityBaselineNum: minimumVersionNum, securityBaselineOk,
      observedPostgis: postgis && postgis.extversion, postgisFullVersion,
      requiredPostgis: CONTRACT.postgresql.postgis, currentUser: v.current_user,
      sessionUser: v.session_user, roleOk,
      applicationSchemaOk, expectedHighestMigration: expectedLedger.highestMigration,
      migrationHistory, version: v.version
    });
  } catch (e) { return result('database', false, { error: e.code || 'DATABASE_RUNTIME_READINESS_FAILED' }); }
  finally { await client.end().catch(() => {}); }
}
function checkProductionSecrets() {
  const required = ['DATABASE_URL_FILE', 'OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URL', 'OBJECT_STORAGE', 'KMS_OR_SECRET_MANAGER', 'REVERSE_PROXY_TLS', 'FIBEROS_RUNTIME_CONTROL_PROOF_PUBLIC_KEY_FILE', 'FIBEROS_RUNTIME_CONTROL_PROOF_KEY_ID'];
  const missing = required.filter((name) => !env(name));
  const inlineDb = env('DATABASE_URL') && !env('DATABASE_URL_FILE');
  return result('secretsBoundary', missing.length === 0 && !inlineDb, { missing, inlineDatabaseUrlRejected: Boolean(inlineDb) });
}
async function checkTls() {
  const configOk = env('PG_SSL') === 'true' && env('PG_SSL_REJECT_UNAUTHORIZED') === 'true' && env('REVERSE_PROXY_TLS') === 'true';
  const probeUrl = env('FIBEROS_TLS_PROBE_URL');
  const expectedOrigin = env('FIBEROS_TLS_EXPECTED_ORIGIN');
  if (!configOk || !probeUrl || !expectedOrigin) return result('tlsIngress', false, { pgSsl: env('PG_SSL'), rejectUnauthorized: env('PG_SSL_REJECT_UNAUTHORIZED'), reverseProxyTls: env('REVERSE_PROXY_TLS'), error: !probeUrl ? 'FIBEROS_TLS_PROBE_URL_REQUIRED' : (!expectedOrigin ? 'FIBEROS_TLS_EXPECTED_ORIGIN_REQUIRED' : 'TLS_CONFIGURATION_INCOMPLETE') });
  const targetValidation = validateTlsProbeTarget(probeUrl, expectedOrigin);
  if (!targetValidation.ok) return result('tlsIngress', false, targetValidation);
  const target = targetValidation.target;
  return await new Promise((resolve) => {
    const req = https.request(target, { method: 'HEAD', timeout: 5000, rejectUnauthorized: true }, (res) => {
      const protocol = res.socket && typeof res.socket.getProtocol === 'function' ? res.socket.getProtocol() : null;
      const statusOk = tlsStatusAccepted(res.statusCode);
      const protocolOk = protocol === 'TLSv1.2' || protocol === 'TLSv1.3';
      res.resume();
      resolve(result('tlsIngress', statusOk && protocolOk, { statusCode: res.statusCode, protocol, statusOk, protocolOk, expectedOrigin: targetValidation.expectedOrigin, redirectsRejected: true }));
    });
    req.on('timeout', () => req.destroy(new Error('TLS_PROBE_TIMEOUT')));
    req.on('error', (e) => resolve(result('tlsIngress', false, { error: e.code || e.message, redirectsRejected: true })));
    req.end();
  });
}
async function checkRateLimit() {
  const backend = (env('SECURITY_RATE_LIMIT_BACKEND') || 'PROCESS_LOCAL').toUpperCase();
  const instances = Number(env('SECURITY_RATE_LIMIT_EXPECTED_INSTANCES') || 1);
  if (!Number.isInteger(instances) || instances < 1) return result('rateLimitBoundary', false, { backend, error: 'SECURITY_RATE_LIMIT_EXPECTED_INSTANCES_INVALID' });
  if (backend === 'PROCESS_LOCAL') {
    return result('rateLimitBoundary', instances === 1, { backend, expectedInstances: instances, sharedStore: false, reason: instances === 1 ? null : 'PROCESS_LOCAL_RATE_LIMIT_UNSAFE_FOR_MULTI_INSTANCE' });
  }
  if (backend !== 'REDIS') return result('rateLimitBoundary', false, { backend, error: 'RATE_LIMIT_BACKEND_UNSUPPORTED' });
  let store;
  try {
    store = createRedisRateLimitStore(process.env);
    await store.ping();
    return result('rateLimitBoundary', true, { backend, expectedInstances: instances, redisConfigured: Boolean(env('REDIS_URL') || env('REDIS_URL_FILE')), redisPing: 'PONG' });
  } catch (error) {
    return result('rateLimitBoundary', false, { backend, expectedInstances: instances, error: error.code || 'REDIS_RATE_LIMIT_STORE_UNAVAILABLE' });
  } finally {
    if (store) await store.close().catch(() => {});
  }
}
const { REDIS_HA_PROOF_MAX_AGE_DAYS, REDIS_HA_PROOF_SCHEMA, redisHaProofSigningBytes, validateRedisHaProof, readRedisHaTrust } = require('../packages/security/src/redisHaProofValidator');

function validateRedisHaTopology(topology) {
  topology = topology && typeof topology === 'object' ? topology : {};
  const failures = [];
  if (topology.role !== 'master') failures.push('REDIS_PRIMARY_ROLE_REQUIRED');
  if (!Number.isInteger(topology.connectedReplicaCount) || topology.connectedReplicaCount < 1) failures.push('REDIS_CONNECTED_REPLICA_REQUIRED');
  return { ok: failures.length === 0, failures };
}
async function checkRedisHaProof() {
  const loaded = readJsonFile('FIBEROS_REDIS_HA_PROOF_FILE');
  if (!loaded.ok) return result('redisHighAvailability', false, { error: loaded.error });
  const trust = readRedisHaTrust();
  if (!trust.ok) return result('redisHighAvailability', false, { file: loaded.file, error: trust.error });
  const validation = validateRedisHaProof(loaded.data, Date.now(), trust);
  if (!validation.ok) return result('redisHighAvailability', false, { file: loaded.file, keyId: trust.expectedKeyId, failures: validation.failures, maxProofAgeDays: REDIS_HA_PROOF_MAX_AGE_DAYS });

  let store;
  try {
    store = createRedisRateLimitStore(process.env);
    const topology = await store.inspectHaTopology();
    const topologyValidation = validateRedisHaTopology(topology);
    return result('redisHighAvailability', topologyValidation.ok, {
      file: loaded.file,
      keyId: trust.expectedKeyId,
      issuer: loaded.data.issuer,
      failoverTestedAt: loaded.data.payload.failoverTestedAt,
      runtimeRedisRole: topology.role,
      connectedReplicaCount: topology.connectedReplicaCount,
      failures: topologyValidation.failures,
      maxProofAgeDays: REDIS_HA_PROOF_MAX_AGE_DAYS
    });
  } catch (error) {
    return result('redisHighAvailability', false, { file: loaded.file, keyId: trust.expectedKeyId, error: error.code || 'REDIS_HA_RUNTIME_PROBE_FAILED' });
  } finally {
    if (store) await store.close().catch(() => {});
  }
}
async function checkRlsTenantIsolation() {
  const admin = env('RUNTIME_ADMIN_DATABASE_URL');
  const app = env('RUNTIME_APP_DATABASE_URL');
  if (!admin || !app) return result('rlsTenantIsolation', false, { error: 'RUNTIME_ADMIN_DATABASE_URL_AND_RUNTIME_APP_DATABASE_URL_REQUIRED' });
  try {
    execFileSync('bash', [path.join(__dirname, '..', 'deploy', 'tests', 'tenant_isolation.sh')], { env: { ...process.env, RUNTIME_ADMIN_DATABASE_URL: admin, RUNTIME_APP_DATABASE_URL: app }, encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'] });
    return result('rlsTenantIsolation', true, { liveProbe: true });
  } catch (e) {
    return result('rlsTenantIsolation', false, { liveProbe: true, error: e.status ? 'TENANT_ISOLATION_PROBE_FAILED' : (e.code || e.message) });
  }
}
function checkKernelBoundaryMode() {
  const mode = env('FIBEROS_KERNEL_BOUNDARY_REQUIRED').toLowerCase();
  const explicit = mode === 'true' || mode === 'false';
  const instances = Number(env('SECURITY_RATE_LIMIT_EXPECTED_INSTANCES') || 1);
  const secret = env('FIBEROS_KERNEL_HMAC_SECRET') || env('SIGNING_HMAC_SECRET');
  const failures = [];
  if (!explicit) failures.push('KERNEL_BOUNDARY_MODE_MUST_BE_EXPLICIT_IN_PRODUCTION');
  if (mode === 'true' && Buffer.byteLength(secret, 'utf8') < 32) failures.push('KERNEL_BOUNDARY_HMAC_SECRET_TOO_WEAK');
  const replayBackend = (env('FIBEROS_REPLAY_DEFENSE_BACKEND') || 'PROCESS_LOCAL').toUpperCase();
  if (mode === 'true' && instances > 1 && replayBackend !== 'REDIS') failures.push('KERNEL_BOUNDARY_REPLAY_STORE_PROCESS_LOCAL_FOR_MULTI_INSTANCE');
  return result('kernelBoundaryMode', failures.length === 0, { required: mode || null, explicit, failures });
}
async function checkOidc() {
  const required = ['OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URL', 'OIDC_JWKS_ALLOWED_HOSTS', 'OIDC_TEST_BEARER'];
  const missing = required.filter((name) => !env(name));
  if (missing.length) return result('identityOidcJwks', false, { missing, liveProbe: false });
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'buyer-acceptance', 'live-oidc-jwks.js')], { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 15000, stdio: ['ignore','pipe','pipe'] });
    return result('identityOidcJwks', true, { liveProbe: true, cryptographicallyVerified: true });
  } catch (e) {
    return result('identityOidcJwks', false, { liveProbe: true, cryptographicallyVerified: false, error: e.status ? 'OIDC_LIVE_PROBE_FAILED' : (e.code || e.message) });
  }
}
function checkI18n() {
  const locales = (env('FIBEROS_REQUIRED_LOCALES') || 'ar,en').split(',').map((x) => x.trim()).filter(Boolean);
  const failures = [];
  for (const locale of locales) {
    const file = path.join(__dirname, '..', 'i18n', 'catalogs', `${locale}.json`);
    try {
      const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (catalog.status !== 'verified' || catalog.verifiedCoverage !== 100) failures.push({ locale, status: catalog.status, verifiedCoverage: catalog.verifiedCoverage });
    } catch (e) { failures.push({ locale, error: e.code || e.message }); }
  }
  return result('i18nProductionLocales', failures.length === 0, { requiredLocales: locales, failures });
}
function checkHealth() {
  return proof('healthMetricsAlerts', 'FIBEROS_HEALTH_PROOF_FILE', ['healthy', 'alertsConfigured']);
}
async function checkReplayDefense() {
  const instances = Number(env('SECURITY_RATE_LIMIT_EXPECTED_INSTANCES') || 1);
  const backend = (env('FIBEROS_REPLAY_DEFENSE_BACKEND') || 'PROCESS_LOCAL').toUpperCase();
  const required = String(env('FIBEROS_REPLAY_DEFENSE_REQUIRED') || (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() === 'true';
  if (!required && instances === 1) return result('replayDefense', true, { required: false, backend, expectedInstances: instances });
  if (backend !== 'REDIS') return result('replayDefense', false, { required: true, backend, expectedInstances: instances, error: 'REDIS_REPLAY_DEFENSE_REQUIRED' });
  try {
    const { createRedisReplayDefenseFromEnv } = require('../packages/security/src/redisReplayDefense');
    const defense = createRedisReplayDefenseFromEnv(process.env, { prefix: env('FIBEROS_REPLAY_REDIS_PREFIX') || 'fiberos:replay:v1', ttlSeconds: Number(env('FIBEROS_REPLAY_TTL_SECONDS') || 300) });
    await defense.ping();
    await defense.close();
    return result('replayDefense', true, { required: true, backend, expectedInstances: instances, redis: 'PONG' });
  } catch (error) {
    return result('replayDefense', false, { required: true, backend, expectedInstances: instances, error: error.code || 'REPLAY_DEFENSE_REDIS_FAILED' });
  }
}

async function main() {
  const checks = [checkNode(), checkNpm(), await checkDatabase(), checkProductionSecrets(), await checkTls(), await checkRlsTenantIsolation(), await checkRateLimit(), await checkReplayDefense(), checkKernelBoundaryMode(), await checkOidc(), checkI18n(), checkHealth()];
  if (isRedisHaProofRequired()) checks.push(await checkRedisHaProof());
  checks.push(proof('backupRestore', 'FIBEROS_BACKUP_RESTORE_PROOF_FILE', ['backupCreated', 'restoreVerified', 'integrityVerified']));
  checks.push(proof('externalAdapters', 'FIBEROS_EXTERNAL_ADAPTERS_PROOF_FILE', ['oidcJwks', 'objectStorage', 'kmsOrSecretManager', 'nmsOtdr', 'webhooks', 'messaging']));
  const requiredChecks = resolveRequiredChecks(process.env);
  // The policy result is appended immediately below; requiring it while
  // validating the pre-policy list would make the gate fail itself forever.
  const requiredBeforePolicy = requiredChecks.required.filter((name) => name !== 'checkNamePolicy');
  const namePolicy = validateCheckNames(checks, { required: requiredBeforePolicy });
  const namePolicyOk = requiredChecks.ok && namePolicy.ok;
  checks.push(result('checkNamePolicy', namePolicyOk, {
    unknown: namePolicy.unknown,
    missing: namePolicy.missing,
    duplicates: namePolicy.duplicates,
    required: namePolicy.required,
    requiredSource: requiredChecks.ok ? 'CONTRACT_PLUS_ENV' : 'CONTRACT_ONLY_ENV_REJECTED',
    envRequiredUnknown: requiredChecks.unknown,
    envRequiredEmpty: requiredChecks.empty,
    envError: requiredChecks.error,
    accepted: namePolicy.accepted
  }));
  const ok = checks.every((check) => check.status === 'PASS');
  const payload = { ok, productionReady: ok, contract: CONTRACT.schema, checkedAt: new Date().toISOString(), checks };
  console.log(JSON.stringify(payload, null, 2));
  if (!ok) process.exitCode = 1;
}
if (require.main === module) {
  main().catch((e) => { console.error(JSON.stringify({ ok: false, error: e.message }, null, 2)); process.exitCode = 1; });
}
module.exports = { KNOWN_CHECK_NAMES, validateCheckNames, resolveRequiredChecks, REDIS_HA_PROOF_SCHEMA, redisHaProofSigningBytes, validateRedisHaProof, validateRedisHaTopology, isRedisHaProofRequired, checkRedisHaProof, checkRateLimit, postgresVersionNumber, postgresVersionAtLeast, normalizedHttpsOrigin, validateTlsProbeTarget, tlsStatusAccepted, resolveReadinessDatabaseUrl, APPLICATION_REQUIRED_TABLES, loadExpectedMigrationLedger, validateAppliedMigrationHistory, migrationHistoryFingerprint, validateAppliedMigrationAttestation };
