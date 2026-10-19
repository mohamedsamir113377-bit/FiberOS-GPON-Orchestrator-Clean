'use strict';

function byId(rows, key) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && row[key] != null) map.set(String(row[key]), row);
  }
  return map;
}

function assertConversation(conversation) {
  if (!conversation || typeof conversation !== 'object' || !conversation.id || !conversation.correlation_id) {
    throw Object.assign(new Error('TRACE_CONVERSATION_REQUIRED'), { code: 'TRACE_CONVERSATION_REQUIRED' });
  }
}

function buildOperationalTrace({
  conversation,
  events = [],
  incidentLinks = [],
  incidents = [],
  evidenceLinks = [],
  evidence = []
} = {}) {
  assertConversation(conversation);
  const eventRows = Array.isArray(events) ? events.filter(Boolean) : [];
  const eventMap = byId(eventRows, 'event_id');
  const incidentMap = byId(incidents, 'id');
  const evidenceMap = byId(evidence, 'id');
  const handoffEvents = eventRows.filter(e => e.event_type === 'contact_center.handoff.required');

  const correlationMismatches = eventRows
    .filter(e => e.correlation_id !== conversation.correlation_id)
    .map(e => String(e.event_id));

  const unresolvedCausationEventIds = eventRows
    .filter(e => e.causation_id && !eventMap.has(String(e.causation_id)))
    .map(e => String(e.event_id));

  const unresolvedIncidentLinks = [];
  for (const link of Array.isArray(incidentLinks) ? incidentLinks : []) {
    if (!eventMap.has(String(link.event_id)) || !incidentMap.has(String(link.incident_id))) {
      unresolvedIncidentLinks.push(String(link.id));
    }
  }

  const unresolvedEvidenceLinks = [];
  for (const link of Array.isArray(evidenceLinks) ? evidenceLinks : []) {
    if (!eventMap.has(String(link.event_id)) || !evidenceMap.has(String(link.evidence_vault_id))) {
      unresolvedEvidenceLinks.push(String(link.id));
    }
  }

  const incidentEdges = (Array.isArray(incidentLinks) ? incidentLinks : []).map(link => ({
    linkId: link.id,
    eventId: link.event_id,
    incidentId: link.incident_id,
    linkRole: link.link_role,
    createdAt: link.created_at,
    incident: incidentMap.get(String(link.incident_id)) || null
  }));

  const evidenceEdges = (Array.isArray(evidenceLinks) ? evidenceLinks : []).map(link => ({
    linkId: link.id,
    eventId: link.event_id,
    evidenceVaultId: link.evidence_vault_id,
    linkRole: link.link_role,
    createdAt: link.created_at,
    evidence: evidenceMap.get(String(link.evidence_vault_id)) || null
  }));

  let chainStatus = eventRows.length ? 'NO_HANDOFF_EVENT' : 'CONVERSATION_ONLY';
  if (handoffEvents.length) chainStatus = 'HANDOFF_UNLINKED';
  if (handoffEvents.length && incidentEdges.some(e => handoffEvents.some(h => h.event_id === e.eventId))) chainStatus = 'INCIDENT_LINKED';
  if (handoffEvents.length && evidenceEdges.some(e => handoffEvents.some(h => h.event_id === e.eventId))) chainStatus = chainStatus === 'INCIDENT_LINKED' ? 'FULL_CHAIN_LINKED' : 'EVIDENCE_LINKED';

  return Object.freeze({
    chainStatus,
    customer: Object.freeze({ customerRef: conversation.customer_ref || null }),
    conversation: conversation,
    events: eventRows,
    handoffEvents,
    incidentEdges,
    evidenceEdges,
    integrity: Object.freeze({
      correlationMatchesConversation: correlationMismatches.length === 0,
      correlationMismatchedEventIds: correlationMismatches,
      causationEdgesResolvable: unresolvedCausationEventIds.length === 0,
      unresolvedCausationEventIds,
      incidentLinksResolvable: unresolvedIncidentLinks.length === 0,
      unresolvedIncidentLinkIds: unresolvedIncidentLinks,
      evidenceLinksResolvable: unresolvedEvidenceLinks.length === 0,
      unresolvedEvidenceLinkIds: unresolvedEvidenceLinks
    }),
    runtime: Object.freeze({
      databaseBacked: true,
      eventPublishConfirmed: false,
      evidenceStorageConfirmed: evidenceEdges.length > 0 && evidenceEdges.every(e => e.evidence && e.evidence.storage_status === 'STORAGE_VERIFIED'),
      telephonyConfirmed: false,
      speechExecutionConfirmed: false
    }),
    syntheticData: false
  });
}

module.exports = { buildOperationalTrace };
