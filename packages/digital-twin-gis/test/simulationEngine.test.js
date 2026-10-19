'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateFailure } = require('../src/simulationEngine');

function fixture() {
  const nodes = [
    { id: 'olt', assetType: 'OLT', parentId: null, status: 'active' },
    { id: 'fdt', assetType: 'FDT', parentId: 'olt', status: 'active' },
    { id: 'fat', assetType: 'FAT', parentId: 'fdt', status: 'degrading' },
    { id: 'ont', assetType: 'ONT', parentId: 'fat', status: 'active' }
  ];
  const edges = [
    { fromAssetId: 'olt', toAssetId: 'fdt', direction: 'directed', active: true },
    { fromAssetId: 'fdt', toAssetId: 'fat', direction: 'directed', active: true },
    { fromAssetId: 'fat', toAssetId: 'ont', direction: 'directed', active: true }
  ];
  const services = [
    { id: 'svc-1', customerRef: 'cust-1', assetPath: { olt: 'olt', fat: 'fat', ont: 'ont' } },
    { id: 'svc-2', customerRef: 'cust-2', assetPath: { ont: 'ont' } }
  ];
  return {
    nodes,
    edges,
    services,
    portsByAsset: {
      olt: [{ status: 'used' }, { status: 'free' }],
      fdt: [{ status: 'used' }],
      fat: [{ status: 'used' }, { status: 'faulty' }]
    }
  };
}

test('simulation is deterministic and produces a stable simulationId', () => {
  const a = simulateFailure({ ...fixture(), failedAssetId: 'fdt' });
  const b = simulateFailure({ ...fixture(), failedAssetId: 'fdt' });
  assert.equal(a.simulationId, b.simulationId);
  assert.equal(a.productionMutation, false);
  assert.equal(a.deterministic, true);
});

test('simulation propagates across physical graph and hierarchy', () => {
  const out = simulateFailure({ ...fixture(), failedAssetId: 'fdt' });
  assert.deepEqual(out.propagation.affectedAssetIds.sort(), ['fat', 'fdt', 'ont']);
  assert.deepEqual(out.affectedServices, ['svc-1', 'svc-2']);
  assert.deepEqual(out.affectedCustomers, ['cust-1', 'cust-2']);
});

test('capacity impact is derived from snapshot port rows', () => {
  const out = simulateFailure({ ...fixture(), failedAssetId: 'fat' });
  assert.equal(out.capacityImpact.occupiedPortsAtRisk, 1);
  assert.equal(out.capacityImpact.faultyPortsAtRisk, 1);
  assert.equal(out.capacityImpact.virtualCapacityLossPorts, 2);
});

test('unknown failure assets are rejected instead of fabricating impact', () => {
  assert.throws(
    () => simulateFailure({ ...fixture(), failedAssetId: 'missing-asset' }),
    /FAILED_ASSET_NOT_IN_SNAPSHOT/
  );
});
