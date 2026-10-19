'use strict';

function safeCode(error, fallback) {
  return error && typeof error.code === 'string' && error.code ? error.code : fallback;
}

function write(level, event, fields) {
  const payload = Object.assign({
    timestamp: new Date().toISOString(),
    level,
    event
  }, fields || {});
  process.stderr.write(JSON.stringify(payload) + '\n');
}

function info(event, fields) { write('INFO', event, fields); }
function warn(event, fields) { write('WARN', event, fields); }
function error(event, fields) { write('ERROR', event, fields); }

module.exports = { info, warn, error, safeCode };
