'use strict';

const crypto = require('node:crypto');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { TARGET_LANGUAGE_COUNT, resolveLanguageProfile, negotiateLanguage, buildVoiceSessionPolicy, buildChatSessionPolicy, listLanguageProfiles , probeSpeechAdapter, selectSpeechAdapter, evaluateLanguageDetection } = require('../../../../packages/multilingual-contact-center/src');
const { appendOperationalEvent } = require('../../../../packages/operational-context/src');

const ROLES = Object.freeze(['customer','call_center','ops_manager','area_supervisor','exec','sysadmin']);
const OPERATOR_ROLES = Object.freeze(['call_center','ops_manager','area_supervisor','exec','sysadmin']);

function assertDb(db) {
  if (!db || !db.configured || !db.pool) throw Object.assign(new Error('DATABASE_REQUIRED'), { statusCode: 503, code: 'DATABASE_REQUIRED' });
}
function uuid(value, code = 'UUID_INVALID') {
  const v = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) throw Object.assign(new Error(code), { statusCode: 400, code });
  return v;
}
function key(body) {
  const k = String(body?.idempotencyKey || '').trim();
  if (k.length < 16 || k.length > 160) throw Object.assign(new Error('CC_IDEMPOTENCY_KEY_REQUIRED'), { statusCode: 400, code: 'CC_IDEMPOTENCY_KEY_REQUIRED' });
  return k;
}
async function tenant(client) {
  const r = await client.query('select tenant_id from user_preferences where user_id=auth.uid() limit 1');
  if (!r.rows[0]?.tenant_id) throw Object.assign(new Error('TENANT_CONTEXT_REQUIRED'), { statusCode: 403, code: 'TENANT_CONTEXT_REQUIRED' });
  return r.rows[0].tenant_id;
}
function rejectClientTenant(body) {
  if (body && (Object.prototype.hasOwnProperty.call(body, 'tenantId') || Object.prototype.hasOwnProperty.call(body, 'tenant_id'))) throw Object.assign(new Error('TENANT_ID_FORBIDDEN'), { statusCode: 400, code: 'TENANT_ID_FORBIDDEN' });
}
function hashContent(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function assertMessageLocaleMatchesProfile(locale, profile, code) {
  const requested = String(locale || '').trim();
  if (!requested) throw Object.assign(new Error(code + '_REQUIRED'), { statusCode: 400, code: code + '_REQUIRED' });
  if (!profile || !profile.defaultLocale || requested.toLowerCase() !== String(profile.defaultLocale).toLowerCase()) throw Object.assign(new Error(code + '_MISMATCH'), { statusCode: 400, code: code + '_MISMATCH' });
  return requested;
}

function validateMessageLocales({ sourceLanguage, sourceLocale, targetLanguage, targetLocale }) {
  let normalizedSourceLocale = null;
  if (sourceLocale != null && String(sourceLocale).trim() !== '') {
    if (!sourceLanguage) throw Object.assign(new Error('CC_SOURCE_LOCALE_LANGUAGE_REQUIRED'), { statusCode: 400, code: 'CC_SOURCE_LOCALE_LANGUAGE_REQUIRED' });
    normalizedSourceLocale = assertMessageLocaleMatchesProfile(sourceLocale, sourceLanguage, 'CC_SOURCE_LOCALE');
  }
  if (!targetLanguage) throw Object.assign(new Error('CC_TARGET_LANGUAGE_REQUIRED'), { statusCode: 400, code: 'CC_TARGET_LANGUAGE_REQUIRED' });
  const normalizedTargetLocale = assertMessageLocaleMatchesProfile(targetLocale || targetLanguage.defaultLocale, targetLanguage, 'CC_TARGET_LOCALE');
  return Object.freeze({ sourceLocale: normalizedSourceLocale, targetLocale: normalizedTargetLocale });
}

function clientDeclaredMessageEvidence(body = {}) {
  const supplied = (field) => body[field] != null && String(body[field]).trim() !== '';
  return Object.freeze({
    evidenceClass: 'declared',
    metadata: Object.freeze({
      translationRequested: Boolean(body.translate),
      runtime: 'UNVERIFIED',
      sourceLocaleTrust: supplied('sourceLocale') ? 'CLIENT_DECLARED_UNVERIFIED' : 'NOT_PROVIDED',
      targetLocaleTrust: supplied('targetLocale') ? 'CLIENT_DECLARED_UNVERIFIED' : 'SERVER_PROFILE_DEFAULT',
      audioReferenceTrust: supplied('audioReference') ? 'CLIENT_DECLARED_UNVERIFIED' : 'NOT_PROVIDED',
      providerReferenceTrust: supplied('providerReference') ? 'CLIENT_DECLARED_UNVERIFIED' : 'NOT_PROVIDED'
    })
  });
}

function parseTrustedJsonObjectEnv(name) {
  const raw = process.env[name];
  if (!raw) return Object.freeze({});
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) {
    throw Object.assign(new Error('SPEECH_RUNTIME_CONFIG_INVALID'), { statusCode: 503, code: 'SPEECH_RUNTIME_CONFIG_INVALID' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('SPEECH_RUNTIME_CONFIG_INVALID'), { statusCode: 503, code: 'SPEECH_RUNTIME_CONFIG_INVALID' });
  }
  return Object.freeze(parsed);
}

function trustedSpeechConfig() {
  return Object.freeze({
    nativeLocalesByProvider: parseTrustedJsonObjectEnv('FIBEROS_SPEECH_NATIVE_LOCALES_JSON'),
    credentialsByProvider: parseTrustedJsonObjectEnv('FIBEROS_SPEECH_CREDENTIALS_PRESENT_JSON'),
    mediaBridgeReachable: process.env.FIBEROS_ASTERISK_MEDIA_BRIDGE_REACHABLE === 'true'
  });
}

async function handleMultilingualContactCenter(req, res, ctx) {
  const { method, path, body, principal, db, send } = ctx;
  const isRoute = path === '/v1/contact-center/languages' || path === '/v1/contact-center/conversations' ||
    path === '/v1/contact-center/speech/probe' ||
    path === '/v1/contact-center/speech/select' ||
    /^\/v1\/contact-center\/conversations\/[0-9a-f-]+$/.test(path) ||
    /^\/v1\/contact-center\/conversations\/[0-9a-f-]+\/messages$/.test(path) ||
    /^\/v1\/contact-center\/conversations\/[0-9a-f-]+\/language$/.test(path);
  if (!isRoute) return null;

  const verified = requireVerifiedPrincipal(principal, process.env);
  if (!verified.ok) return send(res, verified.status, verified.body);
  const role = requireAnyRole(principal, ROLES);
  if (!role.ok) return send(res, role.status, role.body);

  if (method === 'GET' && path === '/v1/contact-center/languages') {
    return send(res, 200, { ok: true, languageCount: TARGET_LANGUAGE_COUNT, profiles: listLanguageProfiles(),
      dialectPolicy: 'EXACT_LOCALE_FIRST; SILENT DIALECT FALLBACK FORBIDDEN',
      voicePolicy: 'STREAMING_ASR_TTS; FULL_DUPLEX; BARGE_IN',
      chatPolicy: 'BIDIRECTIONAL_LANGUAGE_AWARE', authority: 'FIBEROS_LANGUAGE_POLICY', runtimeVerification: 'NOT_CONNECTED' });
  }

  // Speech adapter capability probe — no live media connection claimed
    if (method === 'POST' && path === '/v1/contact-center/speech/probe') {
    rejectClientTenant(body);
    const speechConfig = trustedSpeechConfig();
    const provider = body?.provider || 'LOCAL_SOVEREIGN';
    const probe = probeSpeechAdapter({
      provider,
      locale: body?.locale,
      declaredNativeLocales: Array.isArray(speechConfig.nativeLocalesByProvider[provider]) ? speechConfig.nativeLocalesByProvider[provider] : [],
      credentialsPresent: speechConfig.credentialsByProvider[provider] === true,
      mediaBridgeReachable: speechConfig.mediaBridgeReachable
    });
    return send(res, 200, { ok: true, probe, authority: 'SPEECH_ADAPTER_BOUNDARY', runtimeVerification: 'NOT_CONNECTED' });
  }

    if (method === 'POST' && path === '/v1/contact-center/speech/select') {
    rejectClientTenant(body);
    const speechConfig = trustedSpeechConfig();
    const selection = selectSpeechAdapter({
      locale: body?.locale,
      preferredProviders: Array.isArray(body?.preferredProviders) ? body?.preferredProviders : undefined,
      declaredNativeLocalesByProvider: speechConfig.nativeLocalesByProvider,
      credentialsByProvider: speechConfig.credentialsByProvider,
      mediaBridgeReachable: speechConfig.mediaBridgeReachable
    });
    return send(res, 200, { ok: true, selection, authority: 'SPEECH_ADAPTER_BOUNDARY', runtimeVerification: 'NOT_CONNECTED' });
  }

  assertDb(db);

  if (method === 'POST' && path === '/v1/contact-center/conversations') {
    rejectClientTenant(body);
    const requestKey = key(body);
    const channel = String(body?.channel || '').trim().toUpperCase();
    if (!['VOICE','CHAT'].includes(channel)) throw Object.assign(new Error('CC_CHANNEL_INVALID'), { statusCode: 400, code: 'CC_CHANNEL_INVALID' });
    if (channel === 'VOICE' && String(principal?.role || '').toLowerCase() === 'customer') throw Object.assign(new Error('CC_CUSTOMER_VOICE_ADMIN_ROUTE_FORBIDDEN'), { statusCode: 403, code: 'CC_CUSTOMER_VOICE_ADMIN_ROUTE_FORBIDDEN' });
    const response = await withPrincipal(db, principal, async client => {
      const tid = await tenant(client);
      const existing = await client.query('select id,channel,call_session_id,customer_ref,language_code,locale,dialect_mode,language_confidence,language_source,adapter_mode,voice_profile,status,correlation_id,idempotency_key,created_at,updated_at from contact_center_conversations where tenant_id=$1 and idempotency_key=$2', [tid, requestKey]);
      if (existing.rows[0]) return { status: 200, body: { ok: true, conversation: existing.rows[0], replayed: true } };
      const callSessionId = body?.callSessionId ? uuid(body.callSessionId, 'CC_CALL_SESSION_ID_INVALID') : null;
      if (channel === 'VOICE' && !callSessionId) throw Object.assign(new Error('CC_VOICE_CALL_SESSION_REQUIRED'), { statusCode: 400, code: 'CC_VOICE_CALL_SESSION_REQUIRED' });
      if (callSessionId) {
        const cs = await client.query('select id from call_sessions where tenant_id=$1 and id=$2::uuid for update', [tid, callSessionId]);
        if (!cs.rows[0]) throw Object.assign(new Error('CC_CALL_SESSION_NOT_FOUND'), { statusCode: 404, code: 'CC_CALL_SESSION_NOT_FOUND' });
      }
      const negotiation = negotiateLanguage({ requestedLanguage: body?.languageCode, requestedLocale: body?.locale, detectedLanguage: body?.detectedLanguage, detectedLocale: body?.detectedLocale, confidence: body?.confidence });
      const adapterMode = body?.adapterMode || 'LOCAL_SOVEREIGN';
      if (negotiation.handoffRequired && !negotiation.profile) throw Object.assign(new Error('CC_LANGUAGE_HANDOFF_NO_PROFILE'), { statusCode: 409, code: 'CC_LANGUAGE_HANDOFF_NO_PROFILE' });
      const profile = negotiation.profile || resolveLanguageProfile({ languageCode: negotiation.languageCode });
      const speechConfig = channel === 'VOICE' ? trustedSpeechConfig() : null;
      const speechProvider = adapterMode === 'EXTERNAL_OPTIONAL' ? (body?.speechProvider || 'AZURE_SPEECH') : 'LOCAL_SOVEREIGN';
      const speechProbe = channel === 'VOICE' ? probeSpeechAdapter({
        provider: speechProvider,
        locale: negotiation.locale,
        declaredNativeLocales: Array.isArray(speechConfig.nativeLocalesByProvider[speechProvider]) ? speechConfig.nativeLocalesByProvider[speechProvider] : [],
        credentialsPresent: speechConfig.credentialsByProvider[speechProvider] === true,
        mediaBridgeReachable: speechConfig.mediaBridgeReachable
      }) : null;
      const policy = channel === 'VOICE'
        ? buildVoiceSessionPolicy({ profile, adapterMode, exactDialectRequired: body?.exactDialectRequired !== false, locale: negotiation.locale, handoffRequired: negotiation.handoffRequired, speechProbe })
        : buildChatSessionPolicy({
        profile,
        adapterMode,
        locale: negotiation.locale,
        handoffRequired: negotiation.handoffRequired
      });
      const conversationStatus = (negotiation.handoffRequired || (speechProbe && speechProbe.handoffRequired)) ? 'HANDOFF_REQUIRED' : 'ACTIVE';
      const correlationId = String(body?.correlationId || 'cc:' + channel.toLowerCase() + ':' + crypto.randomUUID());
      const inserted = await client.query('insert into contact_center_conversations(tenant_id,channel,call_session_id,customer_ref,language_code,locale,dialect_mode,language_confidence,language_source,adapter_mode,voice_profile,status,created_by,correlation_id,idempotency_key,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,auth.uid(),$13,$14,$15::jsonb) returning id,channel,call_session_id,customer_ref,language_code,locale,dialect_mode,language_confidence,language_source,adapter_mode,voice_profile,status,correlation_id,idempotency_key,created_at,updated_at',
        [tid, channel, callSessionId, body?.customerRef ? String(body.customerRef).slice(0, 160) : null, negotiation.languageCode, negotiation.locale, policy.dialectMode, negotiation.confidence, negotiation.source, policy.adapterMode, channel === 'VOICE' ? String(body?.voiceProfile || negotiation.locale).slice(0, 160) : null, conversationStatus, correlationId, requestKey, JSON.stringify({ requestedLocale: body?.locale || null, detectedLocale: body?.detectedLocale || null, exactDialectRequired: policy.exactDialectRequired ?? true, handoffRequired: conversationStatus === 'HANDOFF_REQUIRED', speechProbe: speechProbe ? { status: speechProbe.status, reason: speechProbe.reason, nativeVoiceAvailable: speechProbe.nativeVoiceAvailable } : null, runtime: 'UNVERIFIED' })]);
      if (callSessionId) await client.query("update call_sessions set language_code=$1,locale=$2,dialect_mode=$3,language_confidence=$4,language_source=$5,voice_profile=$6,speech_adapter_mode=$7 where tenant_id=$8 and id=$9::uuid",
        [negotiation.languageCode, negotiation.locale, policy.dialectMode, negotiation.confidence, negotiation.source, channel === 'VOICE' ? String(body?.voiceProfile || negotiation.locale).slice(0, 160) : null, policy.adapterMode, tid, callSessionId]);
      const emitted = await appendOperationalEvent(client, { tenantId: tid, correlationId, actorId: principal?.sub || null, role: principal?.role || null, operation: 'contact-center.conversation.create', networkFamily: 'unknown', subjectRef: { type: 'contact_center_conversation', id: String(inserted.rows[0].id) }, entityRefs: [{ type: 'contact_center_conversation', id: String(inserted.rows[0].id) }, ...(callSessionId ? [{ type: 'call_session', id: String(callSessionId) }] : [])], truthBoundary: channel === 'VOICE' ? 'LANGUAGE_AND_MEDIA_POLICY_PERSISTED; TELEPHONY_MEDIA_CONNECTION_AND_SPEECH_MODEL_EXECUTION_REQUIRE_RUNTIME_ADAPTER' : 'LANGUAGE_POLICY_AND_CHAT_CONVERSATION_PERSISTED; MODEL_RESPONSE_EXECUTION_REQUIRES_RUNTIME_ADAPTER', securityClassification: 'restricted', provenance: { origin: 'services/api/src/routes/contactCenterMultilingual.js', languageCode: negotiation.languageCode, locale: negotiation.locale, languageSource: negotiation.source, adapterMode: policy.adapterMode }, eventType: 'contact_center.conversation.created', aggregateType: 'contact_center_conversation', aggregateId: String(inserted.rows[0].id), idempotencyKey: 'cc-conversation:' + requestKey, runtimeVerificationStatus: 'UNVERIFIED', payload: { channel, conversationId: inserted.rows[0].id, callSessionId, languageCode: negotiation.languageCode, locale: negotiation.locale, dialectMode: policy.dialectMode, adapterMode: policy.adapterMode, policy } });
      let handoffEvent = null;
      if (conversationStatus === 'HANDOFF_REQUIRED') {
        handoffEvent = await appendOperationalEvent(client, {
          tenantId: tid,
          correlationId,
          causationId: emitted.outbox.event_id,
          actorId: principal?.sub || null,
          role: principal?.role || null,
          operation: 'contact-center.handoff.required',
          networkFamily: 'unknown',
          subjectRef: { type: 'contact_center_conversation', id: String(inserted.rows[0].id) },
          entityRefs: [
            { type: 'contact_center_conversation', id: String(inserted.rows[0].id) },
            ...(callSessionId ? [{ type: 'call_session', id: String(callSessionId) }] : [])
          ],
          truthBoundary: 'HUMAN_HANDOFF_REQUIRED_PERSISTED; HUMAN_AGENT_ASSIGNMENT_AND_TELEPHONY_MEDIA_DELIVERY_REQUIRE_RUNTIME_SYSTEMS',
          securityClassification: 'restricted',
          provenance: {
            origin: 'services/api/src/routes/contactCenterMultilingual.js',
            reason: speechProbe?.reason || (negotiation.handoffRequired ? 'LANGUAGE_NEGOTIATION_HANDOFF_REQUIRED' : 'SPEECH_ADAPTER_HANDOFF_REQUIRED'),
            requestedLocale: negotiation.locale,
            adapterMode: policy.adapterMode
          },
          eventType: 'contact_center.handoff.required',
          aggregateType: 'contact_center_conversation',
          aggregateId: String(inserted.rows[0].id),
          idempotencyKey: 'cc-handoff:' + requestKey,
          runtimeVerificationStatus: 'UNVERIFIED',
          payload: {
            conversationId: inserted.rows[0].id,
            locale: negotiation.locale,
            languageCode: negotiation.languageCode,
            reason: speechProbe?.reason || (negotiation.handoffRequired ? 'LANGUAGE_NEGOTIATION_HANDOFF_REQUIRED' : 'SPEECH_ADAPTER_HANDOFF_REQUIRED')
          }
        });
      }
      return { status: 201, body: { ok: true, conversation: inserted.rows[0], policy, runtime: { adapterConfigured: false, telephonyConfirmed: false, speechExecution: 'UNVERIFIED' }, event: { outboxEventId: emitted.outbox.event_id, canonicalEventVersion: emitted.envelope.schema, correlationId: emitted.envelope.correlationId, integritySha256: emitted.envelope.integritySha256 }, handoffEvent: handoffEvent ? { outboxEventId: handoffEvent.outbox.event_id, integritySha256: handoffEvent.envelope.integritySha256 } : null } };
    });
    return send(res, response.status, response.body);
  }

  const languagePath = path.match(/^\/v1\/contact-center\/conversations\/([0-9a-f-]+)\/language$/i);
  if (method === 'POST' && languagePath) {
    if (!OPERATOR_ROLES.includes(String(principal?.role || '').toLowerCase())) throw Object.assign(new Error('CC_LANGUAGE_OVERRIDE_OPERATOR_REQUIRED'), { statusCode: 403, code: 'CC_LANGUAGE_OVERRIDE_OPERATOR_REQUIRED' });
    rejectClientTenant(body); const conversationId = uuid(languagePath[1], 'CC_CONVERSATION_ID_INVALID'); const requestKey = key(body);
    return withPrincipal(db, principal, async client => {
      await client.query('BEGIN');
      try {
        const tid = await tenant(client);
        const current = await client.query('select id,channel,call_session_id,adapter_mode,status,correlation_id from contact_center_conversations where tenant_id=$1 and id=$2 for update', [tid, conversationId]);
        if (!current.rows[0]) throw Object.assign(new Error('CC_CONVERSATION_NOT_FOUND'), { statusCode: 404, code: 'CC_CONVERSATION_NOT_FOUND' });
        if (current.rows[0].status === 'COMPLETED') throw Object.assign(new Error('CC_CONVERSATION_COMPLETED'), { statusCode: 409, code: 'CC_CONVERSATION_COMPLETED' });
        const negotiation = negotiateLanguage({ requestedLanguage: body?.languageCode, requestedLocale: body?.locale, detectedLanguage: body?.detectedLanguage, detectedLocale: body?.detectedLocale, confidence: body?.confidence });
        const profile = resolveLanguageProfile({ languageCode: negotiation.languageCode });
        const speechConfig = current.rows[0].channel === 'VOICE' ? trustedSpeechConfig() : null;
        const speechProvider = current.rows[0].adapter_mode === 'EXTERNAL_OPTIONAL' ? (body?.speechProvider || 'AZURE_SPEECH') : 'LOCAL_SOVEREIGN';
        const speechProbe = current.rows[0].channel === 'VOICE' ? probeSpeechAdapter({
          provider: speechProvider,
          locale: negotiation.locale,
          declaredNativeLocales: Array.isArray(speechConfig.nativeLocalesByProvider[speechProvider]) ? speechConfig.nativeLocalesByProvider[speechProvider] : [],
          credentialsPresent: speechConfig.credentialsByProvider[speechProvider] === true,
          mediaBridgeReachable: speechConfig.mediaBridgeReachable
        }) : null;
        const policy = current.rows[0].channel === 'VOICE'
          ? buildVoiceSessionPolicy({ profile, adapterMode: current.rows[0].adapter_mode, exactDialectRequired: body?.exactDialectRequired !== false, locale: negotiation.locale, handoffRequired: negotiation.handoffRequired, speechProbe })
          : buildChatSessionPolicy({
          profile,
          adapterMode: current.rows[0].adapter_mode,
          locale: negotiation.locale,
          handoffRequired: negotiation.handoffRequired
        });
        const overrideStatus = negotiation.handoffRequired || (speechProbe && speechProbe.handoffRequired) ? 'HANDOFF_REQUIRED' : current.rows[0].status;
        const voiceProfile = current.rows[0].channel === 'VOICE' ? String(body?.voiceProfile || negotiation.locale).slice(0, 160) : null;
        const updated = await client.query("update contact_center_conversations set language_code=$1,locale=$2,dialect_mode=$3,language_confidence=$4,language_source='AGENT_OVERRIDE',voice_profile=$5,status=$6,updated_at=now(),metadata=metadata || $7::jsonb where tenant_id=$8 and id=$9 returning id,channel,call_session_id,language_code,locale,dialect_mode,language_confidence,language_source,adapter_mode,voice_profile,status,updated_at",
          [negotiation.languageCode, negotiation.locale, policy.dialectMode, negotiation.confidence, voiceProfile, overrideStatus, JSON.stringify({ languageChangeIdempotencyKey: requestKey, handoffRequired: overrideStatus === 'HANDOFF_REQUIRED' }), tid, conversationId]);
        if (current.rows[0].call_session_id) await client.query("update call_sessions set language_code=$1,locale=$2,dialect_mode=$3,language_confidence=$4,language_source='AGENT_OVERRIDE',voice_profile=$5,speech_adapter_mode=$6 where tenant_id=$7 and id=$8", [negotiation.languageCode, negotiation.locale, policy.dialectMode, negotiation.confidence, voiceProfile, current.rows[0].adapter_mode, tid, current.rows[0].call_session_id]);
        const emitted = await appendOperationalEvent(client, { tenantId: tid, correlationId: current.rows[0].correlation_id || ('cc:conversation:' + conversationId), causationId: null, actorId: principal?.sub || null, role: principal?.role || null, operation: 'contact-center.language.override', networkFamily: 'unknown', subjectRef: { type: 'contact_center_conversation', id: String(conversationId) }, entityRefs: [{ type: 'contact_center_conversation', id: String(conversationId) }], truthBoundary: 'AGENT_LANGUAGE_SELECTION_PERSISTED; SPEECH MODEL QUALITY AND DIALECT FIDELITY REQUIRE RUNTIME ADAPTER VALIDATION', securityClassification: 'restricted', provenance: { origin: 'services/api/src/routes/contactCenterMultilingual.js', languageChangeIdempotencyKey: requestKey, source: 'AGENT_OVERRIDE' }, eventType: 'contact_center.language.overridden', aggregateType: 'contact_center_conversation', aggregateId: conversationId, idempotencyKey: 'cc-language:' + requestKey, runtimeVerificationStatus: 'UNVERIFIED', payload: { conversationId, languageCode: negotiation.languageCode, locale: negotiation.locale, dialectMode: policy.dialectMode, policy } });
        let handoffEvent = null;
        if (overrideStatus === 'HANDOFF_REQUIRED') {
          handoffEvent = await appendOperationalEvent(client, {
            tenantId: tid,
            correlationId: current.rows[0].correlation_id || ('cc:conversation:' + conversationId),
            causationId: emitted.outbox.event_id,
            actorId: principal?.sub || null,
            role: principal?.role || null,
            operation: 'contact-center.handoff.required',
            networkFamily: 'unknown',
            subjectRef: { type: 'contact_center_conversation', id: String(conversationId) },
            entityRefs: [
              { type: 'contact_center_conversation', id: String(conversationId) },
              ...(current.rows[0].call_session_id ? [{ type: 'call_session', id: String(current.rows[0].call_session_id) }] : [])
            ],
            truthBoundary: 'HUMAN_HANDOFF_REQUIRED_PERSISTED; HUMAN_AGENT_ASSIGNMENT_AND_TELEPHONY_MEDIA_DELIVERY_REQUIRE_RUNTIME_SYSTEMS',
            securityClassification: 'restricted',
            provenance: {
              origin: 'services/api/src/routes/contactCenterMultilingual.js',
              reason: speechProbe?.reason || (negotiation.handoffRequired ? 'LANGUAGE_NEGOTIATION_HANDOFF_REQUIRED' : 'SPEECH_ADAPTER_HANDOFF_REQUIRED'),
              requestedLocale: negotiation.locale,
              adapterMode: current.rows[0].adapter_mode
            },
            eventType: 'contact_center.handoff.required',
            aggregateType: 'contact_center_conversation',
            aggregateId: String(conversationId),
            idempotencyKey: 'cc-language-handoff:' + requestKey,
            runtimeVerificationStatus: 'UNVERIFIED',
            payload: {
              conversationId,
              locale: negotiation.locale,
              languageCode: negotiation.languageCode,
              reason: speechProbe?.reason || (negotiation.handoffRequired ? 'LANGUAGE_NEGOTIATION_HANDOFF_REQUIRED' : 'SPEECH_ADAPTER_HANDOFF_REQUIRED'),
              source: 'AGENT_OVERRIDE'
            }
          });
        }
        await client.query('COMMIT'); return send(res, 200, { ok: true, conversation: updated.rows[0], policy, event: { outboxEventId: emitted.outbox.event_id, integritySha256: emitted.envelope.integritySha256 }, handoffEvent: handoffEvent ? { outboxEventId: handoffEvent.outbox.event_id, integritySha256: handoffEvent.envelope.integritySha256 } : null });
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    });
  }

  const msg = path.match(/^\/v1\/contact-center\/conversations\/([0-9a-f-]+)\/messages$/i);
  if (method === 'POST' && msg) {
    rejectClientTenant(body); const conversationId = uuid(msg[1], 'CC_CONVERSATION_ID_INVALID'); const requestKey = key(body);
    const direction = String(body?.direction || '').trim().toUpperCase(); const messageType = String(body?.messageType || 'TEXT').trim().toUpperCase(); const content = String(body?.content || '');
    if (!['CUSTOMER_TO_SYSTEM','SYSTEM_TO_CUSTOMER','AGENT_TO_CUSTOMER'].includes(direction)) throw Object.assign(new Error('CC_MESSAGE_DIRECTION_INVALID'), { statusCode: 400, code: 'CC_MESSAGE_DIRECTION_INVALID' });
    if (String(principal?.role || '').toLowerCase() === 'customer' && direction !== 'CUSTOMER_TO_SYSTEM') throw Object.assign(new Error('CC_CUSTOMER_MESSAGE_DIRECTION_FORBIDDEN'), { statusCode: 403, code: 'CC_CUSTOMER_MESSAGE_DIRECTION_FORBIDDEN' });
    if (!['TEXT','TRANSCRIPT','TRANSLATION','SYSTEM_EVENT'].includes(messageType)) throw Object.assign(new Error('CC_MESSAGE_TYPE_INVALID'), { statusCode: 400, code: 'CC_MESSAGE_TYPE_INVALID' });
    if (!content || content.length > 20000) throw Object.assign(new Error('CC_MESSAGE_CONTENT_INVALID'), { statusCode: 400, code: 'CC_MESSAGE_CONTENT_INVALID' });
    return withPrincipal(db, principal, async client => {
      await client.query('BEGIN');
      try {
        const tid = await tenant(client);
        const conversation = await client.query('select id,channel,language_code,locale,dialect_mode,status,correlation_id from contact_center_conversations where tenant_id=$1 and id=$2 for update', [tid, conversationId]);
        if (!conversation.rows[0]) throw Object.assign(new Error('CC_CONVERSATION_NOT_FOUND'), { statusCode: 404, code: 'CC_CONVERSATION_NOT_FOUND' });
        if (!['ACTIVE','HANDOFF_REQUIRED'].includes(conversation.rows[0].status)) throw Object.assign(new Error('CC_CONVERSATION_NOT_ACTIVE'), { statusCode: 409, code: 'CC_CONVERSATION_NOT_ACTIVE' });
        const sourceLanguage = body?.sourceLanguageCode ? resolveLanguageProfile({ languageCode: body.sourceLanguageCode }) : null;
        const targetLanguage = body?.targetLanguageCode ? resolveLanguageProfile({ languageCode: body.targetLanguageCode }) : resolveLanguageProfile({ languageCode: conversation.rows[0].language_code });
        const localeValidation = validateMessageLocales({
          sourceLanguage,
          sourceLocale: body?.sourceLocale ? String(body.sourceLocale).trim().slice(0, 160) : null,
          targetLanguage,
          targetLocale: body?.targetLocale ? String(body.targetLocale).trim().slice(0, 160) : targetLanguage.defaultLocale
        });
        const sourceLocale = localeValidation.sourceLocale;
        const targetLocale = localeValidation.targetLocale;
        const audioReference = body?.audioReference ? String(body.audioReference).slice(0, 500) : null;
        const providerReference = body?.providerReference ? String(body.providerReference).slice(0, 500) : null;
        const messageEvidence = clientDeclaredMessageEvidence(body);
        const hash = hashContent({ content, direction, messageType, sourceLanguageCode: sourceLanguage?.code || null, sourceLocale, targetLanguageCode: targetLanguage.code, targetLocale, audioReference, providerReference });
        const ins = await client.query('insert into contact_center_conversation_messages(tenant_id,conversation_id,direction,message_type,source_language_code,source_locale,target_language_code,target_locale,dialect_mode,content,audio_reference,provider_reference,evidence_class,content_sha256,idempotency_key,actor_id,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,auth.uid(),$16::jsonb) on conflict(tenant_id,idempotency_key) do nothing returning id,conversation_id,direction,message_type,source_language_code,source_locale,target_language_code,target_locale,dialect_mode,content,audio_reference,provider_reference,evidence_class,content_sha256,idempotency_key,actor_id,occurred_at',
          [tid, conversationId, direction, messageType, sourceLanguage?.code || null, sourceLocale, targetLanguage.code, targetLocale, conversation.rows[0].dialect_mode, content, audioReference, providerReference, messageEvidence.evidenceClass, hash, requestKey, JSON.stringify(messageEvidence.metadata)]);
        if (!ins.rows[0]) { const replay = await client.query('select id,conversation_id,direction,message_type,source_language_code,source_locale,target_language_code,target_locale,dialect_mode,content,audio_reference,provider_reference,evidence_class,content_sha256,idempotency_key,actor_id,occurred_at from contact_center_conversation_messages where tenant_id=$1 and idempotency_key=$2', [tid, requestKey]); await client.query('COMMIT'); return send(res, 200, { ok: true, message: replay.rows[0], replayed: true }); }
        const emitted = await appendOperationalEvent(client, { tenantId: tid, correlationId: conversation.rows[0].correlation_id, actorId: principal?.sub || null, role: principal?.role || null, operation: 'contact-center.message.persist', networkFamily: 'unknown', subjectRef: { type: 'contact_center_conversation', id: String(conversationId) }, entityRefs: [{ type: 'contact_center_conversation_message', id: String(ins.rows[0].id) }], truthBoundary: 'MESSAGE_PERSISTED_AS_CONVERSATION_RECORD; TRANSLATION, ASR, TTS, AND MODEL RESPONSE REQUIRE THE CONFIGURED SPEECH/AI ADAPTER', securityClassification: 'restricted', provenance: { origin: 'services/api/src/routes/contactCenterMultilingual.js', messageId: String(ins.rows[0].id), messageType, sourceLanguageCode: sourceLanguage?.code || null, targetLanguageCode: targetLanguage.code }, eventType: 'contact_center.message.persisted', aggregateType: 'contact_center_conversation', aggregateId: conversationId, idempotencyKey: 'cc-message:' + requestKey, runtimeVerificationStatus: 'UNVERIFIED', payload: { messageId: ins.rows[0].id, direction, messageType, contentSha256: hash, sourceLanguageCode: sourceLanguage?.code || null, targetLanguageCode: targetLanguage.code } });
        await client.query('COMMIT'); return send(res, 201, { ok: true, message: ins.rows[0], translation: { requested: Boolean(body?.translate), direction: sourceLanguage ? sourceLanguage.code + '->' + targetLanguage.code : 'session->' + targetLanguage.code, execution: 'UNVERIFIED_ADAPTER' }, event: { outboxEventId: emitted.outbox.event_id, integritySha256: emitted.envelope.integritySha256 } });
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    });
  }

  const single = path.match(/^\/v1\/contact-center\/conversations\/([0-9a-f-]+)$/i);
  if (method === 'GET' && single) {
    const conversationId = uuid(single[1], 'CC_CONVERSATION_ID_INVALID');
    return withPrincipal(db, principal, async client => {
      const tid = await tenant(client);
      const conversation = await client.query('select id,channel,call_session_id,customer_ref,language_code,locale,dialect_mode,language_confidence,language_source,adapter_mode,voice_profile,status,correlation_id,created_at,updated_at from contact_center_conversations where tenant_id=$1 and id=$2', [tid, conversationId]);
      if (!conversation.rows[0]) throw Object.assign(new Error('CC_CONVERSATION_NOT_FOUND'), { statusCode: 404, code: 'CC_CONVERSATION_NOT_FOUND' });
      const messages = await client.query('select id,direction,message_type,source_language_code,source_locale,target_language_code,target_locale,dialect_mode,content,audio_reference,provider_reference,evidence_class,content_sha256,idempotency_key,actor_id,occurred_at from contact_center_conversation_messages where tenant_id=$1 and conversation_id=$2 order by occurred_at asc,id asc limit 500', [tid, conversationId]);
      return send(res, 200, { ok: true, conversation: conversation.rows[0], messages: messages.rows, runtime: { adapterConfigured: false, telephonyConfirmed: false, speechExecution: 'UNVERIFIED' } });
    });
  }
  return null;
}

module.exports = { handleMultilingualContactCenter, clientDeclaredMessageEvidence, assertMessageLocaleMatchesProfile, validateMessageLocales };
