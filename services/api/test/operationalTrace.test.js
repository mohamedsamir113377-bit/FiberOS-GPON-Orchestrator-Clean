'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

test('operational trace endpoint is tenant-scoped and read-only', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/operations.js'), 'utf8');
  const policy = fs.readFileSync(path.join(ROOT, 'services/api/src/routeAuthorizationPolicy.js'), 'utf8');
  assert.equal(route.includes("trace\\/contact-center\\/conversations\\/"), true);
  assert.equal(policy.includes("trace\\/contact-center\\/conversations\\/"), true);
  assert.match(route, /call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin/);
  assert.match(route, /aggregate_type='contact_center_conversation'/);
  assert.match(route, /and aggregate_id=\$2/);
  assert.match(route, /from operational_event_incident_links/);
  assert.match(route, /from operational_event_evidence_links/);
  assert.match(route, /from evidence_vault_objects/);
  assert.doesNotMatch(route, /insert into operational_event_incident_links[\s\S]*trace/);
  assert.doesNotMatch(route, /insert into operational_event_evidence_links[\s\S]*trace/);
  assert.match(route, /DATABASE_BACKED_OPERATIONAL_TRACE/);
  assert.match(route, /runtimeVerification:'UNVERIFIED'/);
});

test('trace kernel distinguishes partial chain from full chain and validates graph references', () => {
  const { buildOperationalTrace } = require(path.join(ROOT, 'packages/operational-context/src/trace.js'));
  const conversation = {
    id: 'conv-1',
    tenant_id: 'tenant-1',
    customer_ref: 'cust-1',
    correlation_id: 'cc:1'
  };
  const events = [
    {
      event_id: 'event-create',
      event_type: 'contact_center.conversation.created',
      correlation_id: 'cc:1',
      causation_id: null
    },
    {
      event_id: 'event-handoff',
      event_type: 'contact_center.handoff.required',
      correlation_id: 'cc:1',
      causation_id: 'event-create',
      integrity_sha256: 'a'.repeat(64)
    }
  ];
  const incidents = [{
    id: 'incident-1',
    tenant_id: 'tenant-1',
    incident_key: 'INC-1',
    severity: 'P2',
    state: 'declared'
  }];
  const evidence = [{
    id: 'evidence-1',
    tenant_id: 'tenant-1',
    content_sha256: 'b'.repeat(64),
    storage_status: 'STORAGE_UNVERIFIED'
  }];
  const partial = buildOperationalTrace({
    conversation,
    events,
    incidentLinks: [{
      id: 'link-i',
      event_id: 'event-handoff',
      incident_id: 'incident-1',
      link_role: 'trigger'
    }],
    incidents,
    evidenceLinks: [],
    evidence: []
  });
  assert.equal(partial.chainStatus, 'INCIDENT_LINKED');
  assert.equal(partial.integrity.causationEdgesResolvable, true);
  assert.equal(partial.runtime.evidenceStorageConfirmed, false);

  const full = buildOperationalTrace({
    conversation,
    events,
    incidentLinks: [{
      id: 'link-i',
      event_id: 'event-handoff',
      incident_id: 'incident-1',
      link_role: 'trigger'
    }],
    incidents,
    evidenceLinks: [{
      id: 'link-e',
      event_id: 'event-handoff',
      evidence_vault_id: 'evidence-1',
      link_role: 'supporting'
    }],
    evidence
  });
  assert.equal(full.chainStatus, 'FULL_CHAIN_LINKED');
  assert.equal(full.evidenceEdges[0].evidence.storage_status, 'STORAGE_UNVERIFIED');
  assert.equal(full.runtime.evidenceStorageConfirmed, false);
});

test('trace kernel marks broken correlation and causation rather than silently passing', () => {
  const { buildOperationalTrace } = require(path.join(ROOT, 'packages/operational-context/src/trace.js'));
  const trace = buildOperationalTrace({
    conversation: { id: 'conv-1', correlation_id: 'cc:expected', customer_ref: null },
    events: [{
      event_id: 'event-1',
      event_type: 'contact_center.handoff.required',
      correlation_id: 'cc:wrong',
      causation_id: 'missing-event'
    }]
  });
  assert.equal(trace.integrity.correlationMatchesConversation, false);
  assert.deepEqual(trace.integrity.correlationMismatchedEventIds, ['event-1']);
  assert.equal(trace.integrity.causationEdgesResolvable, false);
  assert.deepEqual(trace.integrity.unresolvedCausationEventIds, ['event-1']);
});
