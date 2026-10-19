'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { clientDeclaredMessageEvidence } = require('../src/routes/contactCenterMultilingual');

const ROOT = path.resolve(__dirname, '../../..');

test('84-language registry is source-backed and exact-locale-first', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages/multilingual-contact-center/src/index.js'), 'utf8');
  assert.match(source, /TARGET_LANGUAGE_COUNT = 84/);
  assert.match(source, /LANGUAGE_PROFILES.length !== TARGET_LANGUAGE_COUNT/);
  assert.match(source, /EXACT_LOCALE_FIRST|EXACT_LOCALE/);
  assert.match(source, /silentFallbackForbidden: true/);
  assert.match(source, /languageIdentification: 'AUTOMATIC_PREFERRED'/);
});

test('voice policy contains secure realtime media and barge-in requirements', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages/multilingual-contact-center/src/index.js'), 'utf8');
  assert.match(source, /signaling: 'SIP_TLS'/);
  assert.match(source, /browser: 'WSS_WEBRTC'/);
  assert.match(source, /audio: 'SRTP'/);
  assert.match(source, /duplex: 'FULL_DUPLEX'/);
  assert.match(source, /bargeIn: true/);
  assert.match(source, /streamingAsr: true/);
  assert.match(source, /streamingTts: true/);
});

test('customer chat is scoped and cannot assume telephony execution', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/contactCenterMultilingual.js'), 'utf8');
  const migration = fs.readFileSync(path.join(ROOT, 'sql/migrations/154_multilingual_contact_center_conversations.sql'), 'utf8');
  assert.match(route, /CC_CUSTOMER_VOICE_ADMIN_ROUTE_FORBIDDEN/);
  assert.match(route, /CC_CUSTOMER_MESSAGE_DIRECTION_FORBIDDEN/);
  assert.match(route, /speechExecution: 'UNVERIFIED'/);
  assert.match(migration, /cc_conversations_customer/);
  assert.match(migration, /created_by = auth.uid()/);
  assert.match(migration, /cc_messages_customer/);
});

test('multilingual API is centrally registered and protected', () => {
  const server = fs.readFileSync(path.join(ROOT, 'services/api/src/server.js'), 'utf8');
  const policy = fs.readFileSync(path.join(ROOT, 'services/api/src/routeAuthorizationPolicy.js'), 'utf8');
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/contactCenterMultilingual.js'), 'utf8');
  assert.match(server, /handleMultilingualContactCenter/);
  assert.match(server, /GET \/v1\/contact-center\/languages/);
  assert.match(policy, /contact-center\/conversations/);
  assert.match(policy, /contact-center\/languages/);
  const createConversation = route.split("if (method === 'POST' && path === '/v1/contact-center/conversations') {")[1].split("const languagePath =")[0];
  assert.match(createConversation, /withPrincipal\(db, principal, async client =>/);
  assert.doesNotMatch(createConversation, /db\.pool\.connect\(\)|client\.query\('BEGIN'\)|client\.query\('COMMIT'\)/);
});

test('speech runtime claims are server-trusted, never client-declared', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/contactCenterMultilingual.js'), 'utf8');
  assert.match(route, /FIBEROS_SPEECH_NATIVE_LOCALES_JSON/);
  assert.match(route, /FIBEROS_SPEECH_CREDENTIALS_PRESENT_JSON/);
  assert.match(route, /FIBEROS_ASTERISK_MEDIA_BRIDGE_REACHABLE/);
  assert.doesNotMatch(route, /credentialsPresent: body\?\.credentialsPresent === true/);
  assert.doesNotMatch(route, /mediaBridgeReachable: body\?\.mediaBridgeReachable === true/);
  assert.doesNotMatch(route, /declaredNativeLocalesByProvider: body\?\.declaredNativeLocalesByProvider/);
  assert.doesNotMatch(route, /credentialsByProvider: body\?\.credentialsByProvider/);
});

test('language override preserves requested locale and persists handoff state', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/contactCenterMultilingual.js'), 'utf8');
  assert.match(route, /locale: negotiation\.locale, handoffRequired: negotiation\.handoffRequired/);
  assert.match(route, /overrideStatus = negotiation\.handoffRequired/);
  assert.match(route, /status=\$6,updated_at=now\(\),metadata=metadata \|\| \$7::jsonb where tenant_id=\$8 and id=\$9/);
});

test('migration 154 uses valid dollar-quoted PL/pgSQL and immutable message history', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'sql/migrations/154_multilingual_contact_center_conversations.sql'), 'utf8');
  assert.match(migration, /LANGUAGE plpgsql\nAS \$\$[\s\S]*CONTACT_CENTER_CONVERSATION_DELETE_FORBIDDEN/);
  assert.match(migration, /LANGUAGE plpgsql\nAS \$\$[\s\S]*CONTACT_CENTER_MESSAGE_IMMUTABLE/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
});

test('handoff emission references only variables defined in each execution branch', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/contactCenterMultilingual.js'), 'utf8');
  const overrideBlock = route.split("const languagePath =")[1].split("const msg =")[0];
  assert.match(route, /let handoffEvent = null;/);
  assert.match(route, /causationId: emitted\.outbox\.event_id/);
  assert.match(overrideBlock, /current\.rows\[0\]\.correlation_id/);
  assert.match(overrideBlock, /current\.rows\[0\]\.call_session_id/);
  assert.match(overrideBlock, /overrideStatus === 'HANDOFF_REQUIRED'/);
  assert.doesNotMatch(overrideBlock, /\bconversationStatus\b/);
  assert.doesNotMatch(overrideBlock, /\binserted\b/);
  assert.doesNotMatch(overrideBlock, /\bcallSessionId\b/);
});

test('handoff-required conversation emits a canonical operational handoff event', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/contactCenterMultilingual.js'), 'utf8');
  assert.match(route, /conversationStatus === 'HANDOFF_REQUIRED'/);
  assert.match(route, /operation: 'contact-center\.handoff\.required'/);
  assert.match(route, /eventType: 'contact_center\.handoff\.required'/);
  assert.match(route, /idempotencyKey: 'cc-handoff:' \+ requestKey/);
  assert.match(route, /HUMAN_HANDOFF_REQUIRED_PERSISTED/);
});

test('chat handoff preserves the negotiated unregistered locale instead of silently substituting a default locale', () => {
  const route = require('../src/routes/contactCenterMultilingual');
  const pkg = require('../../../packages/multilingual-contact-center/src');
  const negotiation = pkg.negotiateLanguage({ requestedLocale: 'ar-MA' });
  const profile = pkg.resolveLanguageProfile({ languageCode: negotiation.languageCode });
  const policy = pkg.buildChatSessionPolicy({ profile, locale: negotiation.locale, handoffRequired: negotiation.handoffRequired });
  assert.equal(policy.locale, 'ar-MA');
  assert.equal(policy.dialectMode, 'HUMAN_HANDOFF_REQUIRED');
  assert.equal(policy.handoffRequired, true);
  assert.equal(route.validateMessageLocales({ sourceLanguage: profile, sourceLocale: 'ar-EG', targetLanguage: profile, targetLocale: 'ar-EG' }).targetLocale, 'ar-EG');
});

test('message locale guard rejects identity mismatches and missing source language authority', () => {
  const { validateMessageLocales } = require('../src/routes/contactCenterMultilingual');
  const pkg = require('../../../packages/multilingual-contact-center/src');
  const ar = pkg.resolveLanguageProfile({ languageCode: 'ar' });
  const en = pkg.resolveLanguageProfile({ languageCode: 'en' });
  assert.throws(() => validateMessageLocales({ sourceLanguage: ar, sourceLocale: 'en-US', targetLanguage: ar, targetLocale: 'ar-EG' }), /CC_SOURCE_LOCALE_MISMATCH/);
  assert.throws(() => validateMessageLocales({ sourceLanguage: null, sourceLocale: 'ar-EG', targetLanguage: ar, targetLocale: 'ar-EG' }), /CC_SOURCE_LOCALE_LANGUAGE_REQUIRED/);
  assert.throws(() => validateMessageLocales({ sourceLanguage: en, sourceLocale: 'en-US', targetLanguage: ar, targetLocale: 'ar-MA' }), /CC_TARGET_LOCALE_MISMATCH/);
});

test('client cannot self-promote contact-center message evidence or references', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/contactCenterMultilingual.js'), 'utf8');
  const evidence = clientDeclaredMessageEvidence({
    evidenceClass: 'measured',
    sourceLocale: 'ar-MA',
    targetLocale: 'ar-MA',
    audioReference: 'client-audio-id',
    providerReference: 'client-provider-id'
  });

  assert.equal(evidence.evidenceClass, 'declared');
  assert.equal(evidence.metadata.sourceLocaleTrust, 'CLIENT_DECLARED_UNVERIFIED');
  assert.equal(evidence.metadata.targetLocaleTrust, 'CLIENT_DECLARED_UNVERIFIED');
  assert.equal(evidence.metadata.audioReferenceTrust, 'CLIENT_DECLARED_UNVERIFIED');
  assert.equal(evidence.metadata.providerReferenceTrust, 'CLIENT_DECLARED_UNVERIFIED');
  assert.equal(evidence.metadata.runtime, 'UNVERIFIED');
  assert.doesNotMatch(route, /body\?\.evidenceClass/);
});

test('migration 157 blocks direct database evidence-class self-promotion', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'sql/migrations/157_contact_center_evidence_trust_guard.sql'), 'utf8');
  assert.match(migration, /BEFORE INSERT ON public\.contact_center_conversation_messages/);
  assert.match(migration, /NEW\.evidence_class IS DISTINCT FROM 'declared'/);
  assert.match(migration, /CC_MESSAGE_EVIDENCE_CLASS_SERVER_MANAGED/);
  assert.match(migration, /SECURITY INVOKER/);
});
