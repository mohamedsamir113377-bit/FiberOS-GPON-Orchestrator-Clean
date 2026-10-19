# FiberOS R14.1 — Localization Pipeline

FiberOS uses a provider-neutral localization pipeline. Translation generation is intentionally decoupled from the runtime catalog format and from the release verification gates.

## Canonical source

- Source locale: `en`
- Runtime locales: 114
- Non-source target locales: 113
- Canonical keys: 101
- Runtime catalogs: `i18n/catalogs/<locale>.json`

## Translation policy

A translation provider may be used to generate drafts, but provider output is never treated as release verification. Every locale remains `untranslated`, `machine-draft`, `review-required`, `human-reviewed`, or `verified` according to the evidence actually available.

## Release verification

The release gate checks exact locale/key parity, placeholder preservation, Unicode normalization, bidi control balance, BCP-47 canonicalization, plural categories, Intl formatting support, terminology preservation, and public mirror parity. A locale may be marked `verified` only when its catalog passes the applicable checks and has 100% coverage.

## Zero-hallucination rule

Do not mark a locale as translated or verified merely because a catalog file exists. Do not copy the source text into a target locale and label it verified. Provider credentials, provider identifiers, and provider-specific configuration must not be fabricated or committed to the repository.
