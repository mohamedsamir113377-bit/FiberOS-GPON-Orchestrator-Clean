'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/index');

test('optimisticUpdate accepts matching version and rejects a stale one', () => {
  assert.equal(c.optimisticUpdate({ currentVersion: 3, expectedVersion: 3 }).ok, true);
  const stale = c.optimisticUpdate({ currentVersion: 4, expectedVersion: 3 });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'VERSION_CONFLICT');
});

test('intervalsOverlap uses half-open semantics', () => {
  assert.equal(c.intervalsOverlap([0, 10], [5, 15]), true);
  assert.equal(c.intervalsOverlap([0, 10], [10, 20]), false);
});

test('findExclusionConflicts flags double-booked technicians only', () => {
  const r = c.findExclusionConflicts([
    { id: 'A', ownerId: 'T1', start: 0, end: 60, status: 'ACTIVE' },
    { id: 'B', ownerId: 'T1', start: 30, end: 90, status: 'ACTIVE' },
    { id: 'C', ownerId: 'T2', start: 30, end: 90, status: 'ACTIVE' }
  ]);
  assert.equal(r.conflictFree, false);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].ownerId, 'T1');
});

test('detectDeadlock finds a wait-for cycle', () => {
  const r = c.detectDeadlock([{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }]);
  assert.equal(r.deadlock, true);
  assert.ok(r.cycle.length >= 3);
  assert.equal(c.detectDeadlock([{ from: 'A', to: 'B' }]).deadlock, false);
});

test('canonicalLockOrder is deterministic', () => {
  assert.deepEqual(c.canonicalLockOrder(['z', 'a', 'm']), ['a', 'm', 'z']);
});

test('isolationPolicy describes SERIALIZABLE guarantees', () => {
  const p = c.isolationPolicy('SERIALIZABLE');
  assert.equal(p.preventsWriteSkew, true);
  assert.equal(p.requiresRetry, true);
  assert.throws(() => c.isolationPolicy('NONSENSE'));
});
