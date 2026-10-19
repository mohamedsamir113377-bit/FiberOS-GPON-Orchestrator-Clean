'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdapterRegistry, NullVendorAdapter } = require('../src/registry');

test('NullVendorAdapter fails closed without vendor configuration', async () => {
  assert.equal((await NullVendorAdapter.healthCheck()).ok, false);
  assert.deepEqual(await NullVendorAdapter.pollOptical({}), []);
  assert.deepEqual(await NullVendorAdapter.listAssets({}), []);
  assert.deepEqual(await NullVendorAdapter.submitCommand({}), { ok: false, accepted: false, detail: 'NO_VENDOR_CONFIGURED' });
});

test('adapter registry validates, freezes, and retrieves registered adapters', async () => {
  const registry = createAdapterRegistry();
  assert.throws(() => registry.register({ vendorId: 'invalid' }), /ADAPTER_REQUIRES_healthCheck/);
  const adapter = registry.register({ vendorId: 'test-vendor', displayName: 'Test', capabilities: [], healthCheck: async () => ({ ok: true }) });
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(registry.get('test-vendor'), adapter);
  assert.deepEqual(registry.list().map((x) => x.vendorId), ['test-vendor']);
});
