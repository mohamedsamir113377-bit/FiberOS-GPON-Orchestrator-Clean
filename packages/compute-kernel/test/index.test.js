'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parallelMap } = require('../src');

const fixture = path.join(__dirname, 'worker-fixture.js');

 test('parallelMap preserves input order across worker execution', async () => {
  const result = await parallelMap([1, 2, 3, 4, 5, 6], {
    modulePath: fixture,
    exportName: 'double',
    maxWorkers: 2,
    minItemsForParallel: 1
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10, 12]);
});

test('parallelMap propagates worker failures', async () => {
  await assert.rejects(
    () => parallelMap([1, 0], {
      modulePath: fixture,
      exportName: 'divideOneBy',
      maxWorkers: 2,
      minItemsForParallel: 1
    }),
    /division by zero/
  );
});
