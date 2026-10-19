#!/usr/bin/env node
'use strict';

/*
 * Root-cause release audit.
 *
 * This is deliberately a static contract gate. It rejects known classes of
 * release drift instead of trying to make an unavailable external CI runner
 * look green.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fail = msg => { console.error(`FAIL — ${msg}`); process.exitCode = 1; };

const pkg = JSON.parse(read('package.json'));
const nvmrc = read('.nvmrc').trim();
const engine = String(pkg.engines?.node || '');

if (!nvmrc) fail('.nvmrc is empty.');
if (!engine.includes(nvmrc)) fail(`package.json Node engine does not explicitly admit .nvmrc=${nvmrc} (engine=${engine}).`);

const admission = read('.github/workflows/release-admission.yml');
if (/workflow_run\s*:/.test(admission)) fail('release-admission.yml still uses workflow_run polling instead of one orchestrated dependency graph.');
for (const workflow of ['verify.yml','runtime-postgres-rls.yml','runtime-container-security.yml','release-security-gate.yml']) {
  if (!admission.includes('uses: ./.github/workflows/' + workflow)) fail('release-admission.yml does not call required reusable workflow: ' + workflow);
}
if (!/needs:\s*\[verify, postgres-rls, container-security, security\]/.test(admission)) fail('release-admission.yml does not make all four release gates direct final-admission dependencies.');
if (/\b(?:verify|runtime-postgres-rls|runtime-container-security|release-security-gate):\d+\b/.test(admission)) fail('release-admission.yml contains a legacy numeric workflow ID.');
if (/matching_success=|sleep\s+15/.test(admission)) fail('release-admission.yml contains the retired same-SHA polling loop.');
if (/name: Checkout admitted source tree[\s\S]{0,300}?\n\s*if:/m.test(admission)) fail('release-admission.yml must not gate admitted-source checkout by event type.');
if (/name: Verify final source truth boundary[\s\S]{0,300}?\n\s*if:/m.test(admission)) fail('release-admission.yml must run final source truth verification on every admission event.');
if (/name: Record final admission boundary[\s\S]{0,300}?\n\s*if:/m.test(admission)) fail('release-admission.yml must record admission boundary on every admission event.');
if (/name: Upload final admission evidence[\s\S]{0,300}?\n\s*if:/m.test(admission)) fail('release-admission.yml must upload admission evidence on every admission event.');

for (const file of ['.github/workflows/verify.yml','.github/workflows/runtime-postgres-rls.yml','.github/workflows/runtime-container-security.yml','.github/workflows/release-security-gate.yml']) {
  if (!/workflow_call\s*:/.test(read(file))) fail(file + ' is not a reusable workflow.');
}

for (const file of ['.github/workflows/runtime-postgres-rls.yml','.github/workflows/runtime-container-security.yml']) {
  const text = read(file);
  if (/^\s*paths\s*:/m.test(text) || /^\s*paths-ignore\s*:/m.test(text)) fail(file + ' still has path filters that can suppress a required release gate.');
}

const manifestGenerator = read('scripts/generate-sales-manifest.js');
if (/manifest\.updateDate\s*=/.test(manifestGenerator) || /(?:new Date\(|Date\.now\()/.test(manifestGenerator)) {
  fail('sales manifest generator derives release metadata from wall-clock time or overwrites updateDate.');
}

const session = read('packages/db/src/session.js');
if (!session.includes("set_config('request.jwt.claim.role', $1, true)`, ['authenticated'])")) {
  fail('packages/db/src/session.js must keep request.jwt.claim.role fixed to authenticated.');
}
const appMetadata = session.match(/app_metadata\s*:\s*\{([^}]*)\}/s);
if (!appMetadata || !/(?:^|,)\s*role\s*:\s*appRole\s*\|\|\s*null\s*(?:,|$)/.test(appMetadata[1])) {
  fail('packages/db/src/session.js must place the application role in app_metadata.role.');
}
if (!appMetadata || !/(?:^|,)\s*tenant_id\s*:\s*tenantId\s*\|\|\s*null\s*(?:,|$)/.test(appMetadata[1])) {
  fail('packages/db/src/session.js must bind app_metadata.tenant_id to the authenticated principal.');
}

const capability = read('scripts/verify-capability-parity.js');
if (/catch\s*\([^)]*\)\s*\{[^}]*skip unparsable/i.test(capability)) {
  fail('capability parity silently skips an unparsable dynamic route.');
}

for (const file of ['.github/workflows/release-admission.yml','.github/workflows/release-security-gate.yml']) {
  if (/continue-on-error\s*:\s*true/i.test(read(file))) fail(`${file} contains continue-on-error on a release/security gate.`);
}

if (!process.exitCode) console.log('OK — root-cause release contracts are fail-closed and internally consistent.');
