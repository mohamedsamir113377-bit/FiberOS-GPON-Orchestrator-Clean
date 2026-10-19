'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, '..', 'verify-engines-contract.js');

test('engines gate passes on the committed tree and every workspace declares >=.nvmrc', () => {
  const nvmrc = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(rootPkg.engines.node, `>=${nvmrc}`);
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(payload.ok, true);
  assert.equal(payload.expected, `>=${nvmrc}`);
  assert.ok(payload.workspacePackagesChecked >= 60, `expected full workspace coverage, got ${payload.workspacePackagesChecked}`);
});

test('engines gate fails closed on a subpackage missing the engines field', () => {
  const scratch = fs.mkdtempSync(path.join(ROOT, 'packages', '.engines-gate-probe-'));
  try {
    fs.writeFileSync(
      path.join(scratch, 'package.json'),
      JSON.stringify({ name: 'engines-probe', version: '0.0.0' })
    );
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ENGINES_MISSING/);
    assert.match(run.stderr, /NODE_ENGINE_CONTRACT_VIOLATION/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('engines gate fails closed when the runtime image drifts from .nvmrc', () => {
  const original = fs.readFileSync(path.join(ROOT, 'docker', 'Dockerfile.runtime'), 'utf8');
  const drifted = original.replace(/node:\d+\.\d+\.\d+/g, 'node:22.0.0');
  try {
    fs.writeFileSync(path.join(ROOT, 'docker', 'Dockerfile.runtime'), drifted);
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /DOCKER_NODE_IMAGE_MISMATCH/);
  } finally {
    fs.writeFileSync(path.join(ROOT, 'docker', 'Dockerfile.runtime'), original);
  }
});
