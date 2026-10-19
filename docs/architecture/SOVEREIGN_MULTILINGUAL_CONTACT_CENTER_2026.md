# FiberOS Sovereign Multilingual Contact Center — 2026

## Purpose

FiberOS now has a tenant-scoped multilingual contact-center control layer for 84 target language profiles across:

- Voice conversations
- Customer/agent chat
- Bidirectional translation
- Streaming ASR/TTS policy
- Full-duplex turn taking
- Barge-in/interruption
- Automatic language identification
- Code-switching capability negotiation
- Exact-locale-first dialect handling

The 84 profiles are a source-level language-routing contract, not a claim that every deployment already has a production-quality native-dialect speech model connected.

## Voice architecture

The media contract is:

SIP over TLS for telephony signaling

SRTP for protected audio

WSS/WebRTC for browser voice

Streaming ASR -> conversation/AI policy -> streaming TTS

Full duplex + barge-in

The existing FiberOS contact-center runtime remains the telephony boundary. The current repository deliberately refuses to call a call connected merely because a database session exists.

## Dialect policy

Every profile has:

- a BCP-47 locale
- a reference country
- an exact-locale preference
- a human-handoff fallback
- silent dialect fallback disabled

A locale such as ar-EG is therefore a routing/voice requirement. It is not by itself evidence that a specific provider voice is natively Egyptian or that human-level fluency has been measured.

For production admission, every purchased target locale must pass a buyer-controlled golden-set validation covering:

1. recognition accuracy
2. names and network identifiers
3. numbers/addresses
4. local vocabulary and pronunciation
5. interruption recovery
6. latency and first-audio time
7. cross-turn context
8. code-switching
9. background noise
10. human handoff correctness

## Chat architecture

Chat uses the same language profile and entity-preservation policy as voice.

Stored messages are immutable, tenant-scoped, hash-bound, and linked to a canonical operational event.

A message marked TRANSLATION records translation state; it does not assert that a translation model actually executed unless a runtime adapter records that execution.

## Runtime adapters

FiberOS is sovereign-first and adapter-neutral.

### Local / sovereign path

A local deployment may use NVIDIA Riva or another buyer-controlled speech stack for streaming recognition and language identification. NVIDIA documents multilingual Riva ASR models with automatic language identification for defined language sets. This repository does not claim that Riva alone supplies native-dialect TTS for all 84 profiles; the buyer's actual model inventory remains the admission authority.

### Optional external path

A deployment may use an external real-time voice model where contract and data policy permit it. As of October 2026, OpenAI documents gpt-realtime-2.1 as a realtime speech-to-speech model with tool use, interruptions, and browser/server realtime transports. OpenAI separately documents a realtime translation model for live speech interpretation.

Azure Speech documents more than 400 prebuilt neural voices across more than 140 languages/locales, while language support varies by speech feature. This makes Azure useful as a locale-coverage adapter, but it still requires per-locale production validation.

## Truth boundary

The repository can truthfully establish:

- 84 language/locale routing profiles exist in source.
- Voice and chat policy contracts are implemented.
- Tenant-scoped conversation persistence is implemented.
- Canonical operational events are emitted for conversation/message mutations.
- Exact-locale-first dialect policy is enforced.
- The existing media security model uses SIP-TLS, SRTP and WebRTC policy.

The repository does not claim:

- 84 native-dialect voices are already connected.
- 84 languages have identical speech quality.
- telephony is production-connected in the buyer environment.
- ASR/TTS/model adapters are runtime-verified at the current HEAD.
- a specific external provider can meet every locale requirement without a capability probe.

## Current API surface

- GET /v1/contact-center/languages
- POST /v1/contact-center/conversations
- GET /v1/contact-center/conversations/{id}
- POST /v1/contact-center/conversations/{id}/language
- POST /v1/contact-center/conversations/{id}/messages

Voice conversations must reference an existing FiberOS call_session.

Customer users can create and read only their own chat conversations and can submit only customer-to-system messages. Language override remains an operator capability.

## Release gate

The multilingual feature should move through:

Source Implemented
-> Static/Unit Verified
-> Speech Adapter Capability Probed per Locale
-> Telephony Runtime Verified
-> Golden-Set Language QA
-> Buyer Production Admission

No marketing material should collapse these states into a single 84-language fluent claim before the corresponding runtime evidence exists.
