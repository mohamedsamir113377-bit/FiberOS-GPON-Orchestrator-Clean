'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TARGET_LANGUAGE_COUNT,
  LANGUAGE_PROFILES,
  resolveLanguageProfile,
  negotiateLanguage,
  buildVoiceSessionPolicy,
  buildChatSessionPolicy,
  probeSpeechAdapter,
  selectSpeechAdapter,
  evaluateLanguageDetection,
  isRegisteredLocale
} = require('../src');

test('exactly 84 target language profiles are defined', () => {
  assert.equal(TARGET_LANGUAGE_COUNT, 84);
  assert.equal(LANGUAGE_PROFILES.length, 84);
});

test('registered locale resolves exact without handoff', () => {
  const p = resolveLanguageProfile({ locale: 'ar-EG' });
  assert.equal(p.code, 'ar');
  const n = negotiateLanguage({ requestedLocale: 'ar-EG' });
  assert.equal(n.locale, 'ar-EG');
  assert.equal(n.dialectMode, 'EXACT_LOCALE');
  assert.equal(n.handoffRequired, false);
  assert.equal(n.profile.dialect.silentFallbackForbidden, true);
});

test('unregistered dialect forces human handoff — no silent ar-EG substitution for ar-MA', () => {
  assert.equal(isRegisteredLocale('ar-MA'), false);
  const n = negotiateLanguage({ requestedLocale: 'ar-MA' });
  assert.equal(n.languageCode, 'ar');
  assert.equal(n.locale, 'ar-MA');
  assert.equal(n.dialectMode, 'HUMAN_HANDOFF_REQUIRED');
  assert.equal(n.handoffRequired, true);
  assert.equal(n.reason, 'LOCALE_NOT_IN_CATALOG_HUMAN_HANDOFF');
  // Must NOT claim Egypt locale as a silent substitute
  assert.notEqual(n.locale, 'ar-EG');
});

test('low confidence language detection forces handoff', () => {
  const n = negotiateLanguage({
    detectedLanguage: 'ar',
    detectedLocale: 'ar-EG',
    confidence: 0.4
  });
  assert.equal(n.handoffRequired, true);
  assert.equal(n.dialectMode, 'HUMAN_HANDOFF_REQUIRED');
});

test('voice policy requires streaming duplex media and preserves exact locale policy', () => {
  const p = resolveLanguageProfile({ languageCode: 'yue' });
  const policy = buildVoiceSessionPolicy({ profile: p, adapterMode: 'LOCAL_SOVEREIGN' });
  assert.equal(policy.channel, 'VOICE');
  assert.equal(policy.media.signaling, 'SIP_TLS');
  assert.equal(policy.media.browser, 'WSS_WEBRTC');
  assert.equal(policy.media.audio, 'SRTP');
  assert.equal(policy.realtime.duplex, 'FULL_DUPLEX');
  assert.equal(policy.exactDialectRequired, true);
});

test('voice policy marks handoff when speech probe denies native voice', () => {
  const p = resolveLanguageProfile({ languageCode: 'ar' });
  const probe = probeSpeechAdapter({
    provider: 'LOCAL_SOVEREIGN',
    locale: 'ar-EG',
    declaredNativeLocales: []
  });
  const policy = buildVoiceSessionPolicy({
    profile: p,
    locale: 'ar-EG',
    speechProbe: probe
  });
  assert.equal(policy.handoffRequired, true);
  assert.equal(policy.dialectMode, 'HUMAN_HANDOFF_REQUIRED');
});

test('chat policy is bidirectional and entity preserving', () => {
  const p = resolveLanguageProfile({ languageCode: 'sw' });
  const policy = buildChatSessionPolicy({ profile: p });
  assert.equal(policy.channel, 'CHAT');
  assert.equal(policy.translation, 'BIDIRECTIONAL');
  assert.equal(policy.preserveEntities, true);
});

test('unknown languages fail closed', () => {
  assert.throws(() => resolveLanguageProfile({ languageCode: 'xx' }), /CC_LANGUAGE_UNSUPPORTED/);
});

test('speech adapter probe never claims runtime connection', () => {
  const probe = probeSpeechAdapter({
    provider: 'AZURE_SPEECH',
    locale: 'ar-EG',
    declaredNativeLocales: ['ar-EG'],
    credentialsPresent: true
  });
  assert.equal(probe.runtimeConnected, false);
  assert.equal(probe.nativeVoiceAvailable, true);
  assert.equal(probe.status, 'CAPABILITY_DECLARED');
});

test('selectSpeechAdapter handoff when no locale certified', () => {
  const sel = selectSpeechAdapter({
    locale: 'ar-EG',
    declaredNativeLocalesByProvider: {},
    credentialsByProvider: { AZURE_SPEECH: true }
  });
  assert.equal(sel.handoffRequired, true);
  assert.equal(sel.selected, null);
});

test('evaluateLanguageDetection rejects low confidence', () => {
  const r = evaluateLanguageDetection({
    detectedLanguage: 'ar',
    confidence: 0.2
  });
  assert.equal(r.accepted, false);
  assert.equal(r.handoffRequired, true);
});
