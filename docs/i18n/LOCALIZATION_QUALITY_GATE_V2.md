# FiberOS R14.1 — Localization Quality Gate V2

This gate is provider-neutral and verifies the FiberOS runtime localization contract directly.

## Release invariants

1. Exact locale-set parity across `i18n/manifest.json`, `i18n/locale-metadata.json`, and runtime catalogs.
2. Exact canonical source-key parity.
3. Preservation of all non-translatable keys through the repository-owned source metadata.
4. Placeholder, Unicode, bidi, terminology, BCP-47, plural, and Intl formatting validation.
5. Exact parity between canonical catalogs and public application mirrors.

A translation provider may generate drafts, but provider output is never equivalent to release verification.
