'use strict';

function deepFreeze(value, seen) {
  if (!value || typeof value !== 'object') return value;
  seen = seen || new Set();
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function createMicroCache(options) {
  options = options || {};
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : 1024;
  const values = new Map();
  function set(key, value) {
    const k = String(key);
    if (values.has(k)) values.delete(k);
    values.set(k, deepFreeze(value));
    while (values.size > maxEntries) values.delete(values.keys().next().value);
    return values.get(k);
  }
  function get(key) { return values.get(String(key)); }
  function invalidate(key) { return values.delete(String(key)); }
  function invalidateMany(keys) { let count = 0; for (const key of keys || []) if (invalidate(key)) count++; return count; }
  function clear() { values.clear(); }
  return Object.freeze({ get, set, invalidate, invalidateMany, clear, get size() { return values.size; } });
}

module.exports = Object.freeze({ createMicroCache, deepFreeze });
