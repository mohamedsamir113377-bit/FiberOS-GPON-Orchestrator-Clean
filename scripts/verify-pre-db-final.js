#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const failures = [];
const staticChecks = [];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function requireFile(file) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    failures.push(`MISSING_FILE:${file}`);
    return false;
  }
  return true;
}

function check(name, ok) {
  staticChecks.push({ name, ok: Boolean(ok) });
  if (!ok) failures.push(name);
}

[
  'package.json',
  '.nvmrc',
  'config/identity-production-contract.v1.json',
  'config/runtime-environment-contract.v1.json',
  'config/production-integration-boundaries.json',
  'packages/core/src/productionHold.js',
  'services/api/src/server.js'
].forEach(requireFile);

if (!failures.length) {
  const pkg = readJson('package.json');
  const identity = readJson('config/identity-production-contract.v1.json');
  const runtime = readJson('config/runtime-environment-contract.v1.json');
  const boundaries = readJson('config/production-integration-boundaries.json');
  const holdSource = readText('packages/core/src/productionHold.js');
  const serverSource = readText('services/api/src/server.js');

  check('VERIFY_RELEASE_INCLUDED', String(pkg.scripts && pkg.scripts.verify || '').includes('verify:release'));
  const requiredNode = String(runtime.node && runtime.node.required || '');
  check('NODE_ENGINE_MATCHES_RUNTIME_CONTRACT', String(pkg.engines && pkg.engines.node || '') === requiredNode);
  check(
    'NVMRC_MATCHES_NODE_ENGINE',
    readText('.nvmrc').trim() === requiredNode.replace(/^>=/, '')
  );

  const productionIdentity = identity.production || {};
  check('PRODUCTION_IDENTITY_RS256', productionIdentity.jwtAlgorithm === 'RS256');
  check('PRODUCTION_HMAC_FORBIDDEN', productionIdentity.hmac && productionIdentity.hmac.allowed === false);

  check('RUNTIME_CONTRACT_DECLARATIVE_ONLY', runtime.status === 'DECLARATIVE_CONTRACT_ONLY');
  check(
    'RUNTIME_CONTRACT_NEVER_SATISFIES_LIVE_REQUIREMENTS',
    String(runtime.productionAdmission || '').includes('no static result may satisfy a runtime requirement')
  );

  check(
    'PRODUCTION_HOLD_FAILS_CLOSED_BY_DEFAULT',
    holdSource.includes("String(env.PRODUCTION_HOLD || 'true').toLowerCase() !== 'false'")
  );
  check(
    'RUNTIME_GATE_FAILS_CLOSED',
    serverSource.includes("error: 'BLOCKED_PRECONDITION'") && serverSource.includes('productionHold: true')
  );

  const entries = boundaries.boundaries && typeof boundaries.boundaries === 'object'
    ? Object.entries(boundaries.boundaries)
    : [];
  check('RUNTIME_BOUNDARIES_PRESENT', entries.length > 0);

  for (const [name, boundary] of entries) {
    check(`RUNTIME_BOUNDARY_DECLARED_NOT_PRODUCTION_VERIFIED:${name}`,
      boundary && boundary.enabled === false && boundary.productionVerified === false && boundary.evidenceRef == null
    );
  }

  const notVerified = entries.filter(([, boundary]) =>
    !(boundary && boundary.enabled === true && boundary.productionVerified === true)
  ).map(([name]) => name);

  console.log(JSON.stringify({
    gate: 'PRE_DB_FINAL_GATE',
    status: failures.length ? 'FAIL' : 'PASS',
    staticChecks: staticChecks.filter(x => x.ok).length,
    staticFailures: staticChecks.filter(x => !x.ok).map(x => x.name),
    runtimeStatus: 'NOT_VERIFIED',
    runtimeBoundariesNotVerified: notVerified,
    productionReadyClaim: false,
    productionReadyReason: 'PRE_DB_SOURCE_PACKAGE_DOES_NOT_PROVIDE_LIVE_RUNTIME_EVIDENCE'
  }, null, 2));
}

if (failures.length) {
  console.error('PRE_DB_FINAL_GATE FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
