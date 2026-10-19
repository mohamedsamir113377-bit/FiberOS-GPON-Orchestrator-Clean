'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { handleRealityBoundary } = require('../src/routes/realityBoundary');
const resilience = require('../../../packages/engineering/src/resilienceAdvanced');

describe('reality boundary surfaces', () => {
  it('assesses optical assurance with path binding via boundary route', async () => {
    const out = await handleRealityBoundary('/v1/reality-boundary/optical-assurance', {
      currentRxDbm: -22,
      expectedRxDbm: -20,
      servicePathVersionId: 'spv-1',
      pathHopOrdinals: [1, 2]
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.authority, 'BOUNDARY_ADVISORY');
    assert.equal(out.body.result.pathBound, true);
    assert.equal(out.body.result.forecasted, false);
  });

  it('compiles optical ledger record only with path version', async () => {
    const assessment = (await handleRealityBoundary('/v1/reality-boundary/optical-assurance', {
      currentRxDbm: -21,
      expectedRxDbm: -20,
      servicePathVersionId: 'spv-2'
    })).body.result;
    const out = await handleRealityBoundary('/v1/reality-boundary/optical-assurance-ledger', {
      tenantId: 't1',
      servicePathVersionId: 'spv-2',
      assessment,
      evidenceIds: ['e1']
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.result.schema, 'fiberos.optical-assurance-ledger-record.v1');
  });

  it('refuses ledger compile without path version', async () => {
    const assessment = (await handleRealityBoundary('/v1/reality-boundary/optical-assurance', {
      currentRxDbm: -20,
      expectedRxDbm: -20
    })).body.result;
    const out = await handleRealityBoundary('/v1/reality-boundary/optical-assurance-ledger', {
      tenantId: 't1',
      assessment,
      evidenceIds: []
    });
    assert.ok(out.status >= 400);
  });

  it('normalizes PON sample without claiming connectivity', async () => {
    const out = await handleRealityBoundary('/v1/reality-boundary/pon-telemetry-sample', {
      signalType: 'rx_power',
      valueNumeric: -20.5,
      observedAt: '2026-10-08T00:00:00.000Z',
      oltId: 'olt-1'
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.result.connectivityProven, false);
    assert.equal(out.body.result.evidenceClass, 'unverified');
  });

  it('validates PON adapter declaration as read-only', async () => {
    const out = await handleRealityBoundary('/v1/reality-boundary/pon-adapter-declaration', {
      vendor: 'Acme',
      protocol: 'NETCONF',
      model: 'OLT-X',
      technology: 'XGS-PON',
      supportedSignals: ['rx_power', 'los']
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.result.connectivityClaimed, false);
    assert.equal(out.body.result.readOnly, true);
  });

  it('rejects unknown reality-boundary endpoint', async () => {
    const out = await handleRealityBoundary('/v1/reality-boundary/not-a-thing', {});
    assert.equal(out.status, 404);
  });
});

describe('engineering shared-risk path bridge (package-level)', () => {
  it('shared-risk-from-service-paths derives exposure from hops only', () => {
    const result = resilience.analyseSharedRiskFromServicePaths({
      servicePaths: [{
        servicePathVersionId: 'spv-1',
        serviceId: 's1',
        customerId: 'c1',
        state: 'live',
        hops: [
          { ordinal: 1, fromAssetId: 'a1', toAssetId: 'a2' },
          { ordinal: 2, fromAssetId: 'a2', toAssetId: 'a3' }
        ]
      }],
      resources: [
        { id: 'a1', type: 'olt', sharedRiskGroup: 'g1' },
        { id: 'a2', type: 'cabinet', sharedRiskGroup: 'g1' },
        { id: 'a3', type: 'box' }
      ],
      topN: 3
    });
    assert.equal(result.schema, 'fiberos.shared-risk-from-service-paths.v1');
    assert.ok(result.exposure.rankedResources.length >= 1);
  });
});
