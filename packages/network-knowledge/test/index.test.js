'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('../src/index.js');

function base(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    workRef: 'WO-1001',
    knowledgeClass: 'FIELD_RESOLUTION',
    origin: 'field_verified',
    symptom: 'ONT LOS with healthy OLT port',
    action: 'replaced drop fibre at riser box 3',
    outcome: 'service restored, rx -19.4 dBm',
    evidenceIds: ['ev-2', 'ev-1', 'ev-1'],
    capturedAt: '2026-10-07T10:00:00.000Z',
    actorId: 'tech-9',
    ...overrides
  };
}

test('knowledge capture refuses to exist without evidence', () => {
  assert.throws(() => k.captureKnowledge(base({ evidenceIds: [] })), /KNOWLEDGE_EVIDENCE_REQUIRED/);
  assert.throws(() => k.captureKnowledge(base({ knowledgeClass: 'MARKETING' })), /KNOWLEDGE_CLASS_INVALID/);
  assert.throws(() => k.captureKnowledge(base({ origin: 'guessed' })), /KNOWLEDGE_ORIGIN_INVALID/);
  assert.throws(() => k.captureKnowledge(base({ capturedAt: 'not-a-date' })), /KNOWLEDGE_CAPTURED_AT_INVALID/);
});

test('knowledge capture is content addressed and evidence normalised', () => {
  const record = k.captureKnowledge(base());
  assert.equal(record.status, 'EVIDENCE_BOUND');
  assert.deepEqual([...record.evidenceIds], ['ev-1', 'ev-2']);
  assert.equal(record.reusable, true);
  assert.match(record.knowledgeHash, /^[0-9a-f]{64}$/);
  assert.equal(k.validateKnowledgeRecord(record).valid, true);
  assert.equal(k.assertKnowledgeIsTraceable(record), true);
});

test('a mutated knowledge record is detected instead of trusted', () => {
  const record = k.captureKnowledge(base());
  const tampered = { ...record, outcome: 'service restored by an undocumented shortcut' };
  const check = k.validateKnowledgeRecord(tampered);
  assert.equal(check.valid, false);
  assert.ok(check.findings.includes('KNOWLEDGE_HASH_MISMATCH'));
  assert.throws(() => k.assertKnowledgeIsTraceable(tampered), /KNOWLEDGE_NOT_TRACEABLE:.*KNOWLEDGE_HASH_MISMATCH/);
});

test('model-generated knowledge requires a model reference and a human reviewer', () => {
  const modelBase = base({ knowledgeClass: 'OPTICAL_SIGNATURE', origin: 'model_generated', modelRef: undefined, reviewedBy: undefined });
  assert.throws(() => k.captureKnowledge(modelBase), /KNOWLEDGE_MODEL_REFERENCE_REQUIRED/);
  assert.throws(() => k.captureKnowledge({ ...modelBase, modelRef: 'model-otdr-1' }), /KNOWLEDGE_MODEL_OUTPUT_REQUIRES_HUMAN_REVIEW/);
  const reviewed = k.captureKnowledge({ ...modelBase, modelRef: 'model-otdr-1', reviewedBy: 'engineer-2' });
  assert.equal(reviewed.origin, 'model_generated');
  assert.equal(reviewed.reviewedBy, 'engineer-2');
  assert.equal(k.validateKnowledgeRecord(reviewed).valid, true);
});

test('search is tenant scoped, evidence gated and deterministic', () => {
  const newest = k.captureKnowledge(base({ capturedAt: '2026-10-07T10:00:00.000Z' }));
  const older = k.captureKnowledge(base({ workRef: 'WO-1000', capturedAt: '2026-10-05T10:00:00.000Z', action: 'cleaned dirty connector' }));
  const untraceable = { ...k.captureKnowledge(base({ workRef: 'WO-1002' })), evidenceIds: [] };
  const foreignTenant = k.captureKnowledge(base({ tenantId: 'tenant-b', workRef: 'WO-9000' }));

  const out = k.searchKnowledge([newest, older, untraceable, foreignTenant], { tenantId: 'tenant-a', limit: 10 });
  assert.equal(out.searched, 3);
  assert.equal(out.matched, 2);
  assert.deepEqual(out.results.map((r) => r.workRef), ['WO-1001', 'WO-1000']);
  assert.equal(out.excludedUntraceable.length, 1);
  assert.ok(out.excludedUntraceable[0].findings.includes('KNOWLEDGE_EVIDENCE_REQUIRED'));
  assert.equal(out.results.some((r) => r.tenantId === 'tenant-b'), false);

  const filtered = k.searchKnowledge([newest, older], { tenantId: 'tenant-a', knowledgeClass: 'FIELD_RESOLUTION', text: 'connector', limit: 10 });
  assert.deepEqual(filtered.results.map((r) => r.workRef), ['WO-1000']);

  assert.throws(() => k.searchKnowledge([], {}), /KNOWLEDGE_SEARCH_TENANT_REQUIRED/);
  assert.throws(() => k.searchKnowledge([], { tenantId: 'tenant-a', limit: 0 }), /KNOWLEDGE_LIMIT_INVALID/);
});
