'use strict';

const TARGET_LANGUAGE_COUNT = 84;
const CHANNELS = Object.freeze(['CHAT', 'VOICE']);
const ADAPTER_MODES = Object.freeze(['LOCAL_SOVEREIGN', 'EXTERNAL_OPTIONAL']);
const DIALECT_MODES = Object.freeze(['EXACT_LOCALE', 'REGIONAL_STANDARD', 'HUMAN_HANDOFF_REQUIRED']);

const LANGUAGE_PROFILES = Object.freeze([
  ['ar','Arabic','ar-EG','Egypt'],['en','English','en-US','United States'],['fr','French','fr-FR','France'],
  ['es','Spanish','es-ES','Spain'],['pt','Portuguese','pt-PT','Portugal'],['de','German','de-DE','Germany'],
  ['it','Italian','it-IT','Italy'],['nl','Dutch','nl-NL','Netherlands'],['pl','Polish','pl-PL','Poland'],
  ['cs','Czech','cs-CZ','Czech Republic'],['sk','Slovak','sk-SK','Slovakia'],['sl','Slovenian','sl-SI','Slovenia'],
  ['hr','Croatian','hr-HR','Croatia'],['sr','Serbian','sr-RS','Serbia'],['bs','Bosnian','bs-BA','Bosnia and Herzegovina'],
  ['bg','Bulgarian','bg-BG','Bulgaria'],['ro','Romanian','ro-RO','Romania'],['hu','Hungarian','hu-HU','Hungary'],
  ['el','Greek','el-GR','Greece'],['sq','Albanian','sq-AL','Albania'],['mk','Macedonian','mk-MK','North Macedonia'],
  ['uk','Ukrainian','uk-UA','Ukraine'],['ru','Russian','ru-RU','Russia'],['be','Belarusian','be-BY','Belarus'],
  ['lt','Lithuanian','lt-LT','Lithuania'],['lv','Latvian','lv-LV','Latvia'],['et','Estonian','et-EE','Estonia'],
  ['fi','Finnish','fi-FI','Finland'],['sv','Swedish','sv-SE','Sweden'],['no','Norwegian','nb-NO','Norway'],
  ['da','Danish','da-DK','Denmark'],['is','Icelandic','is-IS','Iceland'],['ga','Irish','ga-IE','Ireland'],
  ['cy','Welsh','cy-GB','United Kingdom'],['mt','Maltese','mt-MT','Malta'],['eu','Basque','eu-ES','Spain'],
  ['ca','Catalan','ca-ES','Spain'],['gl','Galician','gl-ES','Spain'],['hy','Armenian','hy-AM','Armenia'],
  ['az','Azerbaijani','az-AZ','Azerbaijan'],['ka','Georgian','ka-GE','Georgia'],['tr','Turkish','tr-TR','Türkiye'],
  ['he','Hebrew','he-IL','Israel'],['fa','Persian','fa-IR','Iran'],['ku','Kurdish','ku-TR','Türkiye'],
  ['hi','Hindi','hi-IN','India'],['bn','Bengali','bn-BD','Bangladesh'],['ur','Urdu','ur-PK','Pakistan'],
  ['pa','Punjabi','pa-IN','India'],['mr','Marathi','mr-IN','India'],['gu','Gujarati','gu-IN','India'],
  ['ta','Tamil','ta-IN','India'],['te','Telugu','te-IN','India'],['kn','Kannada','kn-IN','India'],
  ['ml','Malayalam','ml-IN','India'],['ne','Nepali','ne-NP','Nepal'],['si','Sinhala','si-LK','Sri Lanka'],
  ['as','Assamese','as-IN','India'],['or','Odia','or-IN','India'],['th','Thai','th-TH','Thailand'],
  ['lo','Lao','lo-LA','Laos'],['km','Khmer','km-KH','Cambodia'],['vi','Vietnamese','vi-VN','Vietnam'],
  ['id','Indonesian','id-ID','Indonesia'],['ms','Malay','ms-MY','Malaysia'],['fil','Filipino','fil-PH','Philippines'],
  ['zh','Mandarin Chinese','zh-CN','China'],['yue','Cantonese','yue-HK','Hong Kong'],['ja','Japanese','ja-JP','Japan'],
  ['ko','Korean','ko-KR','South Korea'],['mn','Mongolian','mn-MN','Mongolia'],['kk','Kazakh','kk-KZ','Kazakhstan'],
  ['uz','Uzbek','uz-UZ','Uzbekistan'],['tk','Turkmen','tk-TM','Turkmenistan'],['sw','Swahili','sw-KE','Kenya'],
  ['am','Amharic','am-ET','Ethiopia'],['ha','Hausa','ha-NG','Nigeria'],['yo','Yoruba','yo-NG','Nigeria'],
  ['zu','Zulu','zu-ZA','South Africa'],['so','Somali','so-SO','Somalia'],['mg','Malagasy','mg-MG','Madagascar'],
  ['af','Afrikaans','af-ZA','South Africa'],['ps','Pashto','ps-AF','Afghanistan'],['sd','Sindhi','sd-PK','Pakistan']
].map(([code,name,locale,country]) => Object.freeze({
  code, name, defaultLocale: locale, referenceCountry: country,
  channels: CHANNELS,
  dialect: Object.freeze({
    mode: 'EXACT_LOCALE',
    locale: locale,
    fallback: 'HUMAN_HANDOFF_REQUIRED',
    silentFallbackForbidden: true
  }),
  speech: Object.freeze({
    asr: 'STREAMING_REQUIRED',
    tts: 'STREAMING_REQUIRED',
    turnTaking: 'FULL_DUPLEX_PREFERRED',
    interruption: 'BARGE_IN_REQUIRED',
    languageIdentification: 'AUTOMATIC_PREFERRED',
    codeSwitching: 'ADAPTER_CAPABILITY_PROBE_REQUIRED',
    domainTerminology: 'FIBEROS_GLOSSARY_REQUIRED'
  }),
  translation: Object.freeze({
    mode: 'SPEECH_TO_SPEECH_OR_TEXT',
    preserveNumbers: true,
    preserveNames: true,
    preserveNetworkIdentifiers: true
  })
})));

if (LANGUAGE_PROFILES.length !== TARGET_LANGUAGE_COUNT) {
  throw new Error('CC_LANGUAGE_PROFILE_COUNT_INVALID');
}

const BY_CODE = new Map(LANGUAGE_PROFILES.map(p => [p.code, p]));
const BY_LOCALE = new Map(LANGUAGE_PROFILES.map(p => [p.defaultLocale.toLowerCase(), p]));

function normalizeLanguage(value) {
  const code = String(value || '').trim().toLowerCase();
  if (!BY_CODE.has(code)) throw Object.assign(new Error('CC_LANGUAGE_UNSUPPORTED'), { code: 'CC_LANGUAGE_UNSUPPORTED', statusCode: 400 });
  return code;
}

function isRegisteredLocale(locale) {
  const key = String(locale || '').trim().toLowerCase();
  return key.length > 0 && BY_LOCALE.has(key);
}

/**
 * Resolve a language profile.
 * exactLocaleOnly=true: locale must be a registered defaultLocale (no base-language fallback).
 * exactLocaleOnly=false: may resolve by language code; locale mismatch still surfaces via negotiateLanguage.
 */
function resolveLanguageProfile({ languageCode, locale, exactLocaleOnly = false } = {}) {
  if (locale != null && String(locale).trim() !== '') {
    const key = String(locale).trim().toLowerCase();
    if (BY_LOCALE.has(key)) return BY_LOCALE.get(key);
    if (exactLocaleOnly) {
      throw Object.assign(new Error('CC_LOCALE_NOT_REGISTERED'), {
        code: 'CC_LOCALE_NOT_REGISTERED',
        statusCode: 400,
        locale: String(locale).trim()
      });
    }
  }
  if (languageCode != null && String(languageCode).trim() !== '') {
    return BY_CODE.get(normalizeLanguage(languageCode));
  }
  if (locale != null && String(locale).trim() !== '') {
    const base = String(locale).trim().toLowerCase().split('-')[0];
    if (BY_CODE.has(base)) return BY_CODE.get(base);
  }
  throw Object.assign(new Error('CC_LANGUAGE_LOCALE_UNSUPPORTED'), {
    code: 'CC_LANGUAGE_LOCALE_UNSUPPORTED',
    statusCode: 400
  });
}

/**
 * Negotiate language/locale with NO silent dialect substitution.
 * - Registered exact locale → EXACT_LOCALE, handoffRequired false (policy selected; voice still needs adapter cert).
 * - Requested locale not in registry but language known → HUMAN_HANDOFF_REQUIRED, keep requested locale as intent.
 * - Detection with low confidence handled by speechAdapterBoundary.evaluateLanguageDetection at call sites.
 */
function negotiateLanguage({
  requestedLanguage,
  requestedLocale,
  detectedLanguage,
  detectedLocale,
  confidence = null,
  minDetectionConfidence = 0.72
} = {}) {
  const numericConfidence = confidence == null ? null : Number(confidence);
  if (numericConfidence != null && (!Number.isFinite(numericConfidence) || numericConfidence < 0 || numericConfidence > 1)) {
    throw Object.assign(new Error('CC_LANGUAGE_CONFIDENCE_INVALID'), {
      code: 'CC_LANGUAGE_CONFIDENCE_INVALID',
      statusCode: 400
    });
  }

  const source = requestedLanguage || requestedLocale ? 'REQUESTED' : 'DETECTED';
  const intentLocale = requestedLocale || detectedLocale || null;
  const intentLanguage = requestedLanguage || detectedLanguage || null;

  if (source === 'DETECTED' && numericConfidence != null && numericConfidence < minDetectionConfidence) {
    return Object.freeze({
      languageCode: intentLanguage ? String(intentLanguage).toLowerCase().split('-')[0] : null,
      locale: intentLocale,
      confidence: numericConfidence,
      source,
      dialectMode: 'HUMAN_HANDOFF_REQUIRED',
      handoffRequired: true,
      reason: 'LANGUAGE_ID_CONFIDENCE_BELOW_THRESHOLD',
      profile: null
    });
  }

  if (intentLocale && isRegisteredLocale(intentLocale)) {
    const profile = BY_LOCALE.get(String(intentLocale).trim().toLowerCase());
    return Object.freeze({
      languageCode: profile.code,
      locale: profile.defaultLocale,
      confidence: numericConfidence,
      source,
      dialectMode: 'EXACT_LOCALE',
      handoffRequired: false,
      reason: null,
      profile
    });
  }

  // Locale requested but not registered: never map to another country's dialect.
  if (intentLocale && !isRegisteredLocale(intentLocale)) {
    const base = String(intentLocale).trim().toLowerCase().split('-')[0];
    const profile = BY_CODE.has(base) ? BY_CODE.get(base) : null;
    if (!profile && intentLanguage) {
      try {
        const p = BY_CODE.get(normalizeLanguage(intentLanguage));
        return Object.freeze({
          languageCode: p.code,
          locale: String(intentLocale).trim(),
          confidence: numericConfidence,
          source,
          dialectMode: 'HUMAN_HANDOFF_REQUIRED',
          handoffRequired: true,
          reason: 'LOCALE_NOT_IN_CATALOG_HUMAN_HANDOFF',
          profile: p
        });
      } catch (_) {
        throw Object.assign(new Error('CC_LANGUAGE_LOCALE_UNSUPPORTED'), {
          code: 'CC_LANGUAGE_LOCALE_UNSUPPORTED',
          statusCode: 400
        });
      }
    }
    if (!profile) {
      throw Object.assign(new Error('CC_LANGUAGE_LOCALE_UNSUPPORTED'), {
        code: 'CC_LANGUAGE_LOCALE_UNSUPPORTED',
        statusCode: 400
      });
    }
    return Object.freeze({
      languageCode: profile.code,
      locale: String(intentLocale).trim(),
      confidence: numericConfidence,
      source,
      dialectMode: 'HUMAN_HANDOFF_REQUIRED',
      handoffRequired: true,
      reason: 'LOCALE_NOT_IN_CATALOG_HUMAN_HANDOFF',
      profile
    });
  }

  // Language only (no locale): use default locale of language profile
  const profile = resolveLanguageProfile({
    languageCode: intentLanguage,
    locale: null,
    exactLocaleOnly: false
  });
  return Object.freeze({
    languageCode: profile.code,
    locale: profile.defaultLocale,
    confidence: numericConfidence,
    source,
    dialectMode: 'EXACT_LOCALE',
    handoffRequired: false,
    reason: null,
    profile
  });
}

function buildVoiceSessionPolicy({
  profile,
  adapterMode = 'LOCAL_SOVEREIGN',
  exactDialectRequired = true,
  locale = null,
  handoffRequired = false,
  speechProbe = null
} = {}) {
  if (!profile || !profile.code) throw new Error('CC_LANGUAGE_PROFILE_REQUIRED');
  if (!ADAPTER_MODES.includes(String(adapterMode))) throw new Error('CC_VOICE_ADAPTER_MODE_INVALID');
  const effectiveLocale = locale || profile.defaultLocale;
  const needsHandoff = handoffRequired === true || (speechProbe && speechProbe.handoffRequired === true);
  return Object.freeze({
    channel: 'VOICE',
    languageCode: profile.code,
    locale: effectiveLocale,
    dialectMode: needsHandoff ? 'HUMAN_HANDOFF_REQUIRED' : (exactDialectRequired ? 'EXACT_LOCALE' : 'REGIONAL_STANDARD'),
    exactDialectRequired: exactDialectRequired !== false,
    handoffRequired: needsHandoff,
    adapterMode: String(adapterMode),
    media: Object.freeze({
      signaling: 'SIP_TLS',
      browser: 'WSS_WEBRTC',
      audio: 'SRTP'
    }),
    realtime: Object.freeze({
      duplex: 'FULL_DUPLEX',
      bargeIn: true,
      streamingAsr: true,
      streamingTts: true,
      turnTaking: 'LOW_LATENCY'
    }),
    security: Object.freeze({
      tenantScoped: true,
      transcriptRetention: 'POLICY_CONTROLLED',
      audioRetention: 'POLICY_CONTROLLED',
      secretsOutOfDatabase: true
    }),
    truthBoundary: 'LANGUAGE_AND_VOICE_POLICY_SELECTED; MEDIA_CONNECTION_AND_SPEECH_ADAPTER_EXECUTION_REMAIN_RUNTIME_DEPENDENCIES'
  });
}

function buildChatSessionPolicy({
  profile,
  adapterMode = 'LOCAL_SOVEREIGN',
  locale = null,
  handoffRequired = false
} = {}) {
  if (!profile || !profile.code) throw new Error('CC_LANGUAGE_PROFILE_REQUIRED');
  if (!ADAPTER_MODES.includes(String(adapterMode))) throw new Error('CC_CHAT_ADAPTER_MODE_INVALID');
  const effectiveLocale = String(locale || profile.defaultLocale).trim();
  if (!effectiveLocale) throw new Error('CC_CHAT_LOCALE_REQUIRED');
  return Object.freeze({
    channel: 'CHAT',
    languageCode: profile.code,
    locale: effectiveLocale,
    dialectMode: handoffRequired === true ? 'HUMAN_HANDOFF_REQUIRED' : 'EXACT_LOCALE',
    handoffRequired: handoffRequired === true,
    adapterMode: String(adapterMode),
    translation: 'BIDIRECTIONAL',
    preserveEntities: true,
    truthBoundary: handoffRequired === true
      ? 'REQUESTED_LOCALE_NOT_CERTIFIED; HUMAN_HANDOFF_REQUIRED; MODEL/TRANSLATION_RUNTIME REMAINS AN EXTERNAL OR LOCAL ADAPTER DEPENDENCY'
      : 'LANGUAGE_AND_LOCALE_POLICY_SELECTED; MODEL/TRANSLATION_RUNTIME REMAINS AN EXTERNAL OR LOCAL ADAPTER DEPENDENCY'
  });
}

function listLanguageProfiles() {
  return LANGUAGE_PROFILES.map(profile => ({
    code: profile.code,
    name: profile.name,
    defaultLocale: profile.defaultLocale,
    referenceCountry: profile.referenceCountry,
    channels: profile.channels,
    dialectMode: profile.dialect.mode,
    fallback: profile.dialect.fallback
  }));
}

const speechAdapterBoundary = require('./speechAdapterBoundary');

module.exports = Object.freeze({
  TARGET_LANGUAGE_COUNT,
  CHANNELS,
  ADAPTER_MODES,
  DIALECT_MODES,
  LANGUAGE_PROFILES,
  normalizeLanguage,
  resolveLanguageProfile,
  isRegisteredLocale,
  negotiateLanguage,
  buildVoiceSessionPolicy,
  buildChatSessionPolicy,
  listLanguageProfiles,
  speechAdapterBoundary,
  PROVIDERS: speechAdapterBoundary.PROVIDERS,
  probeSpeechAdapter: speechAdapterBoundary.probeSpeechAdapter,
  selectSpeechAdapter: speechAdapterBoundary.selectSpeechAdapter,
  evaluateLanguageDetection: speechAdapterBoundary.evaluateLanguageDetection
});
