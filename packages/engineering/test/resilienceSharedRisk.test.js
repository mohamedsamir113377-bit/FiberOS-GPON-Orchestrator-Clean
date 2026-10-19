'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  analyseSharedRiskExposure,
  whatIfResourceFails,
  rankCriticalConcentration,
  sharedRiskGroups,
  enumerateSimplePaths
} = require('../src/resilienceAdvanced');

describe('resilienceAdvanced shared-risk scenario engine', () => {
  const resources = [
    { id: 'cab-1', type: 'main_cabinet', sharedRiskGroup: 'srg-east', criticality: 2, alternativePathAvailable: false },
    { id: 'cab-2', type: 'main_cabinet', sharedRiskGroup: 'srg-east', criticality: 1, alternativePathAvailable: true },
    { id: 'duct-1', type: 'duct', sharedRiskGroup: 'srg-road-a', criticality: 3, alternativePathAvailable: false },
    { id: 'splitter-1', type: 'splitter', sharedRiskGroup: null, criticality: 0, alternativePathAvailable: false },
    { id: 'box-1', type: 'main_box', sharedRiskGroup: null, alternativePathAvailable: true }
  ];

  const dependencies = [
    { id: 'dep-1', customerId: 'c1', serviceId: 's1', resourceIds: ['cab-1', 'duct-1', 'splitter-1'] },
    { id: 'dep-2', customerId: 'c2', serviceId: 's2', resourceIds: ['cab-1', 'duct-1'] },
    { id: 'dep-3', customerId: 'c3', serviceId: 's3', resourceIds: ['cab-2', 'box-1'] },
    { id: 'dep-4', customerId: 'c4', serviceId: 's4', resourceIds: ['duct-1'] }
  ];

  it('ranks resources by structural exposure without inventing probabilities', () => {
    const report = analyseSharedRiskExposure({ resources, dependencies, topN: 5 });
    assert.equal(report.schema, 'fiberos.shared-risk-exposure.v1');
    assert.ok(report.rankedResources.length >= 1);
    // cab-1 and duct-1 should dominate (shared by multiple customers/services)
    const ids = report.rankedResources.map((r) => r.resourceId);
    assert.ok(ids.includes('cab-1') || ids.includes('duct-1'));
    const top = report.rankedResources[0];
    assert.ok(top.exposureScore > 0);
    assert.ok(Array.isArray(report.assumptions));
    assert.ok(report.assumptions.some((a) => /not failure probabilities/i.test(a)));
  });

  it('detects zero path diversity dependencies', () => {
    const report = analyseSharedRiskExposure({ resources, dependencies, topN: 10 });
    assert.ok(report.zeroPathDiversity.length >= 1);
    const single = report.zeroPathDiversity.find((z) => z.dependencyId === 'dep-4');
    assert.ok(single);
    assert.equal(single.diversityScore, 1);
  });

  it('flags resources without acceptable alternative', () => {
    const report = analyseSharedRiskExposure({ resources, dependencies, topN: 10 });
    const noAlt = report.resourcesWithoutAcceptableAlternative.map((r) => r.resourceId);
    assert.ok(noAlt.includes('cab-1') || noAlt.includes('duct-1'));
  });

  it('ranks shared-risk groups deterministically', () => {
    const report = analyseSharedRiskExposure({ resources, dependencies, topN: 10 });
    assert.ok(report.rankedSharedRiskGroups.length >= 1);
    const groups = report.rankedSharedRiskGroups.map((g) => g.sharedRiskGroup);
    assert.ok(groups.includes('srg-east') || groups.includes('srg-road-a'));
  });

  it('whatIfResourceFails returns structural impact only', () => {
    const impact = whatIfResourceFails({ resourceId: 'duct-1', dependencies, resources });
    assert.equal(impact.schema, 'fiberos.what-if-resource-failure.v1');
    assert.equal(impact.failedResourceId, 'duct-1');
    assert.ok(impact.affectedCustomerCount >= 2);
    assert.ok(impact.affectedServiceCount >= 2);
    assert.match(impact.note, /Structural impact only/);
  });

  it('rankCriticalConcentration ranks containers by service×customer product', () => {
    const containers = [
      { id: 'corridor-a', type: 'excavation_corridor', resourceIds: ['duct-1', 'cab-1'] },
      { id: 'corridor-b', type: 'excavation_corridor', resourceIds: ['box-1'] }
    ];
    const ranked = rankCriticalConcentration({ containers, dependencies, topN: 5 });
    assert.equal(ranked.schema, 'fiberos.critical-concentration.v1');
    assert.ok(ranked.ranked.length >= 1);
    assert.equal(ranked.ranked[0].containerId, 'corridor-a');
    assert.ok(ranked.ranked[0].concentrationScore > ranked.ranked[1]?.concentrationScore || ranked.ranked.length === 1);
  });

  it('rejects invalid dependency without resourceIds', () => {
    assert.throws(
      () => analyseSharedRiskExposure({ resources, dependencies: [{ id: 'bad' }] }),
      /resourceIds/
    );
  });

  it('sharedRiskGroups and path enumeration remain stable', () => {
    const edges = [
      { id: 'e1', from: 'A', to: 'B', sharedRiskGroup: 'g1' },
      { id: 'e2', from: 'B', to: 'C', sharedRiskGroup: 'g1' },
      { id: 'e3', from: 'A', to: 'C', sharedRiskGroup: 'g2' }
    ];
    const groups = sharedRiskGroups(edges);
    assert.deepEqual(groups.g1.sort(), ['e1', 'e2']);
    const paths = enumerateSimplePaths({ edges, source: 'A', target: 'C', maxPaths: 10 });
    assert.ok(paths.length >= 2);
  });

  it('is deterministic across repeated calls', () => {
    const a = analyseSharedRiskExposure({ resources, dependencies, topN: 3 });
    const b = analyseSharedRiskExposure({ resources, dependencies, topN: 3 });
    assert.deepEqual(a.rankedResources, b.rankedResources);
    assert.deepEqual(a.rankedSharedRiskGroups, b.rankedSharedRiskGroups);
  });
});

describe('service-path hop dependency bridge', () => {
  const {
    dependenciesFromServicePathHops,
    analyseSharedRiskFromServicePaths
  } = require('../src/resilienceAdvanced');

  const servicePaths = [
    {
      servicePathVersionId: 'spv-1',
      serviceId: 'svc-1',
      customerId: 'cust-1',
      state: 'live',
      hops: [
        { ordinal: 1, fromAssetId: 'olt-1', toAssetId: 'cab-1', relation: 'feeder' },
        { ordinal: 2, fromAssetId: 'cab-1', toAssetId: 'box-1', fromPortId: 'p-1', relation: 'distribution' },
        { ordinal: 3, fromAssetId: 'box-1', toAssetId: 'ont-1', relation: 'drop' }
      ]
    },
    {
      servicePathVersionId: 'spv-2',
      serviceId: 'svc-2',
      customerId: 'cust-2',
      state: 'live',
      hops: [
        { ordinal: 1, fromAssetId: 'olt-1', toAssetId: 'cab-1', relation: 'feeder' },
        { ordinal: 2, fromAssetId: 'cab-1', toAssetId: 'box-2', relation: 'distribution' }
      ]
    },
    {
      servicePathVersionId: 'spv-proposed',
      serviceId: 'svc-3',
      state: 'proposed',
      hops: [{ ordinal: 1, fromAssetId: 'olt-1', toAssetId: 'cab-9', relation: 'feeder' }]
    }
  ];

  const resources = [
    { id: 'olt-1', type: 'olt', sharedRiskGroup: 'srg-headend', alternativePathAvailable: false },
    { id: 'cab-1', type: 'main_cabinet', sharedRiskGroup: 'srg-east', alternativePathAvailable: false },
    { id: 'box-1', type: 'main_box', alternativePathAvailable: true },
    { id: 'box-2', type: 'main_box', alternativePathAvailable: true },
    { id: 'ont-1', type: 'ont', alternativePathAvailable: false },
    { id: 'p-1', type: 'port', alternativePathAvailable: false }
  ];

  it('derives dependencies only from hop identifiers', () => {
    const derived = dependenciesFromServicePathHops({ servicePaths });
    assert.equal(derived.schema, 'fiberos.service-path-dependencies.v1');
    assert.equal(derived.dependencies.length, 2);
    assert.ok(derived.skipped.some((s) => s.reason === 'STATE_NOT_ACCEPTED'));
    const d1 = derived.dependencies.find((d) => d.servicePathVersionId === 'spv-1');
    assert.ok(d1.resourceIds.includes('olt-1'));
    assert.ok(d1.resourceIds.includes('cab-1'));
    assert.ok(d1.resourceIds.includes('box-1'));
    assert.ok(d1.resourceIds.includes('p-1'));
  });

  it('runs shared-risk exposure from real path hops without inventing resources', () => {
    const report = analyseSharedRiskFromServicePaths({ servicePaths, resources, topN: 5 });
    assert.equal(report.schema, 'fiberos.shared-risk-from-service-paths.v1');
    assert.ok(report.exposure.rankedResources.length >= 1);
    const topIds = report.exposure.rankedResources.map((r) => r.resourceId);
    assert.ok(topIds.includes('olt-1') || topIds.includes('cab-1'));
    assert.ok(report.assumptions.some((a) => /hop/i.test(a)));
  });

  it('skips empty hops and does not invent path members', () => {
    const derived = dependenciesFromServicePathHops({
      servicePaths: [{ servicePathVersionId: 'empty', state: 'live', hops: [] }]
    });
    assert.equal(derived.dependencies.length, 0);
    assert.ok(derived.skipped.some((s) => s.reason === 'EMPTY_HOPS'));
  });
});

describe('operational-trace node path → shared-risk pipeline', () => {
  const {
    servicePathsFromTraceNodes,
    analyseSharedRiskFromTraceNodes
  } = require('../src/resilienceAdvanced');

  it('converts consecutive trace node ids into hops without inventing nodes', () => {
    const converted = servicePathsFromTraceNodes({
      traces: [{
        servicePathVersionId: 'spv-t1',
        serviceId: 'svc-t',
        customerId: 'cust-t',
        state: 'live',
        pathNodeIds: ['olt-1', 'cab-1', 'box-1', 'ont-1']
      }]
    });
    assert.equal(converted.schema, 'fiberos.service-paths-from-trace.v1');
    assert.equal(converted.servicePaths.length, 1);
    assert.equal(converted.servicePaths[0].hops.length, 3);
    assert.equal(converted.servicePaths[0].hops[0].fromAssetId, 'olt-1');
    assert.equal(converted.servicePaths[0].hops[2].toAssetId, 'ont-1');
  });

  it('skips traces with fewer than two nodes', () => {
    const converted = servicePathsFromTraceNodes({
      traces: [{ servicePathVersionId: 'spv-x', state: 'live', pathNodeIds: ['only-one'] }]
    });
    assert.equal(converted.servicePaths.length, 0);
    assert.ok(converted.skipped.some((s) => s.reason === 'TRACE_PATH_TOO_SHORT'));
  });

  it('runs full shared-risk analysis from trace nodes', () => {
    const report = analyseSharedRiskFromTraceNodes({
      traces: [{
        servicePathVersionId: 'spv-t2',
        serviceId: 's1',
        customerId: 'c1',
        state: 'live',
        pathNodeIds: ['r1', 'r2', 'r3']
      }],
      resources: [
        { id: 'r1', type: 'olt', sharedRiskGroup: 'g1' },
        { id: 'r2', type: 'cabinet', sharedRiskGroup: 'g1' },
        { id: 'r3', type: 'box' }
      ],
      topN: 5
    });
    assert.equal(report.schema, 'fiberos.shared-risk-from-trace.v1');
    assert.ok(report.exposure.rankedResources.length >= 1);
  });
});
