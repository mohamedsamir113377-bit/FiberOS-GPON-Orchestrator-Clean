/**
 * PON / OLT telemetry adapter boundary (Master Operating Statement §4.6 / Gap G).
 *
 * Truth boundaries:
 * - This module never opens network sockets and never claims vendor connectivity.
 * - It validates and normalizes *declared* adapter envelopes into internal domain shapes.
 * - Evidence class defaults to "unverified" unless attestation fields prove measured/observed.
 * - Correlation keys (oltId, ponPortId, onuSerial) are identity references only.
 */
export const PON_TELEMETRY_SIGNAL_TYPES = Object.freeze([
  'rx_power',
  'tx_power',
  'los',
  'lof',
  'onu_status',
  'bias_current',
  'temperature',
  'upstream_errors',
  'downstream_errors',
  'flapping'
]);

export const PON_TECHNOLOGIES = Object.freeze([
  'GPON',
  'XG-PON',
  'XGS-PON',
  '50G-PON',
  'OTHER'
]);

const EVIDENCE_CLASSES = new Set([
  'observed',
  'measured',
  'derived',
  'client_declared',
  'simulated',
  'unverified'
]);

function requireString(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`PON_TELEMETRY_${name}_REQUIRED`);
  return v.trim();
}

function optionalString(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function finiteOrNull(v, name) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`PON_TELEMETRY_${name}_NOT_FINITE`);
  return n;
}

/**
 * Validate a static adapter capability declaration for PON telemetry.
 * Read-only: writeOperations must be empty / absent.
 */
export function validatePonAdapterDeclaration(decl) {
  if (!decl || typeof decl !== 'object') throw new Error('PON_ADAPTER_DECLARATION_REQUIRED');
  const vendor = requireString(decl.vendor, 'VENDOR');
  const protocol = requireString(decl.protocol, 'PROTOCOL');
  const model = requireString(decl.model, 'MODEL');
  if (!Array.isArray(decl.supportedSignals) || decl.supportedSignals.length === 0) {
    throw new Error('PON_ADAPTER_SUPPORTED_SIGNALS_REQUIRED');
  }
  for (const s of decl.supportedSignals) {
    if (!PON_TELEMETRY_SIGNAL_TYPES.includes(String(s))) {
      throw new Error(`PON_ADAPTER_UNSUPPORTED_SIGNAL:${s}`);
    }
  }
  if (Array.isArray(decl.writeOperations) && decl.writeOperations.length > 0) {
    throw new Error('PON_ADAPTER_WRITE_OPERATIONS_FORBIDDEN');
  }
  const tech = decl.technology != null ? String(decl.technology) : 'OTHER';
  if (!PON_TECHNOLOGIES.includes(tech)) throw new Error(`PON_ADAPTER_TECHNOLOGY_UNSUPPORTED:${tech}`);

  return Object.freeze({
    schema: 'fiberos.pon-adapter-declaration.v1',
    vendor,
    protocol,
    model,
    firmware: optionalString(decl.firmware),
    technology: tech,
    supportedSignals: Object.freeze(decl.supportedSignals.map(String)),
    readOnly: true,
    connectivityClaimed: false,
    note: 'Declaration only; does not prove that the vendor endpoint is reachable.'
  });
}

/**
 * Normalize a single telemetry sample into an internal observation envelope.
 * Does not contact any device.
 */
export function normalizePonTelemetrySample(
  sample,
  { adapterId = null, trustedSourceRegistry = false, measurementAttested = false } = {}
) {
  if (!sample || typeof sample !== 'object') throw new Error('PON_TELEMETRY_SAMPLE_REQUIRED');
  const signalType = requireString(sample.signalType, 'SIGNAL_TYPE');
  if (!PON_TELEMETRY_SIGNAL_TYPES.includes(signalType)) {
    throw new Error(`PON_TELEMETRY_SIGNAL_UNSUPPORTED:${signalType}`);
  }
  const observedAt = requireString(sample.observedAt, 'OBSERVED_AT');
  if (Number.isNaN(Date.parse(observedAt))) throw new Error('PON_TELEMETRY_OBSERVED_AT_INVALID');

  let evidenceClass = sample.evidenceClass != null ? String(sample.evidenceClass) : 'unverified';
  if (!EVIDENCE_CLASSES.has(evidenceClass)) throw new Error('PON_TELEMETRY_EVIDENCE_CLASS_INVALID');

  // Fail-closed promotion: caller data cannot self-attest authority.
  // Higher layers must explicitly provide verified attestation from an authoritative registry.
  if (evidenceClass === 'measured') {
    if (!sample.instrumentId || !sample.adapterReceipt || measurementAttested !== true) {
      evidenceClass = 'unverified';
    }
  }
  if (evidenceClass === 'observed' && trustedSourceRegistry !== true) {
    evidenceClass = 'unverified';
  }
  if (evidenceClass === 'simulated' || sample.simulation === true) {
    evidenceClass = 'simulated';
  }

  const valueNumeric = finiteOrNull(sample.valueNumeric, 'VALUE_NUMERIC');
  const valueText = optionalString(sample.valueText);

  if (valueNumeric == null && valueText == null) {
    throw new Error('PON_TELEMETRY_VALUE_REQUIRED');
  }

  return Object.freeze({
    schema: 'fiberos.pon-telemetry-observation.v1',
    adapterId: adapterId != null ? String(adapterId) : optionalString(sample.adapterId),
    signalType,
    valueNumeric,
    valueText,
    unit: optionalString(sample.unit),
    observedAt,
    evidenceClass,
    correlation: Object.freeze({
      oltId: optionalString(sample.oltId),
      ponPortId: optionalString(sample.ponPortId),
      onuSerial: optionalString(sample.onuSerial),
      onuId: optionalString(sample.onuId),
      externalResourceKey: optionalString(sample.externalResourceKey)
    }),
    technology: sample.technology != null && PON_TECHNOLOGIES.includes(String(sample.technology))
      ? String(sample.technology)
      : null,
    instrumentId: optionalString(sample.instrumentId),
    adapterReceipt: optionalString(sample.adapterReceipt),
    deviceIdentity: optionalString(sample.deviceIdentity),
    connectivityProven: false,
    authorityAttested: evidenceClass === 'measured' || evidenceClass === 'observed',
    note: 'Normalized observation only; vendor connectivity is not asserted by this boundary.'
  });
}

/**
 * Normalize a batch. Invalid samples are collected under rejected[] without inventing values.
 */
export function normalizePonTelemetryBatch(samples, options = {}) {
  if (!Array.isArray(samples)) throw new TypeError('PON_TELEMETRY_BATCH_MUST_BE_ARRAY');
  const accepted = [];
  const rejected = [];
  samples.forEach((sample, index) => {
    try {
      accepted.push(normalizePonTelemetrySample(sample, options));
    } catch (err) {
      rejected.push(
        Object.freeze({
          index,
          reason: err && err.message ? String(err.message) : 'NORMALIZE_FAILED'
        })
      );
    }
  });
  return Object.freeze({
    schema: 'fiberos.pon-telemetry-batch.v1',
    accepted: Object.freeze(accepted),
    rejected: Object.freeze(rejected),
    connectivityProven: false
  });
}

/**
 * Build a correlation hint from a normalized observation to network resource keys.
 * Returns only the keys present; never fabricates resource UUIDs.
 */
export function correlationKeysFromObservation(observation) {
  if (!observation || observation.schema !== 'fiberos.pon-telemetry-observation.v1') {
    throw new Error('PON_TELEMETRY_OBSERVATION_REQUIRED');
  }
  const c = observation.correlation || {};
  const keys = [];
  if (c.oltId) keys.push({ resourceType: 'olt', externalKey: c.oltId });
  if (c.ponPortId) keys.push({ resourceType: 'pon_port', externalKey: c.ponPortId });
  if (c.onuSerial) keys.push({ resourceType: 'ont', externalKey: c.onuSerial });
  if (c.onuId) keys.push({ resourceType: 'ont', externalKey: c.onuId });
  if (c.externalResourceKey) {
    keys.push({ resourceType: 'external', externalKey: c.externalResourceKey });
  }
  return Object.freeze({
    schema: 'fiberos.pon-correlation-keys.v1',
    keys: Object.freeze(keys),
    evidenceClass: observation.evidenceClass,
    note: 'Keys are external identifiers only; internal UUID resolution is a separate authoritative step.'
  });
}
