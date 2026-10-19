# FiberOS R14.1 — Surgical Translation Validation

The repository's existing `tools/validate-translation.js` remains the deterministic structural gate. `tools/surgical-translator-validator.js` is an additional forensic layer for localization work.

## Why the originally proposed script was unsafe to drop in unchanged

- The repository is CommonJS; the proposed `import` syntax would not run under the current root package configuration.
- `i18n/weblate/source.json` is not the canonical source path. FiberOS uses `i18n/source.json` (with `i18n/catalogs/source.json` as a compatible source catalog representation).
- The source structure is `keys`, not a flat object of translations.
- Runtime catalogs use `translations`, so the proposed `Object.entries(sourceData)` loop would read metadata fields incorrectly.
- `openai` is not a declared dependency in this ZIP; adding it implicitly would make the validator non-reproducible.
- Calling an AI model once per key would create thousands of network calls across 114 locales and is neither economical nor operationally robust.
- AI cannot be the structural gate. Placeholder/escape/technical-token mismatches must remain deterministic and fail closed.
- AI transport errors must not be returned as if they were a valid translation verdict.
- The 30 intentionally empty locales should be reported as intentionally untranslated and must not be sent to AI for review.

## Implemented design

`tools/surgical-translator-validator.js` performs local checks first: key coverage, empty values, placeholders, format escapes, technical token counts, arrow/punctuation structure, emoji count, and source-copy detection consistent with the catalog metadata.

Optional AI review is enabled only with `--ai` plus explicit `OPENAI_API_KEY` and `OPENAI_MODEL` environment variables. Reviews are batched, structural failures are excluded, and AI failures are reported as errors rather than `VALID`.

The script writes `i18n/SURGICAL_VALIDATION_REPORT.json`. It does not promote any locale to `verified`.

## Usage

`node tools/surgical-translator-validator.js --locale=ber --json`

`node tools/surgical-translator-validator.js --json`

`OPENAI_API_KEY=... OPENAI_MODEL=... node tools/surgical-translator-validator.js --ai --locale=ber --json`
