'use strict';
const { rejectClientTenantAuthority, assertPrincipalForWrite } = require('../tenantBoundary');
const { validateFieldClose, DEFAULT_PHOTO_MAX_AGE_SECONDS } = require('../../../../packages/domain/src/fieldClosure');
const { normalizeStatus } = require('../../../../packages/domain/src/ticketStateMachine');
const { toEvidenceSource, toOpticalSource } = require('../../../../packages/domain/src/sourceMap');
const { createEvidenceEnvelope } = require('../../../../packages/core/src/evidenceEnvelope');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { appendLedgerBlock } = require('../../../../packages/domain/src/ledgerAppend');
const { appendOperationalEvent } = require('../../../../packages/operational-context/src');
const {
  evaluateCloseGate,
  GPON_CLASS_B_PLUS
} = require('../../../../packages/ftth-measurements/src/index');
const signingPort = require('../../../../packages/signing-port/src/index');
const {
  loadImmutablePermissionContext,
  assertTechnicianMutationAllowed,
  evaluateOptionalSupervisorOverride,
  privilegeAuditEvent
} = require('../../../../packages/security/src/permissionContext');

/**
 * Authoritative close gate (Alpha 58).
 * After domain validateFieldClose, blocks final close when source is
 * non-authoritative or evidence incomplete. Pure — no DB writes.
 */
function applyAuthoritativeCloseGate(body, validation, toStatus) {
  const target = normalizeStatus(toStatus || (validation.normalized && validation.normalized.toStatus) || '');
  if (target !== 'completed' && target !== 'pending_signature') {
    return { allow: true, skipped: true, reason: 'not_final_close_target', authority: 'SERVER_DOMAIN' };
  }
  const sources = (validation.normalized && validation.normalized.opticalSources) || [];
  const primary = sources[0] || body.opticalSource || body.measurementSource || null;
  const geoPassed = !!(validation.normalized && validation.normalized.geo && validation.normalized.geo.passed === true);
  const photoOk = !!(validation.normalized && validation.normalized.photoOk === true);
  const gate = evaluateCloseGate({
    ticketId: body.ticketId || body.id,
    measurementSource: primary,
    gpsOk: geoPassed,
    geoVerified: geoPassed,
    hasPhoto: photoOk,
    hasFieldEvidence: photoOk || !!(body.evidenceIds && body.evidenceIds.length),
    powerDbm: body.rxDbm,
    geoDistanceMeters: validation.normalized && validation.normalized.geo
      ? validation.normalized.geo.distanceMeters
      : body.geoDistanceMeters,
    requiresSignature: target === 'pending_signature' || body.requiresSignature === true,
    signatureRef: body.signatureRef || null
  });
  // If caller provided signatureRef, verify server-side (fail-closed).
  if (gate.allow && body.signatureRef) {
    const payload = {
      ticketId: body.ticketId || body.id || null,
      toStatus: target,
      measurementSource: primary
    };
    const vr = signingPort.verify(payload, body.signatureRef, 'ticket_close', process.env);
    if (!vr.ok) {
      return {
        allow: false,
        finalClose: false,
        status: 'pending_signature',
        reason: 'signature_verify_failed',
        signingError: vr.error || 'VERIFY_FAILED',
        authority: 'SERVER_SIGNING_PORT'
      };
    }
    return Object.assign({}, gate, { signatureVerified: true, authority: gate.authority || 'SERVER_DOMAIN' });
  }
  return gate;
}

/**
 * Server-computed photo age — never trust a client-reported ageSeconds.
 * Returns null if capturedAt is missing/unparseable so the caller can
 * reject with PHOTO_CAPTURE_TIME_REQUIRED instead of silently passing.
 */
function computePhotoAgeSeconds(photo) {
  if (!photo || !photo.capturedAt) return null;
  const capturedMs = Date.parse(photo.capturedAt);
  if (!Number.isFinite(capturedMs)) return null;
  return (Date.now() - capturedMs) / 1000;
}

async function handleFieldClose(body, principal, db, cfg) {
  body = body || {};
  const tenantGate = rejectClientTenantAuthority(body);
  if (!tenantGate.ok) return tenantGate;
  const prinGate = assertPrincipalForWrite(principal);
  if (!prinGate.ok) return prinGate;
  const ticketId = body.ticketId || body.id;
  if (!ticketId) {
    return { status: 400, body: { ok: false, error: 'TICKET_ID_REQUIRED' } };
  }

  const clientIdem = body.idempotencyKey || null;

  // SECURITY FIX: these bounds are server policy, never client input.
  // Invalid configured bounds fail closed; they must never silently fall back
  // to a weaker/default policy at request time.
  const maxMeters = Number(cfg.realityGateMaxMeters);
  const photoMaxAgeSeconds = cfg.photoMaxAgeSeconds != null
    ? Number(cfg.photoMaxAgeSeconds)
    : DEFAULT_PHOTO_MAX_AGE_SECONDS;
  if (!Number.isFinite(maxMeters) || maxMeters <= 0 ||
      !Number.isFinite(photoMaxAgeSeconds) || photoMaxAgeSeconds <= 0) {
    return {
      status: 503,
      body: {
        ok: false,
        error: 'FIELD_CLOSE_CONFIGURATION_INVALID',
        authority: 'SERVER_CONFIGURATION',
        productionReady: false
      }
    };
  }

  // Photo freshness is computed from the server clock against photo.capturedAt;
  // ageSeconds/maxAgeSeconds supplied by the request are never trusted.
  const photoServerComputedAgeSeconds = computePhotoAgeSeconds(body.photo);

  const toStatus = body.toStatus || body.to || 'awaiting_evidence';
  const opticalSources = body.opticalSources || (body.opticalSource ? [body.opticalSource] : []);
  // Client-supplied policy is never authoritative for a persisted close.
  // The route uses only server policy/defaults here; body.policy is ignored.
  const policy = { requireFieldOrNms: true };
  const clientClaimsNms = opticalSources.some(function (s) { return String(s) === 'nms_poll'; });
  // A user-authenticated request cannot self-attest as an NMS poll. The
  // trusted NMS adapter has its own provenance channel; until that channel
  // supplies a verified receipt, NMS remains non-authoritative here.
  if (clientClaimsNms) {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'NMS_PROVENANCE_ATTESTATION_REQUIRED',
        authority: 'SERVER_PROVENANCE_POLICY'
      }
    };
  }

  if (!db || !db.configured) {
    // No database at all: we cannot fetch the real current ticket state, so
    // we refuse to silently assume one (the old code defaulted a missing
    // fromStatus to 'in_progress' inside the pure validator — removed).
    const clientDeclaredFrom = body.fromStatus || body.from;
    if (!clientDeclaredFrom) {
      return { status: 400, body: { ok: false, error: 'FROM_STATUS_REQUIRED_FOR_ADVISORY_VALIDATION' } };
    }
    const validation = validateFieldClose({
      fromStatus: clientDeclaredFrom,
      toStatus: toStatus,
      jobGps: body.jobGps,
      deviceGps: body.deviceGps,
      maxMeters: maxMeters,
      photo: body.photo,
      photoMaxAgeSeconds: photoMaxAgeSeconds,
      photoServerComputedAgeSeconds: photoServerComputedAgeSeconds,
      rxDbm: body.rxDbm,
      opticalSources: opticalSources,
      policy: policy
    });

    if (!validation.ok) {
      return {
        status: 422,
        body: { ok: false, error: 'FIELD_CLOSE_VALIDATION_FAILED', errors: validation.errors, normalized: validation.normalized }
      };
    }

    const closeGateAdvisory = applyAuthoritativeCloseGate(body, validation, toStatus);
    if (!closeGateAdvisory.allow) {
      return {
        status: 422,
        body: {
          ok: false,
          error: 'AUTHORITATIVE_CLOSE_GATE_BLOCKED',
          gate: closeGateAdvisory,
          gponWindow: GPON_CLASS_B_PLUS,
          normalized: validation.normalized
        }
      };
    }

    const envelope = await createEvidenceEnvelope({
      type: 'field_close',
      ticketId: ticketId,
      actorSub: principal && principal.sub,
      rxDbm: body.rxDbm,
      opticalSources: validation.normalized.opticalSources,
      geo: validation.normalized.geo,
      photo: { contentHash: body.photo && body.photo.contentHash, storageRef: body.photo && body.photo.storageRef },
      ontSerial: body.ontSerial || null,
      boxCode: body.boxCode || null,
      clientIdempotencyKey: clientIdem
    });

    return {
      status: 202,
      body: {
        ok: true,
        accepted: false,
        persisted: false,
        validated: true,
        authority: 'CLIENT_DECLARED_UNVERIFIED_NO_DB',
        nextStatus: validation.normalized.toStatus,
        envelope: { idempotencyKey: envelope.idempotencyKey, requestHash: envelope.requestHash },
        note: 'Validated against a CLIENT-DECLARED fromStatus because no database is configured — set DATABASE_URL to enforce DB-authoritative state before treating this as a real decision.'
      }
    };
  }

  try {
    const outcome = await withPrincipal(db, principal, async function (client) {
      const cur = await client.query(
        `select status, technician_id, ST_Y(location_coordinates::geometry) as job_latitude, ST_X(location_coordinates::geometry) as job_longitude from tickets where id = $1::uuid for update`,
        [ticketId]
      );
      if (!cur.rowCount) {
        const err = new Error('TICKET_NOT_FOUND');
        err.code = 'TICKET_NOT_FOUND';
        throw err;
      }
      const trueFrom = cur.rows[0].status;
      const serverJobGps = { lat: Number(cur.rows[0].job_latitude), lng: Number(cur.rows[0].job_longitude) };
      if (!Number.isFinite(serverJobGps.lat) || !Number.isFinite(serverJobGps.lng)) {
        const err = new Error('TICKET_LOCATION_REQUIRED'); err.code = 'TICKET_LOCATION_REQUIRED'; throw err;
      }
      const tenantRow = await client.query(`select tenant_id from tickets where id = $1::uuid`, [ticketId]);
      const tenantId = tenantRow.rows[0] && tenantRow.rows[0].tenant_id;
      if (!tenantId) { const err = new Error('TENANT_CONTEXT_REQUIRED'); err.code = 'TENANT_CONTEXT_REQUIRED'; throw err; }
      const permissionContext = await loadImmutablePermissionContext(client, principal);

      // Resolve technician identity from the authenticated principal + tenant.
      // The client must never choose measured_by. Management roles may use a
      // service identity path; field technicians must resolve to their own
      // technician row.
      const techRow = await client.query(
        `select id from technicians where user_id = $1::uuid and tenant_id = $2::uuid and is_active = true limit 1`,
        [principal && principal.sub, tenantId]
      );
      const resolvedTechnicianId = techRow.rows[0] && techRow.rows[0].id;
      const technicianScope = assertTechnicianMutationAllowed(permissionContext, {
        tenantId,
        ticketTechnicianId: cur.rows[0].technician_id,
        technicianId: resolvedTechnicianId
      });
      if (!technicianScope.ok) { const err = new Error(technicianScope.error); err.code = technicianScope.error; throw err; }
      if (String(principal && principal.role) === 'field_tech') {
        if (!resolvedTechnicianId || String(cur.rows[0].technician_id || '') !== String(resolvedTechnicianId)) {
          const err = new Error('TECHNICIAN_NOT_ASSIGNED_TO_TICKET'); err.code = 'TECHNICIAN_NOT_ASSIGNED_TO_TICKET'; throw err;
        }
      }

      let validation = validateFieldClose({
        fromStatus: trueFrom, // DB-authoritative — any client fromStatus is ignored
        toStatus: toStatus,
        jobGps: serverJobGps, // DB-authoritative — client jobGps is ignored
        deviceGps: body.deviceGps,
        maxMeters: maxMeters,
        photo: body.photo,
        photoMaxAgeSeconds: photoMaxAgeSeconds,
        photoServerComputedAgeSeconds: photoServerComputedAgeSeconds,
        rxDbm: body.rxDbm,
        opticalSources: opticalSources,
        policy: policy
      });

      let overrideAudit = null;
      if (!validation.ok) {
        const failureCodes = (validation.errors || []).map((x) => String(x.code || x.error || x)).filter((x) => /GEO|REALITY|DISTANCE|LOCATION/i.test(x));
        const override = evaluateOptionalSupervisorOverride({ context: permissionContext, tenantId, failureCodes, override: body.supervisorOverride });
        if (!failureCodes.length || !override.ok) {
          const err = new Error('FIELD_CLOSE_VALIDATION_FAILED');
          err.code = 'FIELD_CLOSE_VALIDATION_FAILED';
          err.detail = validation;
          throw err;
        }
        validation = { ...validation, ok: true, normalized: { ...(validation.normalized || {}), geo: { ...((validation.normalized && validation.normalized.geo) || {}), passed: false, supervisorOverride: true } } };
        overrideAudit = override;
      }

      /* Idempotency: same client key already closed this ticket */
      if (clientIdem) {
        const prior = await client.query(`select id, status from tickets where id = $1::uuid`, [ticketId]);
        if (prior.rowCount && prior.rows[0].status === validation.normalized.toStatus) {
          const priorEv = await client.query(
            `select id from evidence where ticket_id = $1::uuid and content_hash = $2 limit 1`,
            [ticketId, body.photo && body.photo.contentHash]
          );
          if (priorEv.rowCount) {
            return { replay: true, ticket: prior.rows[0], measurementId: null, trueFrom: trueFrom };
          }
        }
      }

      /*
       * SECURITY FIX: there was no defense at all against replaying the same
       * photo content hash against a different ticket (an old/reused photo
       * would pass unnoticed). This is a best-effort application-layer
       * guard — a real fix also wants a DB-level check; see migration
       * 021_measurement_provenance.sql which adds a supporting index.
       */
      if (body.photo && body.photo.contentHash) {
        const reuse = await client.query(
          `select ticket_id from evidence where content_hash = $1 and ticket_id <> $2::uuid limit 1`,
          [body.photo.contentHash, ticketId]
        );
        if (reuse.rowCount) {
          const err = new Error('PHOTO_HASH_REUSED_ACROSS_TICKETS');
          err.code = 'PHOTO_HASH_REUSED_ACROSS_TICKETS';
          err.detail = { otherTicketId: reuse.rows[0].ticket_id };
          throw err;
        }
      }

      const envelope = await createEvidenceEnvelope({
        type: 'field_close',
        ticketId: ticketId,
        actorSub: principal && principal.sub,
        rxDbm: body.rxDbm,
        opticalSources: validation.normalized.opticalSources,
        geo: validation.normalized.geo,
        photo: { contentHash: body.photo && body.photo.contentHash, storageRef: body.photo && body.photo.storageRef },
        ontSerial: body.ontSerial || null,
        boxCode: body.boxCode || null,
        clientIdempotencyKey: clientIdem
      });

      if (clientIdem) {
        const idem = await client.query(
          `insert into field_close_idempotency (tenant_id,ticket_id,idempotency_key,request_hash,response)
           values ($1,$2::uuid,$3,$4,$5::jsonb)
           on conflict (tenant_id,ticket_id,idempotency_key) do nothing
           returning idempotency_key`,
          [tenantId, ticketId, clientIdem, envelope.requestHash, JSON.stringify({ requestHash: envelope.requestHash, ticketId: ticketId })]
        );
        if (!idem.rowCount) {
          const priorIdem = await client.query(`select request_hash from field_close_idempotency where tenant_id=$1 and ticket_id=$2::uuid and idempotency_key=$3`, [tenantId,ticketId,clientIdem]);
          if (priorIdem.rowCount && priorIdem.rows[0].request_hash !== envelope.requestHash) {
            const err = new Error('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'); err.code='IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'; throw err;
          }
          return { replay: true, ticket: cur.rows[0], measurementId: null, trueFrom: trueFrom };
        }
      }

      const to = validation.normalized.toStatus;

      const closeGate = applyAuthoritativeCloseGate(body, validation, toStatus);
      if (!closeGate.allow) {
        const gateOverride = evaluateOptionalSupervisorOverride({ context: permissionContext, tenantId, failureCodes: [closeGate.reason || 'REALITY_GATE_FAILED'], override: body.supervisorOverride });
        if (!gateOverride.ok) {
          const err = new Error('AUTHORITATIVE_CLOSE_GATE_BLOCKED');
          err.code = 'AUTHORITATIVE_CLOSE_GATE_BLOCKED';
          err.gate = closeGate;
          throw err;
        }
        overrideAudit = gateOverride;
      }

      if (overrideAudit && overrideAudit.applied) {
        const event = privilegeAuditEvent({
          action: 'FIELD_CLOSE_SUPERVISOR_OVERRIDE',
          tenantId,
          actorSub: permissionContext.actorSub,
          refId: ticketId,
          detail: { failureCodes: overrideAudit.failureCodes, reason: overrideAudit.reason, authority: overrideAudit.authority }
        });
        await client.query(
          `select fiberos_audit_append($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::uuid,$7::char(64))`,
          [tenantId, permissionContext.actorSub, event.action, event.refId, JSON.stringify(event.detail), ticketId, event.requestHash]
        );
        const overrideLedger = await appendLedgerBlock(client, { eventType: event.action, actorId: permissionContext.actorSub, payload: event, env: process.env });
        if (!overrideLedger.appended) { const err = new Error('PRIVILEGE_AUDIT_LEDGER_REQUIRED'); err.code = 'PRIVILEGE_AUDIT_LEDGER_REQUIRED'; throw err; }
      }

      const primarySource = validation.normalized.opticalSources[0];

      const optSrc = toOpticalSource(primarySource);
      const evSrc = toEvidenceSource(primarySource);

      /*
       * Measurement provenance labeling (partial fix — see
       * migration 021_measurement_provenance.sql). This does NOT prove the
       * reading came from real hardware; it only stops the system from
       * silently implying more trust than it has. Closing this properly
       * requires a signed adapter callback from the actual NMS poller /
       * a paired optical-power-meter session — tracked as follow-up work.
       */
      const provenanceTrust = primarySource === 'nms_poll' ? 'NMS_POLLED_UNVERIFIED' : 'CLIENT_DECLARED';

      const lat = body.deviceGps && body.deviceGps.lat;
      const lng = body.deviceGps && body.deviceGps.lng;

      await client.query(
        `insert into evidence (tenant_id, ticket_id, kind, payload, source, geo, content_hash)
         values ($1::uuid, $2::uuid, 'gps_arrival', $3::jsonb, $4,
                 ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326)::geography,
                 $7)`,
        [
          tenantId,
          ticketId,
          JSON.stringify({
            jobGps: serverJobGps,
            clientJobGpsIgnored: body.jobGps || null,
            deviceGps: body.deviceGps,
            distanceMeters: validation.normalized.geo && validation.normalized.geo.distanceMeters
          }),
          evSrc,
          lng,
          lat,
          body.photo && body.photo.contentHash
        ]
      );

      await client.query(
        `insert into evidence (tenant_id, ticket_id, kind, payload, source, content_hash)
         values ($1::uuid, $2::uuid, 'photo', $3::jsonb, $4, $5)`,
        [
          tenantId,
          ticketId,
          JSON.stringify({
            contentHash: body.photo && body.photo.contentHash,
            capturedAt: body.photo && body.photo.capturedAt,
            serverComputedAgeSeconds: photoServerComputedAgeSeconds
          }),
          evSrc,
          body.photo && body.photo.contentHash
        ]
      );

      await client.query(
        `insert into evidence (tenant_id, ticket_id, kind, payload, source, content_hash)
         values ($1::uuid, $2::uuid, 'rx_reading', $3::jsonb, $4, $5)`,
        [
          tenantId,
          ticketId,
          JSON.stringify({ rxDbm: body.rxDbm, opticalSource: primarySource, provenanceTrust: provenanceTrust }),
          evSrc,
          body.photo && body.photo.contentHash
        ]
      );

      const m = await client.query(
        `insert into optical_measurements (tenant_id, measurement_type, value_numeric, unit, source, measured_by, provenance_trust, source_receipt, observed_at, source_identity, instrument_id, measurement_session_id)
         values ($1, 'rx_power', $2, 'dBm', $3, $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [
          tenantId,
          body.rxDbm,
          optSrc,
          resolvedTechnicianId || null,
          provenanceTrust,
          body.sourceReceipt || null,
          body.observedAt || null,
          body.sourceIdentity || null,
          body.instrumentId || null,
          body.measurementSessionId || null
        ]
      );
      const measurementId = m.rows[0].id;

      // First perform non-status ticket field updates. Status itself is changed
      // only by the DB-authoritative lifecycle function.
      const updFields = await client.query(
        `update tickets
         set rx_power = $1,
             ont_serial = coalesce($2, ont_serial),
             close_measurement_id = $3,
             updated_at = now()
         where id = $4::uuid and tenant_id = $5::uuid and status = $6
         returning id, status, rx_power, ont_serial, updated_at`,
        [body.rxDbm, body.ontSerial || null, measurementId, ticketId, tenantId, trueFrom]
      );
      if (!updFields.rowCount) {
        const err = new Error('TICKET_NOT_UPDATED');
        err.code = 'TICKET_NOT_UPDATED';
        throw err;
      }
      const transitioned = await client.query(
        `select fiberos_transition_ticket($1::uuid, $2::text) as transition`,
        [ticketId, to]
      );
      const transition = transitioned.rows[0].transition;
      const upd = await client.query(
        `select id, status, rx_power, ont_serial, updated_at from tickets where id=$1::uuid`,
        [ticketId]
      );

      const emittedEvent = await appendOperationalEvent(client, {
        tenantId: tenantId,
        correlationId: String(body.correlationId || 'ticket:' + ticketId),
        causationId: null,
        actorId: principal && principal.sub,
        role: principal && principal.role,
        operation: 'field.close',
        networkFamily: String(body.networkFamily || 'unknown').trim().toLowerCase(),
        subjectRef: { type: 'ticket', id: ticketId },
        entityRefs: [
          { type: 'ticket', id: ticketId },
          { type: 'optical_measurement', id: String(measurementId) }
        ],
        truthBoundary: 'FIELD_CLOSE_PERSISTED_WITH_SERVER_PROVENANCE_LABELS; LIVE_HARDWARE_VERIFICATION_REMAINS_EXTERNAL',
        securityClassification: 'restricted',
        provenance: {
          origin: 'services/api/src/routes/fieldClose.js',
          requestHash: envelope.requestHash,
          provenanceTrust: provenanceTrust,
          sourceReceiptPresent: Boolean(body.sourceReceipt),
          sourceIdentityPresent: Boolean(body.sourceIdentity),
          instrumentIdPresent: Boolean(body.instrumentId),
          measurementSessionIdPresent: Boolean(body.measurementSessionId)
        },
        eventType: 'field.close.validated',
        aggregateType: 'ticket',
        aggregateId: ticketId,
        idempotencyKey: 'field-close:' + envelope.idempotencyKey,
        occurredAt: new Date().toISOString(),
        runtimeVerificationStatus: 'UNVERIFIED',
        payload: {
          ticketId: ticketId,
          measurementId: measurementId,
          status: to,
          idempotencyKey: envelope.idempotencyKey,
          eventIdempotencyKey: 'field-close:' + envelope.idempotencyKey,
          requestHash: envelope.requestHash,
          rxDbm: body.rxDbm == null ? null : body.rxDbm,
          opticalSource: primarySource || null,
          provenanceTrust: provenanceTrust,
          transition: transition,
          ledgerBoundary: 'APPEND_ONLY'
        }
      });

      const ledger = await appendLedgerBlock(client, {
        eventType: 'FIELD_CLOSE',
        actorId: principal && principal.sub,
        payload: {
          ticketId: ticketId,
          status: to,
          requestHash: envelope.requestHash,
          rxDbm: body.rxDbm,
          provenanceTrust: provenanceTrust
        },
        env: process.env
      });

      return {
        replay: false,
        ticket: upd.rows[0],
        measurementId: measurementId,
        ledger: ledger,
        envelope: envelope,
        trueFrom: trueFrom,
        provenanceTrust: provenanceTrust
      };
    });

    if (outcome.replay) {
      return {
        status: 200,
        body: {
          ok: true,
          accepted: true,
          persisted: true,
          replay: true,
          authority: 'DB_AUTHORITATIVE',
          ticket: outcome.ticket,
          note: 'Idempotent replay — no duplicate write'
        }
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        accepted: true,
        persisted: true,
        authority: 'DB_AUTHORITATIVE',
        ticket: outcome.ticket,
        measurementId: outcome.measurementId,
        idempotencyKey: outcome.envelope.idempotencyKey,
        requestHash: outcome.envelope.requestHash,
        ledger: outcome.ledger,
        provenanceTrust: outcome.provenanceTrust
      }
    };
  } catch (e) {
    if (e.code === 'TICKET_NOT_FOUND') {
      return { status: 404, body: { ok: false, error: 'TICKET_NOT_FOUND' } };
    }
    if (/TECHNICIAN_READ_SCOPE_REQUIRED|TECHNICIAN_MUTATION_SCOPE_REQUIRED|SUPERVISOR_TECHNICIAN_SCOPE_REQUIRED|TENANT_SCOPE_REQUIRED/.test(String(e.code || ''))) {
      return { status: 403, body: { ok: false, error: e.code } };
    }
    if (e.code === 'FIELD_CLOSE_VALIDATION_FAILED') {
      return {
        status: 422,
        body: { ok: false, error: 'FIELD_CLOSE_VALIDATION_FAILED', errors: e.detail.errors, normalized: e.detail.normalized }
      };
    }
    if (e.code === 'AUTHORITATIVE_CLOSE_GATE_BLOCKED') {
      return {
        status: 422,
        body: { ok: false, error: 'AUTHORITATIVE_CLOSE_GATE_BLOCKED', gate: e.gate || null }
      };
    }
    if (e.code === 'TENANT_CONTEXT_REQUIRED') return { status: 409, body: { ok: false, error: 'TENANT_CONTEXT_REQUIRED' } };
    if (e.code === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST') return { status: 409, body: { ok: false, error: e.code } };
    if (e.code === 'PHOTO_HASH_REUSED_ACROSS_TICKETS') {
      return { status: 409, body: { ok: false, error: 'PHOTO_HASH_REUSED_ACROSS_TICKETS', detail: e.detail } };
    }
    if (e.code === 'TICKET_NOT_UPDATED') {
      return { status: 409, body: { ok: false, error: 'TICKET_NOT_UPDATED', hint: 'status mismatch or RLS' } };
    }
    return {
      status: 500,
      body: { ok: false, error: 'FIELD_CLOSE_PERSIST_FAILED' }
    };
  }
}

module.exports = { handleFieldClose, applyAuthoritativeCloseGate };
