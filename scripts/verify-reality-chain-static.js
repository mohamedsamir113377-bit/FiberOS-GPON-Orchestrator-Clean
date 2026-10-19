#!/usr/bin/env node
'use strict';

/**
 * Static Reality Chain gate: Customer → Conversation → Language → Handoff →
 * Operational Event → Incident → Evidence → Trace
 * Runtime DB admission is NOT claimed.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const testFile = path.join(ROOT, 'packages/operational-context/test/realityChain.e2e-static.test.js');

if (!fs.existsSync(testFile)) {
  console.error('REALITY_CHAIN_STATIC_FAIL: missing test file');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', testFile], {
  cwd: ROOT,
  encoding: 'utf8'
});

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

if (result.status !== 0) {
  console.error('REALITY_CHAIN_STATIC_FAIL');
  process.exit(result.status || 1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      gate: 'REALITY_CHAIN_STATIC',
      runtimeAdmission: 'NOT_CLAIMED',
      postgresRls: 'NOT_CLAIMED',
      chain: [
        'Customer',
        'Conversation',
        'LanguageNegotiation',
        'Handoff',
        'CanonicalOperationalEvent',
        'IncidentCommand',
        'EvidenceVault',
        'OperationalTrace'
      ]
    },
    null,
    2
  )
);
