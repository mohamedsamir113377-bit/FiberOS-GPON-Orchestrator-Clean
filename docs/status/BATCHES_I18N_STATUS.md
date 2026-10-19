# FiberOS R14.1 — i18n Batches Status (2026-09-27)

## Current 36-locale expansion
The 36 previously empty target locales are being filled in controlled batches. Completed so far: `ay` (Aymara) and `ber` (Berber/Tamazight) in the first batch, plus a second, commercially-prioritized batch of four Sub-Saharan African languages — `zu` (Zulu), `xh` (Xhosa), `om` (Oromo), `ln` (Lingala). All six are stored as `machine-draft` pending human review.

### First batch
- `ay` Aymara — **machine-draft, 101/101 keys**
- `ber` Berber — **machine-draft, 101/101 keys**

### Second batch — commercial priority (Sub-Saharan Africa)
Selection basis: these four were selected as a commercial-reach hypothesis for African FTTH localization. This is not a measured FiberOS client-base or demand claim; the ZIP contains no customer telemetry, deployment statistics, or market dataset establishing usage priority.
- `zu` Zulu — **machine-draft, 101/101 keys**
- `xh` Xhosa — **machine-draft, 101/101 keys**
- `om` Oromo — **machine-draft, 101/101 keys**
- `ln` Lingala — **machine-draft, 101/101 keys**

### Still pending (30)
`bi`, `bm`, `ch`, `din`, `dv`, `ff`, `fj`, `gn`, `ks`, `ktu`, `mg`, `mi`, `nr`, `nus`, `ny`, `pau`, `qu`, `rn`, `sat`, `sg`, `sm`, `ss`, `st`, `ti`, `tig`, `tn`, `to`, `ts`, `ve`, `wo`

## Current totals from the actual runtime catalogs
| Status | Count |
|--------|------:|
| verified | 2 (`ar`, `en`) |
| machine-draft | 82 |
| untranslated | 30 |
| **Total locales** | **114** |

## Rules
- New target catalogs use `status=machine-draft` until human review.
- Canonical runtime source has 101 keys.
- Weblate workflow catalogs retain the established 100-key shape (excluding the feature-center key).
- No promotion to `verified` without review.
- GitHub is intentionally untouched during this file-only phase.
- Zero fabricated translations or completion claims.


### 2026-09-27 source-copy repair
The repeated source-copy quality failures in 30 already-populated machine-draft locales were repaired without filling or altering the intentionally empty 30-locale placeholder set. The GIS label is governed as an invariant technical acronym; the remaining three affected labels were localized per locale. A Pashto inventory-status arrow chain was also corrected to preserve the original six-stage structure. The i18n quality gate now has zero failures (21 runtime warnings remain).
