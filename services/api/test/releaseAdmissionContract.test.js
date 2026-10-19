'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

test('release admission uses local reusable workflows and no mutable workflow IDs or polling', () => {
  const source = fs.readFileSync(path.join(ROOT, '.github/workflows/release-admission.yml'), 'utf8');

  for (const workflow of [
    'verify.yml',
    'runtime-postgres-rls.yml',
    'runtime-container-security.yml',
    'release-security-gate.yml'
  ]) {
    assert.match(
      source,
      new RegExp('uses: \\.\\/\\.github\\/workflows\\/' + workflow.replaceAll('.', '\\.') + '\\b')
    );
  }

  for (const id of ['361771414', '363366418', '363998744', '363479019']) {
    assert.doesNotMatch(source, new RegExp(id));
  }

  assert.doesNotMatch(source, /workflow_run\s*:/);
  assert.doesNotMatch(source, /actions\/workflows\/\$workflow_file\/runs\?branch=main/);
  assert.doesNotMatch(source, /matching_success=|sleep\s+15/);
  assert.match(source, /needs:\s*\[verify, postgres-rls, container-security, security\]/);
  for (const step of ['Checkout admitted source tree','Verify final source truth boundary','Record final admission boundary','Upload final admission evidence']) {
    const block = source.slice(source.indexOf('name: ' + step));
    const next = block.indexOf('\n      - name: ');
    const stepBody = next >= 0 ? block.slice(0, next) : block;
    assert.doesNotMatch(stepBody, /\n\s*if:/);
  }
});

test('release admission final boundary remains pinned to the admitted SHA', () => {
  const source = fs.readFileSync(path.join(ROOT, '.github/workflows/release-admission.yml'), 'utf8');
  assert.match(source, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.doesNotMatch(source, /ref:\s*main\b/);
});

test('same-SHA release gates cannot be made conditionally absent by path filters', () => {
  for (const file of ['runtime-postgres-rls.yml', 'runtime-container-security.yml']) {
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8');
    assert.equal(source.includes('  push:\n    paths:'), false);
    assert.equal(source.includes('  pull_request:\n    paths:'), false);
    assert.equal(source.includes('  push:\n    paths-ignore:'), false);
    assert.equal(source.includes('  pull_request:\n    paths-ignore:'), false);
  }
});
