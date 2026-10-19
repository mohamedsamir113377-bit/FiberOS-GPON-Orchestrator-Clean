'use strict';

const fs = require('node:fs');

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function readRedisUrl(env) {
  env = env || process.env;
  let value = String(env.REDIS_URL || '').trim();
  if (!value && env.REDIS_URL_FILE) {
    const file = String(env.REDIS_URL_FILE).trim();
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > 8192) throw new Error('invalid secret file');
      value = fs.readFileSync(file, 'utf8').trim();
    } catch (_) {
      throw codedError('REDIS_RATE_LIMIT_URL_FILE_INVALID');
    }
  }
  if (!value) throw codedError('REDIS_RATE_LIMIT_REQUIRES_REDIS_URL');
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw codedError('REDIS_RATE_LIMIT_URL_INVALID'); }
  if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname) {
    throw codedError('REDIS_RATE_LIMIT_URL_INVALID');
  }
  return value;
}

module.exports = Object.freeze({ readRedisUrl });
