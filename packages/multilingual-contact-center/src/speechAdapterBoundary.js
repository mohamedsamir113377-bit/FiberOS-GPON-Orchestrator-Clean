'use strict';

/**
 * Speech Adapter Boundary — multi-provider, sovereign-first.
 *
 * Declares capabilities and probes; does NOT open SIP trunks, WebRTC peers,
 * or claim production ASR/TTS fidelity. Runtime connectivity remains external.
 */

const PROVIDERS = Object.freeze([
  'LOCAL_SOVEREIGN',
  'OPENAI_REALTIME',
  'AZURE_SPEECH',
  'NVIDIA_RIVA',
  'ASTERISK_MEDIA_BRIDGE'
]);

const MEDIA_STACK = Object.freeze({
  signaling: Object.freeze(['SIP_TLS', 'WSS_WEBRTC']),
  media: Object.freeze(['SRTP']),
  duplex: 'FULL_DUPLEX',
  bargeIn: true,
  streamingAsr: true,
  streamingTts: true
});

/**
 * Static capability matrix — what each adapter is *designed* to support.
 * Presence here is not runtime proof.
 */
const PROVIDER_CAPABILITIES = Object.freeze({
  LOCAL_SOVEREIGN: Object.freeze({
    streamingAsr: true,
    streamingTts: true,
    languageId: true,
    codeSwitching: false,
    bargeIn: true,
    webrtc: true,
    sip: true,
    requiresExternalKey: false,
    truthBoundary: 'LOCAL_STACK_MUST_BE_PROVISIONED; NO_IMPLIED_VOICE_QUALITY'
  }),
  OPENAI_REALTIME: Object.freeze({
    streamingAsr: true,
    streamingTts: true,
    languageId: true,
    codeSwitching: true,
    bargeIn: true,
    webrtc: true,
    sip: false,
    requiresExternalKey: true,
    truthBoundary: 'EXTERNAL_PROVIDER; DIALECT_FIDELITY_UNPROVEN_UNTIL_GOLDEN_TESTS'
  }),
  AZURE_SPEECH: Object.freeze({
    streamingAsr: true,
    streamingTts: true,
    languageId: true,
    codeSwitching: false,
    bargeIn: true,
    webrtc: true,
    sip: false,
    requiresExternalKey: true,
    truthBoundary: 'LOCALE_COVERAGE_VARIES_BY_FEATURE; VERIFY_PER_LOCALE'
  }),
  NVIDIA_RIVA: Object.freeze({
    streamingAsr: true,
    streamingTts: true,
    languageId: true,
    codeSwitching: false,
    bargeIn: true,
    webrtc: false,
    sip: true,
    requiresExternalKey: false,
    truthBoundary: 'SELF_HOSTED_MODELS_REQUIRED; LOCALE_PACKS_NOT_ASSUMED'
  }),
  ASTERISK_MEDIA_BRIDGE: Object.freeze({
    streamingAsr: false,
    streamingTts: false,
    languageId: false,
    codeSwitching: false,
    bargeIn: true,
    webrtc: true,
    sip: true,
    requiresExternalKey: false,
    truthBoundary: 'MEDIA_BRIDGE_ONLY; ASR_TTS_DELEGATED_TO_SPEECH_ADAPTER'
  })
});

function normalizeProvider(value) {
  const p = String(value || '').trim().toUpperCase();
  if (!PROVIDERS.includes(p)) {
    const e = new Error('CC_SPEECH_PROVIDER_UNKNOWN');
    e.code = 'CC_SPEECH_PROVIDER_UNKNOWN';
    e.statusCode = 400;
    throw e;
  }
  return p;
}

/**
 * Probe result for a provider + locale.
 * declaredNativeLocales: locales the operator has certified (never auto-invented).
 */
function probeSpeechAdapter({
  provider,
  locale,
  declaredNativeLocales = [],
  credentialsPresent = false,
  mediaBridgeReachable = false
} = {}) {
  const p = normalizeProvider(provider);
  const caps = PROVIDER_CAPABILITIES[p];
  const loc = String(locale || '').trim();
  if (!loc) {
    const e = new Error('CC_SPEECH_LOCALE_REQUIRED');
    e.code = 'CC_SPEECH_LOCALE_REQUIRED';
    e.statusCode = 400;
    throw e;
  }

  const declared = new Set(
    (Array.isArray(declaredNativeLocales) ? declaredNativeLocales : []).map((x) =>
      String(x).trim().toLowerCase()
    )
  );
  const nativeDeclared = declared.has(loc.toLowerCase());

  if (caps.requiresExternalKey && !credentialsPresent) {
    return Object.freeze({
      provider: p,
      locale: loc,
      status: 'NOT_CONFIGURED',
      nativeVoiceAvailable: false,
      handoffRequired: true,
      reason: 'PROVIDER_CREDENTIALS_MISSING',
      capabilities: caps,
      mediaStack: MEDIA_STACK,
      runtimeConnected: false,
      truthBoundary: caps.truthBoundary
    });
  }

  if (p === 'ASTERISK_MEDIA_BRIDGE' && !mediaBridgeReachable) {
    return Object.freeze({
      provider: p,
      locale: loc,
      status: 'BRIDGE_UNREACHABLE',
      nativeVoiceAvailable: false,
      handoffRequired: true,
      reason: 'ASTERISK_BRIDGE_NOT_REACHABLE',
      capabilities: caps,
      mediaStack: MEDIA_STACK,
      runtimeConnected: false,
      truthBoundary: caps.truthBoundary
    });
  }

  if (!nativeDeclared) {
    return Object.freeze({
      provider: p,
      locale: loc,
      status: 'LOCALE_NOT_CERTIFIED',
      nativeVoiceAvailable: false,
      handoffRequired: true,
      reason: 'NATIVE_LOCALE_VOICE_NOT_DECLARED',
      capabilities: caps,
      mediaStack: MEDIA_STACK,
      runtimeConnected: false,
      truthBoundary:
        'Exact locale requested; silent dialect substitution is forbidden. Human handoff required until native voice is certified for this locale.'
    });
  }

  return Object.freeze({
    provider: p,
    locale: loc,
    status: 'CAPABILITY_DECLARED',
    nativeVoiceAvailable: true,
    handoffRequired: false,
    reason: null,
    capabilities: caps,
    mediaStack: MEDIA_STACK,
    runtimeConnected: false,
    truthBoundary:
      'Capability declared for locale; production media path still requires live adapter admission tests.'
  });
}

/**
 * Select best configured adapter for a locale without inventing connectivity.
 * Prefer LOCAL_SOVEREIGN when certified; else first certified external; else handoff.
 */
function selectSpeechAdapter({
  locale,
  preferredProviders = ['LOCAL_SOVEREIGN', 'NVIDIA_RIVA', 'AZURE_SPEECH', 'OPENAI_REALTIME'],
  declaredNativeLocalesByProvider = {},
  credentialsByProvider = {},
  mediaBridgeReachable = false
} = {}) {
  const probes = [];
  for (const provider of preferredProviders) {
    try {
      const probe = probeSpeechAdapter({
        provider,
        locale,
        declaredNativeLocales: declaredNativeLocalesByProvider[provider] || [],
        credentialsPresent: credentialsByProvider[provider] === true,
        mediaBridgeReachable
      });
      probes.push(probe);
      if (probe.nativeVoiceAvailable && probe.status === 'CAPABILITY_DECLARED') {
        return Object.freeze({
          selected: probe,
          probes: Object.freeze(probes),
          handoffRequired: false
        });
      }
    } catch (_) {
      /* skip unknown provider entries */
    }
  }

  return Object.freeze({
    selected: null,
    probes: Object.freeze(probes),
    handoffRequired: true,
    reason: 'NO_CERTIFIED_NATIVE_VOICE_FOR_LOCALE'
  });
}

/**
 * Language identification result gate — low confidence forces handoff.
 */
function evaluateLanguageDetection({
  detectedLanguage,
  detectedLocale,
  confidence,
  minConfidence = 0.72
} = {}) {
  const conf = confidence == null ? null : Number(confidence);
  if (conf != null && (!Number.isFinite(conf) || conf < 0 || conf > 1)) {
    const e = new Error('CC_LANGUAGE_CONFIDENCE_INVALID');
    e.code = 'CC_LANGUAGE_CONFIDENCE_INVALID';
    e.statusCode = 400;
    throw e;
  }
  if (conf != null && conf < minConfidence) {
    return Object.freeze({
      accepted: false,
      handoffRequired: true,
      reason: 'LANGUAGE_ID_CONFIDENCE_BELOW_THRESHOLD',
      confidence: conf,
      minConfidence,
      detectedLanguage: detectedLanguage || null,
      detectedLocale: detectedLocale || null
    });
  }
  if (!detectedLanguage && !detectedLocale) {
    return Object.freeze({
      accepted: false,
      handoffRequired: true,
      reason: 'LANGUAGE_ID_EMPTY',
      confidence: conf,
      minConfidence
    });
  }
  return Object.freeze({
    accepted: true,
    handoffRequired: false,
    reason: null,
    confidence: conf,
    minConfidence,
    detectedLanguage: detectedLanguage || null,
    detectedLocale: detectedLocale || null
  });
}

module.exports = {
  PROVIDERS,
  MEDIA_STACK,
  PROVIDER_CAPABILITIES,
  normalizeProvider,
  probeSpeechAdapter,
  selectSpeechAdapter,
  evaluateLanguageDetection
};
