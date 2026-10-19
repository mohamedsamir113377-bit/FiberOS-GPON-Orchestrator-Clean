# FiberOS R14.1 — Translation Execution Status

- Runtime locale set: **114 configured**.
- Canonical source keys: **101** (84 translatable + 17 fixed technical/status values kept identical to source by design).
- `ar` is `verified` (human-confirmed, 100% coverage).
- `es`, `fr`, `de`, `it`, `pt`, `ru`, `zh`, `ja`, `ko`, `hi`, `tr` are now populated at 100% key coverage, status `machine-draft`: real, structurally-checked translations (placeholder parity, preserved terminology, NFC Unicode) — not yet professionally reviewed, so not promoted to `verified`.
- The remaining 30 locales are intentionally fail-closed (`untranslated`) until real translations and the required verification evidence exist. A fail-closed local OPUS-MT execution runner is now included at `scripts/i18n/translate-66-opus.py`; it refuses unsupported locale mappings and refuses to modify catalogs when a concrete licensed model checkpoint is not provisioned.
- No external translation-engine credentials or provider-specific engine configuration is required by the repository.

## Batch plan for the remaining 66 locales

Populating all remaining locales with genuine, checked translations — rather than fabricated placeholders — is being done in further batches, prioritized roughly by speaker population / deployment likelihood:

1. Done: `ar` (verified), `es fr de it pt`, `ru zh ja ko hi tr`, `bg cs da el fi hu id nl no pl ro sk sv uk vi` (machine-draft), plus the current 20-locale DeepL batch `bn ur ms tl ta te mr gu fa ml ne my az uz sw ha hy sr sq hr`.
2. Next: the remaining 30 untranslated locales, prioritized by commercial deployment value and DeepL/linguistic support, with human review required before `verified` status.
3. Proceed in smaller reviewed batches; do not promote any new locale directly from `machine-draft` to `verified`.
4. Low-resource or minority languages should remain `review-required` until native-linguist validation, especially: `nus din tig sat dv ks ber ktu pau` and similar low-resource or minority languages — these should get a `review-required` status and a human linguist pass before ever being marked `verified`, per QUALITY_POLICY.json.

## Release rule

A locale is not release-verified because a file exists. It must have complete coverage, preserved placeholders, valid Unicode/bidi structure, valid locale metadata, compatible runtime formatting, preserved required terminology, and status `verified`.
