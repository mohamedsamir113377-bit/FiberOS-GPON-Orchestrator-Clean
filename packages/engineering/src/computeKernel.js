'use strict';

const path = require('node:path');
// Intentional workspace-package boundary: this keeps the engineering package
// coupled to the published compute-kernel contract, not to its source path.
const { parallelMap } = require('@fiberos/compute-kernel');
const opticalPhysics = require('./opticalPhysics');
const opticalSolver = require('./opticalSolver');

const OPTICAL_MODULE = path.join(__dirname, 'computeKernelHandlers.js');

async function parallelLinkBudgets(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array');
  return parallelMap(inputs, {
    modulePath: OPTICAL_MODULE,
    exportName: 'linkBudget',
    handler: opticalPhysics.linkBudget,
    ...options
  });
}

async function parallelSolvePaths(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array');
  return parallelMap(inputs, {
    modulePath: OPTICAL_MODULE,
    exportName: 'solvePath',
    handler: opticalSolver.solvePath,
    ...options
  });
}

module.exports = Object.freeze({ parallelLinkBudgets, parallelSolvePaths });
