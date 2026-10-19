# Forensic linguistic audit — 114 locales

**Branch:** audit/pre-ci-static-clean-2026-10-16  
**Date:** 2026-10-16  
**Method:** Live catalog read + official-114 generation + structural gates

## Results

| Metric | Value |
|--------|------:|
| Locales | 114 |
| Keys per locale | 101 |
| verified | 2 (`ar`, `en`) |
| machine-draft | 112 |
| untranslated | 0 |
| humanCertifiedLocaleCount | **0** |
| core/ops/field SHA mismatches | 0 (tree audit) |

## Official adoption (honest)

Pack `i18n/official-114.json` adopts all **114** locales into the **structural** contract:

- Included = key coverage complete
- **Not** human-certified
- **Not** all verified
- Production activation remains `verified` only per `QUALITY_POLICY.json`

## Prior 30

Filled as machine-draft; English residue still high (~83–86%). Second-wave quality work remains recommended before any verified promotion.

## Non-claims

Automated structural PASS must never be marketed as native-speaker certification.
