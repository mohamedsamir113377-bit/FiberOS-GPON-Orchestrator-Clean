'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../src/index.js');

function job(overrides = {}) {
  return q.buildReconciliationJob({
    tenantId: 'tenant-a',
    jobKey: 'nightly-gis-vs-field',
    sourcePairs: [['gis', 'field']],
    cadenceMinutes: 1440,
    ...overrides
  });
}

test('a reconciliation job needs explicit tenant, key and source pairs', () => {
  assert.throws(() => q.buildReconciliationJob({ jobKey: 'k', sourcePairs: [['gis', 'field']], cadenceMinutes: 60 }), /RECONCILIATION_TENANT_REQUIRED/);
  assert.throws(() => job({ sourcePairs: [] }), /RECONCILIATION_SOURCE_PAIRS_REQUIRED/);
  assert.throws(() => job({ sourcePairs: [['gis', 'field', 'inventory']] }), /RECONCILIATION_SOURCE_PAIR_INVALID/);
  assert.throws(() => job({ sourcePairs: [['gis', 'spreadsheet']] }), /RECONCILIATION_SOURCE_UNKNOWN/);
  assert.throws(() => job({ sourcePairs: [['gis', 'gis']] }), /RECONCILIATION_SOURCE_PAIR_IDENTICAL/);
  assert.throws(() => job({ cadenceMinutes: 1 }), /RECONCILIATION_CADENCE_INVALID/);
  assert.throws(() => job({ geometryToleranceMeters: -1 }), /RECONCILIATION_TOLERANCE_INVALID/);
});

test('a reconciliation job is content addressed, scoped and never auto-repairing', () => {
  const built = job({ sourcePairs: [['field', 'gis'], ['gis', 'field']] });
  assert.deepEqual(built.sourcePairs.map((pair) => [...pair]), [['field', 'gis']]);
  assert.equal(built.autoRepair, false);
  assert.equal(built.autoResolve, false);
  assert.match(built.jobHash, /^[0-9a-f]{64}$/);
});

test('job due calculation is deterministic and cadence bounded', () => {
  const built = job();
  assert.equal(q.isJobDue(built, { now: '2026-10-07T02:00:00.000Z' }), true);
  assert.equal(q.isJobDue(built, { now: '2026-10-07T02:00:00.000Z', lastRunAt: '2026-10-05T00:00:00.000Z' }), true);
  assert.equal(q.isJobDue(built, { now: '2026-10-07T02:00:00.000Z', lastRunAt: '2026-10-07T01:30:00.000Z' }), false);
  assert.throws(() => q.isJobDue(built, { now: 'yesterday' }), /RECONCILIATION_NOW_INVALID/);
  assert.throws(() => q.isJobDue({}, { now: '2026-10-07T02:00:00.000Z' }), /RECONCILIATION_JOB_REQUIRED/);
});

test('two disagreeing sources are reported as contradicted, never silently resolved', () => {
  const out = q.evaluateContradiction({
    factClass: 'asset.geometry',
    subjectId: 'asset-77',
    observations: [
      { source: 'gis', value: { lat: 30.1, lon: 31.2 }, evidenceIds: ['ev-gis-1'], observedAt: '2026-10-06T00:00:00.000Z' },
      { source: 'field', value: { lat: 30.2, lon: 31.3 }, evidenceIds: ['ev-field-1'], observedAt: '2026-10-07T00:00:00.000Z' }
    ]
  });
  assert.equal(out.status, 'CONTRADICTED');
  assert.equal(out.selected, null);
  assert.equal(out.distinctValueCount, 2);
  assert.equal(out.requiresReview, true);
  assert.equal(out.autoResolved, false);
  assert.equal(out.reason, 'NO_SILENT_CONFLICT_RESOLUTION');
  assert.deepEqual(out.groups.map((group) => group.sources), [['gis'], ['field']]);
});

test('agreeing sources with evidence are consistent, agreeing without evidence are incomplete', () => {
  const consistent = q.evaluateContradiction({
    factClass: 'asset.lifecycle_state',
    subjectId: 'asset-88',
    observations: [
      { source: 'as_built', value: 'LIVE', evidenceIds: ['ev-a'] },
      { source: 'inventory', value: 'LIVE', evidenceIds: ['ev-b'] }
    ]
  });
  assert.equal(consistent.status, 'CONSISTENT');
  assert.equal(consistent.requiresReview, false);
  assert.deepEqual([...consistent.selected.sources], ['as_built', 'inventory']);
  assert.deepEqual([...consistent.selected.evidenceIds], ['ev-a', 'ev-b']);

  const incomplete = q.evaluateContradiction({
    factClass: 'asset.lifecycle_state',
    subjectId: 'asset-88',
    observations: [{ source: 'as_built', value: 'LIVE', evidenceIds: [] }]
  });
  assert.equal(incomplete.status, 'EVIDENCE_INCOMPLETE');
  assert.equal(incomplete.selected, null);
  assert.equal(incomplete.reason, 'EVIDENCE_CHAIN_REQUIRED_BEFORE_TRUTH_PROMOTION');

  const none = q.evaluateContradiction({ factClass: 'asset.lifecycle_state' });
  assert.equal(none.status, 'NO_OBSERVATION');
});

test('a run is scoped to declared sources, deterministic and requires human review', () => {
  const built = job({ sourcePairs: [['gis', 'field']] });
  const run = q.runReconciliationJob({
    job: built,
    now: '2026-10-07T03:00:00.000Z',
    facts: [
      { factClass: 'asset.geometry', subjectId: 'asset-2', observations: [{ source: 'gis', value: 'P1', evidenceIds: ['e1'] }, { source: 'field', value: 'P1', evidenceIds: ['e2'] }] },
      { factClass: 'asset.geometry', subjectId: 'asset-1', observations: [{ source: 'gis', value: 'P1', evidenceIds: ['e1'] }, { source: 'field', value: 'P2', evidenceIds: ['e2'] }] }
    ]
  });
  assert.equal(run.evaluated, 2);
  assert.deepEqual(run.findings.map((finding) => finding.subjectId), ['asset-1', 'asset-2']);
  assert.deepEqual(run.counts, { CONSISTENT: 1, CONTRADICTED: 1 });
  assert.equal(run.findings[0].severity, 'BLOCKING');
  assert.equal(run.autoResolved, false);
  assert.equal(run.requiresHumanReview, true);
  assert.match(run.resultHash, /^[0-9a-f]{64}$/);

  assert.throws(() => q.runReconciliationJob({
    job: built,
    now: '2026-10-07T03:00:00.000Z',
    facts: [{ factClass: 'asset.geometry', subjectId: 'asset-3', observations: [{ source: 'inventory', value: 'P1', evidenceIds: ['e1'] }] }]
  }), /RECONCILIATION_OBSERVATION_OUT_OF_SCOPE/);

  assert.throws(() => q.runReconciliationJob({ job: built, facts: [] }), /RECONCILIATION_RUN_TIME_REQUIRED/);
});
