'use strict';
const { rejectClientTenantAuthority, assertPrincipalForWrite, boundaryOk } = require('../tenantBoundary');
const { createEvidenceEnvelope } = require('../../../../packages/core/src/evidenceEnvelope');
const { withPrincipal } = require('../../../../packages/db/src/session');
const {
  isValidSource,
  isAuthoritativeSource,
  validateRxPower,
  ALL_SOURCES
} = require('../../../../packages/ftth-measurements/src/index');

const { toEvidenceSource } = require('../../../../packages/domain/src/sourceMap');
const { loadImmutablePermissionContext, assertTechnicianReadAllowed } = require('../../../../packages/security/src/permissionContext');
const { linkOperationalEventToEvidence } = require('../../../../packages/operational-context/src/evidenceLink');

const EVIDENCE_KINDS = new Set(['gps_arrival', 'photo', 'ocr', 'rx_reading', 'otdr_sor', 'customer_confirm', 'tech_sign', 'other']);
const OPTICAL_KINDS = new Set(['rx_reading', 'otdr_sor']);

function validateOpticalEvidence(body, kind) {
  if (!OPTICAL_KINDS.has(String(kind))) return { ok: true, skipped: true };
  const source = body.source || (body.payload && body.payload.source) || null;
  const eventId = body.operationalEventId || body.eventId || null;
  const evidenceVaultId = body.evidenceVaultId || null;
  if ((eventId && !evidenceVaultId) || (!eventId && evidenceVaultId)) {
    return { status: 400, body: { ok: false, error: 'EVIDENCE_EVENT_LINK_REQUIRES_BOTH_IDS' } };
  }
  if (!source || !isValidSource(source)) {
    return {
      ok: false,
      error: 'OPTICAL_EVIDENCE_SOURCE_REQUIRED',
      allowed: ALL_SOURCES.slice()
    };
  }
  const payload = body.payload || body;
  if (payload.rxDbm != null || payload.powerDbm != null || payload.value_numeric != null) {
    const v = payload.rxDbm != null ? payload.rxDbm
      : payload.powerDbm != null ? payload.powerDbm
      : payload.value_numeric;
    const rx = validateRxPower(v);
    if (!rx.ok) {
      return { ok: false, error: 'OPTICAL_RX_OUT_OF_RANGE', detail: rx, source };
    }
  }
  return {
    ok: true,
    source,
    authoritative: isAuthoritativeSource(source),
    note: isAuthoritativeSource(source)
      ? null
      : 'non_authoritative_source_recorded_but_cannot_final_close'
  };
}

async function handleEvidenceSubmit(body, principal, db, cfg) {
  body = body || {};
  const tenantGate = rejectClientTenantAuthority(body);
  if (!tenantGate.ok) return tenantGate;
  const prinGate = assertPrincipalForWrite(principal);
  if (!prinGate.ok) return prinGate;
  const ticketId = body.ticketId || body.id;
  if (!ticketId) {
    return { status: 400, body: { ok: false, error: 'TICKET_ID_REQUIRED' } };
  }
  const kind = body.kind || 'other';
  if (!EVIDENCE_KINDS.has(String(kind))) {
    return { status: 422, body: { ok: false, error: 'EVIDENCE_KIND_INVALID', allowed: Array.from(EVIDENCE_KINDS) } };
  }
  // Optional operational-event link, resolved at handler scope so it is defined
  // for every evidence kind (mirrors the extraction in validateOpticalEvidence).
  const eventId = body.operationalEventId || body.eventId || null;
  const evidenceVaultId = body.evidenceVaultId || null;
  const source = body.source || (body.payload && body.payload.source) || null;
  // This authenticated user endpoint is not an attestation channel.
  // NMS/system provenance must arrive through a dedicated trusted adapter path.
  const evidenceSource = source ? require('../../../../packages/domain/src/sourceMap').toEvidenceSource(source) : null;
  if (source && evidenceSource !== 'field' && evidenceSource !== 'ai_simulated') {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'EVIDENCE_SOURCE_ATTESTATION_REQUIRED',
        note: 'User-submitted evidence may only claim field or ai_simulated provenance.'
      }
    };
  }

  const opticalCheck = validateOpticalEvidence(body, kind);
  if (!opticalCheck.ok) {
    return { status: 422, body: { ok: false, error: opticalCheck.error, detail: opticalCheck.detail || null, allowed: opticalCheck.allowed || null } };
  }
  const envelope = await createEvidenceEnvelope({
    type: 'evidence_submit',
    ticketId: ticketId,
    kind: kind,
    actorSub: principal && principal.sub,
    payload: body.payload || body
  });

  if (!db || !db.configured) {
    return {
      status: 202,
      body: {
        ok: true,
        accepted: false,
        persisted: false,
        envelope: {
          idempotencyKey: envelope.idempotencyKey,
          requestHash: envelope.requestHash
        },
        note: 'Set DATABASE_URL to persist'
      }
    };
  }

  try {
    const row = await withPrincipal(db, principal, async function (client) {
      const context = await loadImmutablePermissionContext(client, principal);
      const ticket = await client.query(`select tenant_id, technician_id from tickets where id=$1::uuid`, [ticketId]);
      if (!ticket.rows[0]) throw Object.assign(new Error('TICKET_NOT_FOUND'), { code: 'TICKET_NOT_FOUND' });
      const scope = assertTechnicianReadAllowed(context, { tenantId: ticket.rows[0].tenant_id, ticketTechnicianId: ticket.rows[0].technician_id });
      if (!scope.ok) throw Object.assign(new Error(scope.error), { code: scope.error });
      const r = await client.query(
        `insert into evidence (tenant_id, ticket_id, kind, payload, source, actor_id, content_hash)
         values (fiberos_current_tenant_id(), $1::uuid, $2, $3::jsonb, $4, auth.uid(), $5)
         returning id, kind, created_at`,
        [
          ticketId,
          kind,
          JSON.stringify(body.payload || body),
          (toEvidenceSource(opticalCheck.source || source || 'field') || 'field'),
          body.contentHash || envelope.requestHash
        ]
      );
      let operationalLink = null;
      if (eventId && evidenceVaultId) {
        operationalLink = await linkOperationalEventToEvidence(client, {
          tenantId: ticket.rows[0].tenant_id,
          eventId,
          evidenceVaultId,
          actorId: principal && principal.sub
        });
      }
      return { evidence: r.rows[0], operationalLink };
    });
    return {
      status: 200,
      body: {
        ok: true,
        persisted: true,
        evidence: row.evidence,
        operationalEventEvidenceLink: row.operationalLink ? {
          id: row.operationalLink.link.id,
          eventId: row.operationalLink.link.event_id,
          evidenceVaultId: row.operationalLink.link.evidence_vault_id,
          linkRole: row.operationalLink.link.link_role,
          replayed: row.operationalLink.replayed,
          eventIntegritySha256: row.operationalLink.event.integrity_sha256,
          evidenceContentSha256: row.operationalLink.evidence.content_sha256,
          storageStatus: row.operationalLink.evidence.storage_status
        } : null,
        idempotencyKey: envelope.idempotencyKey,
        requestHash: envelope.requestHash
      }
    };
  } catch (e) {
    if (e.code === 'TICKET_NOT_FOUND') return { status: 404, body: { ok: false, error: e.code } };
    if (/TECHNICIAN_READ_SCOPE_REQUIRED|SUPERVISOR_TECHNICIAN_SCOPE_REQUIRED|TENANT_SCOPE_REQUIRED/.test(String(e.code || ''))) return { status: 403, body: { ok: false, error: e.code } };
    if (['OPERATIONAL_EVENT_NOT_FOUND','EVIDENCE_VAULT_OBJECT_NOT_FOUND'].includes(e.code)) return { status: 404, body: { ok: false, error: e.code } };
    if (['OPERATIONAL_EVENT_NOT_CANONICAL','OPERATIONAL_EVENT_EVIDENCE_ACTOR_MISMATCH','TENANT_MISMATCH_OPERATIONAL_EVENT','TENANT_MISMATCH_EVIDENCE_VAULT'].includes(e.code)) return { status: 409, body: { ok: false, error: e.code } };
    return {
      status: 500,
      body: { ok: false, error: 'EVIDENCE_PERSIST_FAILED', detail: String(e && e.code || e && e.message || e).slice(0, 180) }
    };
  }
}

module.exports = { handleEvidenceSubmit, validateOpticalEvidence };
