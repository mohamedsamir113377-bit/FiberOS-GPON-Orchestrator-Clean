'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createZteSnmpDriver, RX_OID, NA_VALUE, NO_SIGNAL_VALUE } = require('../src/zteNms');

test('ZTE RX driver converts 0.001 dBm values and preserves provenance', async () => {
  const driver = createZteSnmpDriver({ sessionFactory: async () => ({ get: async () => [{ oid: `${RX_OID}.7`, value: -18325 }], close() {} }) });
  const out = await driver.pollOpticalPower('7');
  assert.equal(out.valueDbm, -18.325); assert.equal(out.oid, `${RX_OID}.7`); assert.equal(out.rawValue, -18325);
});

test('ZTE RX driver fail-closes sentinel values', async () => {
  for (const raw of [NA_VALUE, NO_SIGNAL_VALUE]) {
    const driver = createZteSnmpDriver({ sessionFactory: async () => ({ get: async () => [{ value: raw }], close() {} }) });
    const out = await driver.pollOpticalPower('1');
    assert.equal(out.valueDbm, null); assert.equal(out.status, 'NO_READING');
  }
});

test('ZTE RX driver rejects non-numeric values', async () => {
  const driver = createZteSnmpDriver({ sessionFactory: async () => ({ get: async () => [{ value: 'not-a-number' }], close() {} }) });
  await assert.rejects(() => driver.pollOpticalPower('1'), { code: 'ERR_ZTE_RX_NON_NUMERIC' });
});

test('ZTE RX driver rejects malformed index', async () => {
  const driver = createZteSnmpDriver({ sessionFactory: async () => ({ get: async () => [{ value: -10000 }], close() {} }) });
  await assert.rejects(() => driver.pollOpticalPower('1 bad'), { code: 'ERR_ZTE_SNMP_INDEX_REQUIRED' });
});
