'use strict';

const { parentPort } = require('node:worker_threads');

if (!parentPort) throw new Error('compute-kernel worker must run inside worker_threads');

function loadHandler(modulePath, exportName) {
  const mod = require(modulePath);
  const handler = exportName ? mod?.[exportName] : mod;
  if (typeof handler !== 'function') {
    throw new TypeError(`Worker export ${exportName || 'default'} from ${modulePath} is not a function`);
  }
  return handler;
}

parentPort.on('message', async (message) => {
  const { id, modulePath, exportName, inputs } = message || {};
  try {
    const handler = loadHandler(modulePath, exportName);
    const results = [];
    for (let i = 0; i < inputs.length; i += 1) results.push(await handler(inputs[i]));
    parentPort.postMessage({ id, ok: true, results });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || null
      }
    });
  }
});
