'use strict';

/**
 * Static E2E Reality Chain — pure functions + migration presence.
 * Does NOT claim PostgreSQL runtime, telephony, or speech execution.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const {
  negotiateLanguage,
  probeSpeechAdapter,
  buildVoiceSessionPolicy
} = require(path.join(ROOT, 'packages/multilingual-contact-center/src'));
const { buildOperationalTrace } = require(path.join(ROOT, 'packages/operational-context/src/trace'));

const REQUIRED_MIGRATIONS = [
  '150_evidence_vault_incident_command.sql',
  '153_canonical_operational_event_envelope.sql',
  '154_multilingual_contact_center_conversations.sql',
  '155_operational_event_evidence_links.sql',
  '156_operational_event_incident_links.sql'
];

test('reality chain migrations and tables exist in source', () => {
  for (const name of REQUIRED_MIGRATIONS) {
    const full = path.join(ROOT, 'sql/migrations', name);
    assert.equal(fs.existsSync(full), true, 'missing ' + name);
  }
  const m154 = fs.readFileSync(path.join(ROOT, 'sql/migrations/154_multilingual_contact_center_conversations.sql'), 'utf8');
  assert.match(m154, /contact_center_conversations/);
  assert.match(m154, /HANDOFF_REQUIRED/);
  const m155 = fs.readFileSync(path.join(ROOT, 'sql/migrations/155_operational_event_evidence_links.sql'), 'utf8');
  assert.match(m155, /operational_event_evidence_links/);
  const m156 = fs.readFileSync(path.join(ROOT, 'sql/migrations/156_operational_event_incident_links.sql'), 'utf8');
  assert.match(m156, /operational_event_incident_links/);
});

test('Customer → Conversation language negotiation → Handoff (exact locale policy)', () => {
  const ok = negotiateLanguage({ requestedLocale: 'ar-EG' });
  assert.equal(ok.handoffRequired, false);
  assert.equal(ok.dialectMode, 'EXACT_LOCALE');

  const handoff = negotiateLanguage({ requestedLocale: 'ar-MA' });
  assert.equal(handoff.handoffRequired, true);
  assert.equal(handoff.dialectMode, 'HUMAN_HANDOFF_REQUIRED');
  assert.notEqual(handoff.locale, 'ar-EG');

  const probe = probeSpeechAdapter({
    provider: 'LOCAL_SOVEREIGN',
    locale: 'ar-EG',
    declaredNativeLocales: []
  });
  assert.equal(probe.handoffRequired, true);
  assert.equal(probe.runtimeConnected, false);

  const policy = buildVoiceSessionPolicy({
    profile: ok.profile,
    locale: 'ar-EG',
    speechProbe: probe
  });
  assert.equal(policy.handoffRequired, true);
  assert.equal(policy.dialectMode, 'HUMAN_HANDOFF_REQUIRED');
});

test('Handoff → Events → Incident → Evidence → Trace (FULL_CHAIN_LINKED)', () => {
  const conversation = {
    id: 'conv-1',
    tenant_id: 'tenant-a',
    customer_ref: 'cust-1',
    correlation_id: 'cc:chain-1',
    status: 'HANDOFF_REQUIRED',
    language_code: 'ar',
    locale: 'ar-MA'
  };
  const events = [
    {
      event_id: 'evt-create',
      event_type: 'contact_center.conversation.created',
      correlation_id: 'cc:chain-1',
      causation_id: null,
      integrity_sha256: 'c'.repeat(64)
    },
    {
      event_id: 'evt-handoff',
      event_type: 'contact_center.handoff.required',
      correlation_id: 'cc:chain-1',
      causation_id: 'evt-create',
      integrity_sha256: 'd'.repeat(64)
    }
  ];
  const incidents = [{
    id: 'inc-1',
    tenant_id: 'tenant-a',
    incident_key: 'INC-CHAIN-1',
    severity: 'P2',
    state: 'declared'
  }];
  const evidence = [{
    id: 'ev-1',
    tenant_id: 'tenant-a',
    content_sha256: 'e'.repeat(64),
    storage_status: 'STORAGE_UNVERIFIED'
  }];

  const full = buildOperationalTrace({
    conversation,
    events,
    incidentLinks: [{
      id: 'il-1',
      event_id: 'evt-handoff',
      incident_id: 'inc-1',
      link_role: 'trigger'
    }],
    incidents,
    evidenceLinks: [{
      id: 'el-1',
      event_id: 'evt-handoff',
      evidence_vault_id: 'ev-1',
      link_role: 'supporting'
    }],
    evidence
  });

  assert.equal(full.chainStatus, 'FULL_CHAIN_LINKED');
  assert.equal(full.integrity.correlationMatchesConversation, true);
  assert.equal(full.integrity.causationEdgesResolvable, true);
  assert.equal(full.integrity.incidentLinksResolvable, true);
  assert.equal(full.integrity.evidenceLinksResolvable, true);
  assert.equal(full.runtime.eventPublishConfirmed, false);
  assert.equal(full.runtime.evidenceStorageConfirmed, false);
  assert.equal(full.runtime.telephonyConfirmed, false);
  assert.equal(full.runtime.speechExecutionConfirmed, false);
  assert.equal(full.syntheticData, false);
});

test('adversarial: correlation mismatch and forged causation fail integrity', () => {
  const conversation = {
    id: 'conv-2',
    tenant_id: 'tenant-a',
    correlation_id: 'cc:legit'
  };
  const events = [
    {
      event_id: 'evt-1',
      event_type: 'contact_center.conversation.created',
      correlation_id: 'cc:forged-other',
      causation_id: null
    },
    {
      event_id: 'evt-2',
      event_type: 'contact_center.handoff.required',
      correlation_id: 'cc:legit',
      causation_id: 'evt-does-not-exist'
    }
  ];
  const trace = buildOperationalTrace({ conversation, events });
  assert.equal(trace.integrity.correlationMatchesConversation, false);
  assert.equal(trace.integrity.causationEdgesResolvable, false);
  assert.ok(trace.integrity.correlationMismatchedEventIds.includes('evt-1'));
  assert.ok(trace.integrity.unresolvedCausationEventIds.includes('evt-2'));
});

test('adversarial: dangling incident/evidence links are unresolved', () => {
  const conversation = {
    id: 'conv-3',
    tenant_id: 'tenant-a',
    correlation_id: 'cc:3'
  };
  const events = [{
    event_id: 'evt-h',
    event_type: 'contact_center.handoff.required',
    correlation_id: 'cc:3',
    causation_id: null
  }];
  const trace = buildOperationalTrace({
    conversation,
    events,
    incidentLinks: [{
      id: 'bad-i',
      event_id: 'evt-h',
      incident_id: 'missing-incident',
      link_role: 'trigger'
    }],
    incidents: [],
    evidenceLinks: [{
      id: 'bad-e',
      event_id: 'evt-h',
      evidence_vault_id: 'missing-evidence',
      link_role: 'supporting'
    }],
    evidence: []
  });
  assert.equal(trace.integrity.incidentLinksResolvable, false);
  assert.equal(trace.integrity.evidenceLinksResolvable, false);
  assert.ok(trace.integrity.unresolvedIncidentLinkIds.includes('bad-i'));
  assert.ok(trace.integrity.unresolvedEvidenceLinkIds.includes('bad-e'));
});

test('route emits contact_center.handoff.required when status is HANDOFF_REQUIRED', () => {
  const route = fs.readFileSync(
    path.join(ROOT, 'services/api/src/routes/contactCenterMultilingual.js'),
    'utf8'
  );
  assert.match(route, /eventType:\s*'contact_center\.handoff\.required'/);
  assert.match(route, /conversationStatus === 'HANDOFF_REQUIRED'/);
  assert.match(route, /appendOperationalEvent/);
});
