import test from 'node:test';
import assert from 'node:assert/strict';
import { READ_ONLY_OPERATIONS, validateAdapterContract, attestMeasurement } from '../src/index.js';

const base = {
  vendor: 'Acme', device: 'OLT-1', model: 'X100', firmware: '1.2.3',
  protocol: 'NETCONF', capabilities: 'identity,measurement',
  readOperations: [...READ_ONLY_OPERATIONS]
};

test('accepts a valid read-only adapter contract', () => assert.equal(validateAdapterContract(base), true));
test('rejects a missing adapter', () => assert.throws(() => validateAdapterContract(null), /ADAPTER_REQUIRED/));
test('rejects a missing required adapter field', () => assert.throws(() => validateAdapterContract({ ...base, vendor: '' }), /ADAPTER_VENDOR_REQUIRED/));
test('rejects unsupported or mutating read operations', () => assert.throws(() => validateAdapterContract({ ...base, readOperations: ['deleteDevice'] }), /UNSUPPORTED_OR_MUTATING_OPERATION/));
test('rejects write operations during read-only phase', () => assert.throws(() => validateAdapterContract({ ...base, writeOperations: ['reboot'] }), /READ_ONLY_PHASE_WRITE_OPERATION_FORBIDDEN/));
test('attests a southbound measurement as measured', () => {
  const receipt = { source: 'southbound_adapter', adapterReceipt: 'r-1', observedAt: '2026-09-25T12:00:00Z', deviceIdentity: 'olt-1', instrumentId: 'probe-1' };
  assert.equal(attestMeasurement(receipt).classification, 'measured');
});

import {
  validatePonAdapterDeclaration,
  normalizePonTelemetrySample,
  normalizePonTelemetryBatch,
  correlationKeysFromObservation,
  PON_TELEMETRY_SIGNAL_TYPES
} from '../src/index.js';

test('validatePonAdapterDeclaration accepts read-only PON declaration', () => {
  const d = validatePonAdapterDeclaration({
    vendor: 'Acme',
    protocol: 'NETCONF',
    model: 'OLT-X',
    technology: 'XGS-PON',
    supportedSignals: ['rx_power', 'los'],
    firmware: '1.0.0'
  });
  assert.equal(d.readOnly, true);
  assert.equal(d.connectivityClaimed, false);
  assert.equal(d.technology, 'XGS-PON');
});

test('validatePonAdapterDeclaration rejects write operations', () => {
  assert.throws(() => validatePonAdapterDeclaration({
    vendor: 'Acme', protocol: 'SNMP', model: 'X', supportedSignals: ['rx_power'], writeOperations: ['set']
  }), /WRITE_OPERATIONS_FORBIDDEN/);
});

test('normalizePonTelemetrySample fails closed without measured proof', () => {
  const o = normalizePonTelemetrySample({
    signalType: 'rx_power',
    valueNumeric: -21.5,
    unit: 'dBm',
    observedAt: '2026-10-07T12:00:00.000Z',
    evidenceClass: 'measured',
    oltId: 'olt-1',
    ponPortId: 'pon-17'
  });
  assert.equal(o.evidenceClass, 'unverified');
  assert.equal(o.connectivityProven, false);
  assert.equal(o.correlation.oltId, 'olt-1');
});

test('normalizePonTelemetrySample accepts measured with receipt', () => {
  const o = normalizePonTelemetrySample({
    signalType: 'los',
    valueText: 'LOS',
    observedAt: '2026-10-07T12:00:00.000Z',
    evidenceClass: 'measured',
    instrumentId: 'inst-1',
    adapterReceipt: 'rcpt-1',
    onuSerial: 'SN123'
  }, { measurementAttested: true });
  assert.equal(o.evidenceClass, 'measured');
  assert.equal(o.signalType, 'los');
});

test('observed telemetry cannot self-promote from a caller flag', () => {
  const forged = normalizePonTelemetrySample({
    signalType: 'onu_status', valueText: 'online',
    observedAt: '2026-10-07T12:00:00.000Z', evidenceClass: 'observed', sourceTrusted: true
  });
  assert.equal(forged.evidenceClass, 'unverified');
  const trusted = normalizePonTelemetrySample({
    signalType: 'onu_status', valueText: 'online',
    observedAt: '2026-10-07T12:00:00.000Z', evidenceClass: 'observed'
  }, { trustedSourceRegistry: true });
  assert.equal(trusted.evidenceClass, 'observed');
  assert.equal(trusted.authorityAttested, true);
});

test('measured telemetry cannot self-promote from an adapter receipt alone', () => {
  const forged = normalizePonTelemetrySample({
    signalType: 'rx_power', valueNumeric: -20,
    observedAt: '2026-10-07T12:00:00.000Z', evidenceClass: 'measured',
    instrumentId: 'inst-1', adapterReceipt: 'rcpt-1'
  });
  assert.equal(forged.evidenceClass, 'unverified');
});

test('normalizePonTelemetryBatch collects rejects without inventing values', () => {
  const batch = normalizePonTelemetryBatch([
    { signalType: 'rx_power', valueNumeric: -20, observedAt: '2026-10-07T12:00:00.000Z' },
    { signalType: 'not_a_signal', valueNumeric: 1, observedAt: '2026-10-07T12:00:00.000Z' }
  ]);
  assert.equal(batch.accepted.length, 1);
  assert.equal(batch.rejected.length, 1);
  assert.equal(batch.connectivityProven, false);
});

test('correlationKeysFromObservation returns only present external keys', () => {
  const o = normalizePonTelemetrySample({
    signalType: 'onu_status',
    valueText: 'online',
    observedAt: '2026-10-07T12:00:00.000Z',
    oltId: 'olt-9',
    onuSerial: 'ABC'
  });
  const keys = correlationKeysFromObservation(o);
  assert.ok(keys.keys.some((k) => k.resourceType === 'olt' && k.externalKey === 'olt-9'));
  assert.ok(keys.keys.some((k) => k.resourceType === 'ont' && k.externalKey === 'ABC'));
  assert.ok(PON_TELEMETRY_SIGNAL_TYPES.includes('rx_power'));
});
