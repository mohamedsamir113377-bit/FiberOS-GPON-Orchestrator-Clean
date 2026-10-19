'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256Content, validateEvidenceEnvelope } = require('../src/evidenceIntegrity');

test('evidence module loads and hashes canonical objects deterministically', () => {
  const a = sha256Content({ b: 2, a: 1 });
  const b = sha256Content({ a: 1, b: 2 });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('content hash mismatch is rejected', () => {
  const result = validateEvidenceEnvelope({
    ticketId: 'T1', kind: 'photo', source: 'manual_entry',
    content: { frame: 1 }, contentHash: sha256Content({ frame: 2 })
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('CONTENT_HASH_MISMATCH'));
});

test('final closure requires a matching content hash', () => {
  const content = { frame: 1, operator: 'A' };
  const result = validateEvidenceEnvelope({
    ticketId: 'T1', kind: 'photo', source: 'manual_entry', finalClosure: true,
    content, contentHash: sha256Content(content)
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('simulated evidence can never final-close', () => {
  const result = validateEvidenceEnvelope({
    ticketId: 'T1', kind: 'analysis', source: 'ai_simulated', finalClosure: true,
    content: { hypothesis: 'x' }, contentHash: sha256Content({ hypothesis: 'x' })
  });
  assert.ok(result.errors.includes('AI_SIMULATED_CANNOT_FINAL_CLOSE'));
  assert.equal(result.ok, false);
});
