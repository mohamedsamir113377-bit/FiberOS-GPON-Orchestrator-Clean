# FiberOS Weblate setup — real integration only

This document is configuration guidance, not an active integration.
No API token, project ID, repository credential, or webhook secret belongs in the repository.

## Component

- Repository: the real FiberOS Git repository URL.
- File mask: `i18n/weblate/locales/*.json`
- Monolingual base language file: `i18n/weblate/source.json`
- Template for new translations: empty.
- File format: JSON simple key/value (monolingual).

The current Weblate component mirrors a **100-key subset** of the canonical runtime i18n source, which currently contains **101 keys**. The Weblate tree must not be treated as complete runtime-i18n parity.

## Translation workflow

1. Import the real repository into a real Weblate project.
2. Create one component for the FiberOS UI catalog.
3. Add the 114 target locales only after verifying their locale identifiers.
4. Enable checks for missing translations, whitespace, variables/placeholders, and source-language copies.
5. Import the FiberOS technical glossary.
6. Require human review before a translation can become `verified`.
7. Sync approved changes back to Git.
8. Run `npm run verify` before release and inspect `I18N_STATUS.md` for the actual translation-coverage boundary.

## Credentials

Credentials must be supplied through the operator's secret manager or Weblate account configuration. Never commit them to `.weblate`, `.weblate.ini`, source code, CI logs, or the ZIP artifact.

## 100% definition

For the current Weblate component, 100% means all 100 component keys are present for a locale, with no missing/extra/empty values where translation is required, source-copy checks passing, placeholder parity preserved, terminology checks passing, and the required review status reached.

This 100% component measure must not be presented as “101 canonical source keys” or as proof that every runtime locale is fully translated.
