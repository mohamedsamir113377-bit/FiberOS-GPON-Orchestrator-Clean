import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanTree, assertNoSecrets } from '../src/index.js';

const secrets = [
  ['AKIA', '1234567890ABCDEF'].join(''),
  'eyJabcdefghij.abcdefghij.abcdefghij',
  'postgres://alice:VerySecret123@db.example.com',
  'Bearer abcdefghijklmnopqrstuvwxyz0123456789'
];

test('scanner never suppresses real-looking credentials because a line says test/sample', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fiberos-secret-scan-'));
  try {
    fs.writeFileSync(path.join(root, 'fixture.txt'), `${secrets[0]} // test sample\n`);
    const findings = scanTree(root);
    assert.equal(findings.some(item => item.rule === 'AWS_ACCESS_KEY'), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('runtime assertion detects every high/critical detector family', () => {
  for (const value of secrets) assert.throws(() => assertNoSecrets(value), /SENSITIVE_VALUE_DETECTED/);
  assert.throws(() => assertNoSecrets(['-----BEGIN ', 'PRIVATE KEY----- partial'].join('')), /SENSITIVE_VALUE_DETECTED/);
});

test('runtime assertion allows a credential placeholder without suppressing real secrets', () => {
  assert.equal(assertNoSecrets('postgres://fiberos:${POSTGRES_PASSWORD}@db.internal'), true);
  assert.equal(assertNoSecrets('ordinary operational text'), true);
});
