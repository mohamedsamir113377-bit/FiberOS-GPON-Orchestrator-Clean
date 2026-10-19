'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeKernel } = require('../src');
const opticalPhysics = require('../src/opticalPhysics');
const opticalSolver = require('../src/opticalSolver');

const cases = [
  { txDbm: 0, receiverSensitivityDbm: -28, lengthKm: 1, fiberAttenuationDbPerKm: 0.35 },
  { txDbm: 1, receiverSensitivityDbm: -28, lengthKm: 2, fiberAttenuationDbPerKm: 0.32 },
  { txDbm: 2, receiverSensitivityDbm: -27, lengthKm: 3, fiberAttenuationDbPerKm: 0.30 }
];

test('parallel link-budget adapter preserves deterministic results and order', async () => {
  const serial = cases.map(opticalPhysics.linkBudget);
  const parallel = await computeKernel.parallelLinkBudgets(cases, { maxWorkers: 2, minItemsForParallel: 1 });
  assert.deepEqual(parallel, serial);
});

test('parallel path-solver adapter preserves deterministic results and order', async () => {
  const inputs = cases.map((x, i) => ({
    segments: [{ id: `s${i}`, lengthKm: x.lengthKm, attenuationDbPerKm: x.fiberAttenuationDbPerKm, lossDb: 0, stdDb: 0.1 }],
    txDbm: x.txDbm,
    receiverSensitivityDbm: x.receiverSensitivityDbm,
    requiredMarginDb: 0
  }));
  const serial = inputs.map(opticalSolver.solvePath);
  const parallel = await computeKernel.parallelSolvePaths(inputs, { maxWorkers: 2, minItemsForParallel: 1 });
  assert.deepEqual(parallel, serial);
});
