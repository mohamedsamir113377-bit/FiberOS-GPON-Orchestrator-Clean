'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHierarchy } = require('../src');

test('hierarchy rejects missing and duplicate IDs and dangling parents', () => {
  assert.throws(() => buildHierarchy([{ assetType: 'OLT' }]), /INVALID_HIERARCHY_NODE_ID/);
  assert.throws(() => buildHierarchy([{ id: 'a', assetType: 'OLT' }, { id: 'a', assetType: 'FDT' }]), /DUPLICATE_HIERARCHY_NODE_ID/);
  assert.throws(() => buildHierarchy([{ id: 'child', assetType: 'ONT', parentId: 'missing' }]), /HIERARCHY_PARENT_NOT_FOUND/);
});

test('hierarchy rejects cycles and preserves valid parent paths', () => {
  assert.throws(() => buildHierarchy([{ id: 'a', assetType: 'OLT', parentId: 'b' }, { id: 'b', assetType: 'FDT', parentId: 'a' }]), /HIERARCHY_CYCLE_DETECTED/);
  const tree = buildHierarchy([{ id: 'olt', assetType: 'OLT' }, { id: 'fdt', assetType: 'FDT', parentId: 'olt' }, { id: 'ont', assetType: 'ONT', parentId: 'fdt' }]);
  assert.deepEqual(tree.pathToRoot('ont').map(node => node.id), ['ont', 'fdt', 'olt']);
});
