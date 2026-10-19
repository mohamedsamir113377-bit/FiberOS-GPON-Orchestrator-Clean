'use strict';

/**
 * Request consumption guards — OWASP API4:2023 Unrestricted Resource Consumption
 * (public OWASP guidance). Process-local caps only; Redis multi-instance remains
 * a deployment concern already documented in httpHardening.
 */

const DEFAULTS = Object.freeze({
  maxBodyBytes: 256 * 1024,
  maxArrayLength: 200,
  maxStringLength: 4000,
  maxJsonDepth: 12
});

function assertBodySize(rawLength, maxBodyBytes = DEFAULTS.maxBodyBytes) {
  const n = Number(rawLength);
  if (Number.isFinite(n) && n > maxBodyBytes) {
    const e = new Error('REQUEST_BODY_TOO_LARGE');
    e.code = 'REQUEST_BODY_TOO_LARGE';
    e.statusCode = 413;
    e.maxBodyBytes = maxBodyBytes;
    throw e;
  }
  return true;
}

function walkLimits(value, depth, limits, path) {
  if (depth > limits.maxJsonDepth) {
    const e = new Error('REQUEST_JSON_TOO_DEEP');
    e.code = 'REQUEST_JSON_TOO_DEEP';
    e.statusCode = 400;
    throw e;
  }
  if (value == null) return;
  if (typeof value === 'string') {
    if (value.length > limits.maxStringLength) {
      const e = new Error('REQUEST_STRING_TOO_LONG');
      e.code = 'REQUEST_STRING_TOO_LONG';
      e.statusCode = 400;
      e.path = path;
      throw e;
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) {
      const e = new Error('REQUEST_ARRAY_TOO_LONG');
      e.code = 'REQUEST_ARRAY_TOO_LONG';
      e.statusCode = 400;
      e.path = path;
      e.maxArrayLength = limits.maxArrayLength;
      throw e;
    }
    value.forEach((item, i) => walkLimits(item, depth + 1, limits, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walkLimits(v, depth + 1, limits, path ? `${path}.${k}` : k);
    }
  }
}

function assertRequestConsumption(body, options = {}) {
  const limits = Object.freeze({
    maxBodyBytes: options.maxBodyBytes || DEFAULTS.maxBodyBytes,
    maxArrayLength: options.maxArrayLength || DEFAULTS.maxArrayLength,
    maxStringLength: options.maxStringLength || DEFAULTS.maxStringLength,
    maxJsonDepth: options.maxJsonDepth || DEFAULTS.maxJsonDepth
  });
  if (options.rawLength != null) assertBodySize(options.rawLength, limits.maxBodyBytes);
  walkLimits(body, 0, limits, '');
  return Object.freeze({ ok: true, limits });
}

module.exports = {
  DEFAULTS,
  assertBodySize,
  assertRequestConsumption
};
