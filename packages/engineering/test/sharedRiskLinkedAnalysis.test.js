'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  analyseLinkedSharedRisk,
  collectResourceIdsFromPaths,
  loadLinkedServicePaths
} = require('../src/sharedRiskLinkedAnalysis');

function mockClient(handlers) {
  return {
    async query(text, values) {
      for (const h of handlers) {
        if (h.match(text)) return h.respond(text, values || []);
      }
      const err = new Error('relation "unknown" does not exist');
      err.code = '42P01';
      throw err;
    }
  };
}

const PATH_V = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SVC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const A2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const A3 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('linked shared-risk analysis', () => {
  it('collects resource ids from hops only', () => {
    const ids = collectResourceIdsFromPaths([
      {
        hops: [
          { fromAssetId: A1, toAssetId: A2 },
          { fromAssetId: A2, toAssetId: A3, fromPortId: A1 }
        ]
      }
    ]);
    assert.ok(ids.includes(A1));
    assert.ok(ids.includes(A2));
    assert.ok(ids.includes(A3));
  });

  it('returns NOT_AVAILABLE when service-path schema is missing', async () => {
    const client = mockClient([
      {
        match: (t) => t.includes('network_service_path_versions'),
        respond: () => {
          const err = new Error('relation "network_service_path_versions" does not exist');
          err.code = '42P01';
          throw err;
        }
      }
    ]);
    const report = await analyseLinkedSharedRisk(client, { topN: 5 });
    assert.equal(report.schema, 'fiberos.linked-shared-risk.v1');
    assert.equal(report.available, false);
    assert.equal(report.reason, 'SERVICE_PATH_SCHEMA_NOT_AVAILABLE');
    assert.equal(report.exposure, null);
  });

  it('analyses linked paths from authoritative hop rows', async () => {
    const client = mockClient([
      {
        match: (t) => t.includes('network_service_path_versions') && t.includes('JOIN services'),
        respond: () => ({
          rows: [
            {
              service_path_version_id: PATH_V,
              service_id: SVC,
              state: 'live',
              customer_id: 'cust-1',
              hop_count: 2
            }
          ]
        })
      },
      {
        match: (t) => t.includes('FROM network_service_path_hops'),
        respond: () => ({
          rows: [
            {
              service_path_version_id: PATH_V,
              ordinal: 1,
              from_asset_id: A1,
              to_asset_id: A2,
              from_port_id: null,
              to_port_id: null,
              from_core_id: null,
              to_core_id: null,
              relation: 'feeder'
            },
            {
              service_path_version_id: PATH_V,
              ordinal: 2,
              from_asset_id: A2,
              to_asset_id: A3,
              from_port_id: null,
              to_port_id: null,
              from_core_id: null,
              to_core_id: null,
              relation: 'drop'
            }
          ]
        })
      },
      {
        match: (t) => t.includes('FROM network_assets'),
        respond: () => ({
          rows: [
            { id: A1, asset_type: 'OLT', asset_code: 'OLT-1' },
            { id: A2, asset_type: 'FDT', asset_code: 'CAB-1' },
            { id: A3, asset_type: 'ONT', asset_code: 'ONT-1' }
          ]
        })
      },
      {
        match: (t) => t.includes('network_failure_domain_members'),
        respond: () => ({
          rows: [
            {
              resource_id: A2,
              domain_key: 'srg-east',
              criticality: 2,
              alternative_path_available: false
            }
          ]
        })
      },
      {
        match: (t) => t.includes('physical_topology_edges') && t.includes('shared_risk_group'),
        respond: () => ({
          rows: [
            { from_asset_id: A1, to_asset_id: A2, shared_risk_group: 'srg-feeder' }
          ]
        })
      },
      {
        match: (t) => t.includes('contains') || t.includes('duct'),
        respond: () => ({ rows: [] })
      }
    ]);

    const report = await analyseLinkedSharedRisk(client, {
      topN: 5,
      whatIfResourceId: A2
    });
    assert.equal(report.available, true);
    assert.equal(report.authority, 'POSTGRESQL_RLS_SESSION');
    assert.equal(report.linkage.pathCount, 1);
    assert.ok(report.exposure.exposure.rankedResources.length >= 1);
    assert.equal(report.whatIf.failedResourceId, A2);
    assert.ok(report.whatIf.affectedServiceCount >= 1);
    // A2 should carry failure-domain group
    const a2 = report.exposure.exposure.rankedResources.find((r) => r.resourceId === A2)
      || report.exposure.pathDerivation.dependencies[0];
    assert.ok(a2);
  });

  it('fails closed when hop completeness exceeds the safety bound', async () => {
    const client = mockClient([{
      match: (t) => t.includes('network_service_path_versions') && t.includes('JOIN services'),
      respond: () => ({ rows: [{
        service_path_version_id: PATH_V,
        service_id: SVC,
        state: 'live',
        customer_id: 'cust-1',
        hop_count: 5001
      }] })
    }]);
    const report = await analyseLinkedSharedRisk(client, {});
    assert.equal(report.available, false);
    assert.equal(report.reason, 'SERVICE_PATH_HOPS_BOUND_EXCEEDED');
  });

  it('fails closed when returned hops do not match the authoritative hop count', async () => {
    const client = mockClient([
      {
        match: (t) => t.includes('network_service_path_versions') && t.includes('JOIN services'),
        respond: () => ({ rows: [{ service_path_version_id: PATH_V, service_id: SVC, state: 'live', customer_id: 'cust-1', hop_count: 2 }] })
      },
      {
        match: (t) => t.includes('FROM network_service_path_hops'),
        respond: () => ({ rows: [{ service_path_version_id: PATH_V, ordinal: 1, from_asset_id: A1, to_asset_id: A2 }] })
      }
    ]);
    const report = await analyseLinkedSharedRisk(client, {});
    assert.equal(report.available, false);
    assert.equal(report.reason, 'SERVICE_PATH_HOPS_INCOMPLETE');
    assert.equal(report.expectedHopCount, 2);
    assert.equal(report.actualHopCount, 1);
  });

  it('keeps multi-domain failure mappings explicit instead of choosing the last domain', async () => {
    const client = mockClient([
      { match: t => t.includes('network_service_path_versions') && t.includes('JOIN services'), respond: () => ({ rows: [{ service_path_version_id: PATH_V, service_id: SVC, state: 'live', customer_id: 'cust-1', hop_count: 0 }] }) },
      { match: t => t.includes('FROM network_service_path_hops'), respond: () => ({ rows: [] }) },
      { match: t => t.includes('FROM network_assets'), respond: () => ({ rows: [{ id: A1, asset_type: 'FDT', asset_code: 'FDT-1' }] }) },
      { match: t => t.includes('network_failure_domain_members'), respond: () => ({ rows: [
        { resource_id: A1, domain_key: 'domain-a', criticality: 2, alternative_path_available: false },
        { resource_id: A1, domain_key: 'domain-b', criticality: 3, alternative_path_available: true }
      ] }) },
      { match: t => t.includes('physical_topology_edges') && t.includes('shared_risk_group'), respond: () => ({ rows: [] }) },
      { match: t => t.includes('contains') || t.includes('duct'), respond: () => ({ rows: [] }) }
    ]);
    const load = await (await import('../src/sharedRiskLinkedAnalysis.js')).loadLinkedResources(client, [A1]);
    assert.equal(load.resources[0].sharedRiskGroup, null);
    assert.equal(load.resources[0].failureDomainConflict, true);
  });

  it('does not disguise a missing column as an unavailable relation', async () => {
    const client = mockClient([
      {
        match: (t) => t.includes('network_service_path_versions') && t.includes('JOIN services'),
        respond: () => ({ rows: [{
          service_path_version_id: PATH_V,
          service_id: SVC,
          state: 'live',
          customer_id: 'cust-1',
          hop_count: 1
        }] })
      },
      { match: (t) => t.includes('FROM network_service_path_hops'), respond: () => ({ rows: [{ service_path_version_id: PATH_V, ordinal: 1, from_asset_id: A1, to_asset_id: A1 }] }) },
      { match: (t) => t.includes('FROM network_assets'), respond: () => ({ rows: [{ id: A1, asset_type: 'FDT' }] }) },
      {
        match: (t) => t.includes('network_failure_domain_members'),
        respond: () => {
          const err = new Error('column "d.alternative_path_available" does not exist');
          err.code = '42703';
          throw err;
        }
      }
    ]);
    await assert.rejects(
      () => analyseLinkedSharedRisk(client, {}),
      (err) => err && err.code === '42703'
    );
  });

  it('rejects invalid uuid filters', async () => {
    await assert.rejects(
      () => loadLinkedServicePaths(mockClient([]), { serviceId: 'not-a-uuid' }),
      /SHARED_RISK_SERVICE_ID_INVALID/
    );
  });
});
