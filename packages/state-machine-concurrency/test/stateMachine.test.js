import test from 'node:test';
import assert from 'node:assert/strict';
import { executeOnce } from '../src/stateMachine.js';

test('executeOnce normalizes Set and JSON-rehydrated array records', () => {
  const first = executeOnce({ executions: new Set(['old']) }, 'new');
  assert.deepEqual(first.executions, ['old', 'new']);
  assert.equal(Object.isFrozen(first.executions), true);
  assert.equal(Object.isFrozen(first), true);
  const rehydrated = JSON.parse(JSON.stringify(first));
  assert.throws(() => executeOnce(rehydrated, 'new'), /DUPLICATE_EXECUTION/);
  assert.deepEqual(executeOnce(rehydrated, 'next').executions, ['old', 'new', 'next']);
});

test('executeOnce rejects malformed persisted execution representations', () => {
  assert.throws(() => executeOnce({ executions: 'not-an-array' }, 'x'), /EXECUTION_RECORD_INVALID/);
  assert.throws(() => executeOnce({ executions: [1] }, 'x'), /EXECUTION_RECORD_INVALID/);
});
