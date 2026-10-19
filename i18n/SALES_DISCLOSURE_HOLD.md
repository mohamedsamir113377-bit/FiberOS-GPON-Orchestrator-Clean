# Localization — official adoption notice

## Official pack (114)

**Status:** Officially adopted (`i18n/official-114.json`)

| Tier | Count | Locales / meaning |
|------|------:|-------------------|
| verified | 2 | `ar`, `en` — production activation eligible |
| machine-draft | 112 | Official automated drafts |
| untranslated | 0 | — |
| human-certified | 0 | None |

## Mandatory notice (AR / EN)

**EN:** Official 114-locale pack = **automated translation** + **structural forensic audit**. Not native-speaker certification.

**AR:** حزمة **114 لغة معتمدة رسميًا** = **ترجمة آلية** + **تدقيق جنائي هيكلي**. **ليست** شهادة متحدث أصلي.

## Activation rule (unchanged)

Per `QUALITY_POLICY.json`: production UI activation statuses = **verified only**.

## Forbidden claims

- Human-certified / native-speaker reviewed for all 114
- Equating machine-draft with verified
- Hiding the automated + forensic-only scope

## Related files

- `i18n/official-114.json`
- `i18n/official-84.json` (sales subset)
- `i18n/FORENSIC_LINGUISTIC_AUDIT_114.md`
- `scripts/i18n-structural-gate.mjs`
