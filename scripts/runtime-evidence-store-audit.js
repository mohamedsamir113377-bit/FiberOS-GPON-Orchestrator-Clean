#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildArtifactSetHash, sha256File } = require('../packages/core/src/evidenceProvenance');
const { verifyStore } = require('../packages/core/src/runtimeEvidenceStore');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const inventoryRel = 'config/rls-tenant-sensitive-inventory.json';
const staticInputs = [
  'package.json',
  'scripts/production-readiness-gate.js',
  'config/rls-tenant-sensitive-inventory.json'
];

const inventoryHash = sha256File(root, inventoryRel);
const artifactSetHash = buildArtifactSetHash(root, staticInputs);
const result = verifyStore(root, {
  expectedReleaseId: pkg.version,
  expectedArtifactSetHash: artifactSetHash,
  expectedInventoryHash: inventoryHash
});

const output = {
  schema: 'fiberos.r14.1.runtime-evidence-store-audit.v1',
  checkedAt: new Date().toISOString(),
  releaseId: pkg.version,
  status: result.ok ? 'PASS' : 'FAIL',
  storeExists: result.exists,
  recordCount: result.count,
  failures: result.failures,
  productionReady: false,
  productionHold: true,
  truthBoundary: 'An empty store is valid before runtime execution; verification never synthesizes runtime proof.',
  artifactSetHash,
  canonicalInventoryHash: inventoryHash
};

if (process.env.FIBEROS_RUNTIME_EVIDENCE_AUDIT_OUT) {
  const outFile = path.resolve(root, process.env.FIBEROS_RUNTIME_EVIDENCE_AUDIT_OUT);
  fs.mkdirSync(path.dirname(outFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
}
console.log(JSON.stringify(output, null, 2));
process.exit(result.ok ? 0 : 1);
