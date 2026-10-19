'use strict';

const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, 'worker.js');
const DEFAULT_MAX_WORKERS = Math.max(1, (os.availableParallelism?.() || os.cpus().length || 1) - 1);
const DEFAULT_QUEUE_LIMIT = 10000;

function integer(value, name, { min = 0 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new RangeError(`${name} must be an integer >= ${min}`);
  return n;
}

function positiveInteger(value, name) {
  return integer(value, name, { min: 1 });
}

/**
 * Parallel deterministic execution boundary.
 * Inputs are partitioned into contiguous batches so each worker is created
 * once per invocation instead of once per item. Result order is preserved.
 * A future WASM/native implementation can replace this boundary without
 * changing the engineering-facing API.
 */
async function parallelMap(inputs, {
  modulePath,
  exportName = 'default',
  maxWorkers = DEFAULT_MAX_WORKERS,
  queueLimit = DEFAULT_QUEUE_LIMIT,
  minItemsForParallel = 4,
  handler
} = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array');
  if (!inputs.length) return [];
  if (typeof modulePath !== 'string' || !modulePath) throw new TypeError('modulePath is required');
  const workers = Math.min(positiveInteger(maxWorkers, 'maxWorkers'), inputs.length);
  const limit = positiveInteger(queueLimit, 'queueLimit');
  const threshold = integer(minItemsForParallel, 'minItemsForParallel', { min: 1 });
  if (inputs.length > limit) throw new RangeError(`inputs exceeds queueLimit=${limit}`);
  if (typeof handler === 'function' && (workers === 1 || inputs.length < threshold)) return inputs.map(handler);

  if (workers === 1) {
    const local = require(modulePath);
    const fn = local?.[exportName];
    if (typeof fn !== 'function') throw new TypeError(`Local export ${exportName} from ${modulePath} is not a function`);
    return inputs.map(fn);
  }

  const results = new Array(inputs.length);
  const batchSize = Math.ceil(inputs.length / workers);

  const runBatch = (workerId, start, end) => new Promise((resolve, reject) => {
    // Node 24 rejects several parent execArgv values inside a Worker, even
    // when those flags are valid for the parent process. Keep workers portable.
    const worker = new Worker(WORKER_PATH, { execArgv: [] });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      Promise.resolve(worker.terminate()).finally(() => fn(value));
    };
    worker.once('message', (message) => {
      if (!message?.ok) {
        const err = new Error(message?.error?.message || 'Worker computation failed');
        err.name = message?.error?.name || 'Error';
        if (message?.error?.stack) err.stack = message.error.stack;
        return finish(reject, err);
      }
      if (!Array.isArray(message.results) || message.results.length !== end - start) return finish(reject, new Error('compute-kernel worker result length mismatch'));
      for (let i = 0; i < message.results.length; i += 1) results[start + i] = message.results[i];
      finish(resolve, undefined);
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`compute-kernel worker ${workerId} exited with code ${code}`));
    });
    worker.postMessage({ id: workerId, modulePath, exportName, inputs: inputs.slice(start, end) });
  });

  const jobs = [];
  for (let workerId = 0; workerId < workers; workerId += 1) {
    const start = workerId * batchSize;
    const end = Math.min(inputs.length, start + batchSize);
    if (start >= end) break;
    jobs.push(runBatch(workerId, start, end));
  }
  await Promise.all(jobs);
  return results;
}

module.exports = Object.freeze({ parallelMap, DEFAULT_MAX_WORKERS, DEFAULT_QUEUE_LIMIT });
