'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const degraded = require('../src/degradedReads');

test('recordDegraded increments a per-label counter', () => {
  degraded.resetForTest();
  degraded.recordDegraded('label.a', new Error('x'));
  degraded.recordDegraded('label.a', new Error('y'));
  degraded.recordDegraded('label.b', new Error('z'));
  assert.equal(degraded.getCount('label.a'), 2);
  assert.equal(degraded.getCount('label.b'), 1);
  assert.equal(degraded.getCount('label.unused'), 0);
});

test('a custom alert handler is invoked with label, occurrence count, and error', () => {
  degraded.resetForTest();
  const seen = [];
  degraded.setAlertHandler((event) => seen.push(event));
  degraded.recordDegraded('label.c', new Error('db down'));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].label, 'label.c');
  assert.equal(seen[0].occurrences, 1);
  assert.equal(seen[0].error, 'db down');
});

test('resetForTest restores the default alert handler', () => {
  degraded.setAlertHandler(() => { throw new Error('should not be called after reset'); });
  degraded.resetForTest();
  // default handler just console.warns; must not throw.
  assert.doesNotThrow(() => degraded.recordDegraded('label.d', new Error('e')));
});
