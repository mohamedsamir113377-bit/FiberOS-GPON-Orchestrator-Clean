'use strict';
/**
 * External input adapters for the four capabilities whose computation logic is complete
 * but whose authoritative data must be supplied by the buyer environment.
 *
 * Fail-closed by construction: with no configuration, or with a configured transport that is
 * not bound, the capability reports INTEGRATION_REQUIRED / ADAPTER_UNAVAILABLE and returns no
 * value at all. No defaults, no estimates, no source-copy placeholders.
 */
const reputation = require('./reputation-index.cjs');
const businessWeather = require('./business-weather.cjs');
const arScanner = require('./ar-scanner.cjs');

const STATUS = Object.freeze({
  READY: 'READY',
  INTEGRATION_REQUIRED: 'INTEGRATION_REQUIRED',
  ADAPTER_UNAVAILABLE: 'ADAPTER_UNAVAILABLE',
  INVALID_INPUT: 'INVALID_INPUT',
});

const SPECS = Object.freeze({
  'energy-analytics': {
    requirement: 'Authoritative energy meter readings: cumulative or interval kWh with ISO-8601 timestamps.',
    transports: ['csv', 'http-json', 'postgres'],
    requires: ['readings'],
    forbidden: ['estimated values', 'billing totals without a meter reading'],
  },
  'reputation-index': {
    requirement: 'Indicator observations, each with a named authoritative source and a declared weight.',
    transports: ['http-json', 'postgres'],
    requires: ['definition', 'observations'],
    forbidden: ['survey proxies without a stated source', 'defaulted missing observations'],
  },
  'business-weather': {
    requirement: 'Typed inputs, each with unit, authoritative source, min/max scale, weight and invert flag.',
    transports: ['http-json', 'postgres'],
    requires: ['definitions', 'values'],
    forbidden: ['inputs without a unit', 'imputed values'],
  },
  'ar-scanner': {
    requirement: 'Field capture payloads from registered devices: assetId, GPS fix, accuracy, photo hash, capture time.',
    transports: ['http-json'],
    requires: ['captures'],
    forbidden: ['device-supplied defaults for GPS or serial', 'unsigned photo hashes'],
  },
});

const IDS = Object.keys(SPECS).sort();

function listRequirements() {
  return IDS.map((id) => ({
    id,
    externalInputStatus: STATUS.INTEGRATION_REQUIRED,
    requirement: SPECS[id].requirement,
    acceptedTransports: SPECS[id].transports.slice(),
    requires: SPECS[id].requires.slice(),
    forbidden: SPECS[id].forbidden.slice(),
  }));
}

// Deep shape validation per capability. Returns null when acceptable, otherwise a message.
function validatePayload(id, payload) {
  if (id === 'energy-analytics') {
    if (!Array.isArray(payload.readings)) return 'readings must be an array';
    if (payload.readings.length < 2) return 'at least two readings are required to derive consumption';
    for (let i = 0; i < payload.readings.length; i++) {
      const r = payload.readings[i];
      if (!r || typeof r.kwh !== 'number' || !Number.isFinite(r.kwh)) return 'reading #' + i + ' needs a finite numeric kwh';
      if (typeof r.ts !== 'string' || Number.isNaN(Date.parse(r.ts))) return 'reading #' + i + ' needs an ISO-8601 ts';
    }
    return null;
  }
  if (id === 'reputation-index') {
    const indicators = payload.definition ? payload.definition.indicators : undefined;
    if (!Array.isArray(indicators)) return 'definition.indicators must be an array';
    const v = reputation.validateIndicators(indicators);
    if (!v.ok) return 'invalid indicator definition: ' + v.errors.join('; ');
    if (!payload.observations || typeof payload.observations !== 'object' || Array.isArray(payload.observations)) return 'observations must be an object keyed by indicator id';
    return null;
  }
  if (id === 'business-weather') {
    const d = businessWeather.defineInputs(payload.definitions);
    if (!d.ok) return 'invalid input definitions: ' + d.errors.join('; ');
    if (!payload.values || typeof payload.values !== 'object' || Array.isArray(payload.values)) return 'values must be an object keyed by input id';
    return null;
  }
  if (id === 'ar-scanner') {
    if (!Array.isArray(payload.captures) || payload.captures.length === 0) return 'captures must be a non-empty array';
    for (let i = 0; i < payload.captures.length; i++) {
      const c = arScanner.validateCapture(payload.captures[i], Date.now());
      if (!c.valid) return 'capture #' + i + ': ' + c.errors.join('; ');
    }
    return null;
  }
  return 'no validator for capability ' + id;
}

function createRegistry(config, transports) {
  const cfg = config && typeof config === 'object' ? config : {};
  const tx = transports && typeof transports === 'object' ? transports : {};

  function resolve(id) {
    const spec = SPECS[id];
    if (!spec) return { ok: false, status: STATUS.INVALID_INPUT, code: 'UNKNOWN_CAPABILITY', capability: id };
    const entry = cfg[id];
    if (!entry || entry.configured !== true) {
      return {
        ok: false, status: STATUS.INTEGRATION_REQUIRED, code: 'INTEGRATION_REQUIRED', capability: id,
        requirement: spec.requirement, requires: spec.requires.slice(), forbidden: spec.forbidden.slice(),
        note: 'no authoritative source is configured, so the capability returns no value rather than an estimate',
      };
    }
    const transport = entry.transport;
    if (!spec.transports.includes(transport)) {
      return { ok: false, status: STATUS.INVALID_INPUT, code: 'UNSUPPORTED_TRANSPORT', capability: id, transport };
    }
    const fetcher = tx[transport];
    if (typeof fetcher !== 'function') {
      return { ok: false, status: STATUS.ADAPTER_UNAVAILABLE, code: 'TRANSPORT_NOT_BOUND', capability: id, transport };
    }
    let payload;
    try { payload = fetcher(entry); }
    catch (e) {
      return { ok: false, status: STATUS.ADAPTER_UNAVAILABLE, code: 'TRANSPORT_FAILED', capability: id, transport, reason: String((e && e.message) || e) };
    }
    if (payload === null || payload === undefined) {
      return { ok: false, status: STATUS.INTEGRATION_REQUIRED, code: 'NO_DATA', capability: id, transport };
    }
    return { ok: true, status: STATUS.READY, capability: id, transport, source: entry.source || transport, payload };
  }

  function fetchInput(id) {
    const r = resolve(id);
    if (!r.ok) return r;
    for (const key of SPECS[id].requires) {
      if (!Object.prototype.hasOwnProperty.call(r.payload, key)) {
        return { ok: false, status: STATUS.INVALID_INPUT, code: 'MISSING_FIELD', capability: id, field: key };
      }
    }
    const problem = validatePayload(id, r.payload);
    if (problem) return { ok: false, status: STATUS.INVALID_INPUT, code: 'INVALID_PAYLOAD', capability: id, reason: problem };
    return r;
  }

  return { resolve, fetchInput, requirements: listRequirements() };
}

module.exports = { STATUS, SPECS, IDS, listRequirements, validatePayload, createRegistry };
