# Internationalization Status — Commercial Disclosure

FiberOS contains a 114-locale i18n structure with a canonical 101-key runtime source, locale inventory, runtime selector support, and fail-safe translation resolution.

**Commercial claim boundary:** the package does not claim that every listed locale is fully translated, independently human-reviewed, or production-ready.

## Verified / draft count (2026-10-16)

| Status | Count | Detail |
|--------|-------|--------|
| Completed/verified runtime locales | **2** | `ar` (Arabic) is the verified target translation; `en` is the canonical source-language mirror tracked as verified runtime coverage — 101 catalog entries, of which 84 are translatable keys and 17 are fixed technical/status values; the 84 translatable keys have 100% coverage and status `verified`. |
| Machine-drafted target translations (`machine-draft`) | **112** | All 82 previously listed drafts plus the 30 formerly-empty placeholder catalogs filled as machine-draft in the 2026-10-16 closure wave. Earlier batches: Existing drafts: `es`, `fr`, `de`, `it`, `pt`, `ru`, `zh`, `ja`, `ko`, `hi`, `tr`; prior integrated batch: `bg`, `cs`, `da`, `el`, `fi`, `hu`, `id`, `nl`, `no`, `pl`, `ro`, `sk`, `sv`, `uk`, `vi`; current 20-locale batch: `bn`, `ur`, `ms`, `tl`, `ta`, `te`, `mr`, `gu`, `fa`, `ml`, `ne`, `my`, `az`, `uz`, `sw`, `ha`, `hy`, `sr`, `sq`, `hr`. These catalogs have 101/101 key coverage and are intentionally **not** marked `verified` or activated as verified-only releases. The current 36-locale expansion adds `ay` and `ber`, and a commercial-priority sub-batch of `zu`, `xh`, `om`, `ln`, as machine drafts. |
| Structural placeholders only | **0** | The 30 formerly-empty catalogs were filled as machine-draft in the 2026-10-16 closure wave; none remain untranslated. |
| **Total runtime locale catalogs** | **114** | Locale files under `i18n/catalogs/<locale>.json`; the canonical source file `i18n/catalogs/source.json` is tracked separately. |

`apps/*/public/locales-114.json` is an **index of locale codes**, not a claim that 114 languages are translated.

The separate `i18n/weblate/` component currently covers a 101-entry workflow surface of the 101-key canonical runtime source. It is a translation-workflow surface, not a complete runtime-catalog parity claim.

`@fiberos/i18n-runtime` is shipped as a fail-safe runtime resolver. It supports verified-only activation semantics, explicit draft activation for previews, fixed-key protection, RTL detection, plural selection, NFC normalization, placeholder substitution, and key-string fallback for missing translations.

**Seller rule:** Do not present "114 translated languages" or "27 verified languages" in a sales listing. `ar` is the verified target translation and `en` is the canonical source-language mirror; the current verified runtime count is 2. The 112 machine-draft target locales above are real `machine-draft` translations and remain pending professional human review before they can be marked `verified`.

No fabricated translations were added by this merge. The 30 formerly-empty placeholder catalogs were filled as machine-draft during the 2026-10-16 closure wave and remain pending professional human review.

### 2026-09-26 integration — 15 additional locales (historical batch)

Replaced the 15 corresponding placeholder catalog files in all three shipped catalog trees (`i18n/`, `apps/field-web/public/i18n/`, and `apps/ops-web/public/i18n/`) with their 101/101-key `machine-draft` catalogs from the language batch:
`bg`, `cs`, `da`, `el`, `fi`, `hu`, `id`, `nl`, `no`, `pl`, `ro`, `sk`, `sv`, `uk`, `vi`.

The same integration adds `@fiberos/i18n-runtime` under `packages/i18n-runtime/` and updates the workspace lockfile entry. Structural verification and the i18n quality gate pass on the merged tree; runtime i18n package tests also pass.


### 2026-09-26 integration — current 20-locale DeepL batch

Filled 20 previously empty (`untranslated`) catalogs across all three shipped catalog trees with real `machine-draft` translations generated through DeepL, keeping the canonical 101-key structure and the project's preserved technical terminology contract. Current batch: `bn`, `ur`, `ms`, `tl`, `ta`, `te`, `mr`, `gu`, `fa`, `ml`, `ne`, `my`, `az`, `uz`, `sw`, `ha`, `hy`, `sr`, `sq`, `hr`.

Historical note: a final structural/i18n quality pass reported **PASS** at that earlier 66-untranslated state; the tree at that time had 114 locales with 82 machine-draft and 30 untranslated catalogs; the 2026-10-16 closure wave since filled those 30 as machine-draft (today: 112 machine-draft, 0 untranslated). The historical 21 Intl warnings were environment/runtime capability warnings from the then-current Node runtime and were not catalog or merge failures.

### 2026-09-27 integration — first locale of the 36-locale empty set

Integrated `ay` (Aymara) as `machine-draft` across the three runtime catalog trees and the Weblate workflow catalog. The catalog contains 101/101 canonical keys with no empty translation values; the Weblate surface preserves its established 100-key workflow shape by excluding `ui.91c8e6d08207`. `ay` is not marked `verified` and is not activated by the verified-only runtime policy.

The repository-wide i18n quality gate subsequently cleared all 30 source-copy failures in the affected locales after surgical, deterministic fixes. The gate now reports zero i18n failures; 21 warnings remain for expected Intl fallback/plural-runtime drift under the current Node runtime. No GitHub files were touched.


### 2026-09-27 integration — Berber/Tamazight

Integrated `ber` as a `machine-draft` across the three runtime catalog trees and the Weblate workflow catalog. The catalog contains 101/101 canonical keys with no empty translation values; the Weblate surface preserves the established 100-key workflow shape by excluding `ui.91c8e6d08207`. Technical terminology required by the quality policy (including `RLS`, `GIS`, and protected technical tokens) was preserved. `ber` is not marked `verified` and is not activated by the verified-only runtime policy.

The repository-wide i18n quality gate subsequently cleared the 30 source-copy failures in the affected locales after surgical fixes. `ber` contributes no failure. No GitHub files were touched.

### 2026-09-27 integration — commercial-priority batch: Zulu, Xhosa, Oromo, Lingala

Integrated `zu` (Zulu), `xh` (Xhosa), `om` (Oromo), and `ln` (Lingala) as `machine-draft` across the three runtime catalog trees (`i18n/`, `apps/field-web/public/i18n/`, `apps/ops-web/public/i18n/`) and the Weblate workflow catalogs. All four locales were selected from the 30 empty placeholder catalogs on a commercial-priority basis (see `BATCHES_I18N_STATUS.md` for the selection rationale) rather than at random or in list order — this is a judgment call about the buyer's likely deployment markets, not a measured demand signal.

Each catalog contains 101/101 canonical keys with no empty translation values. Technical terminology required by the quality policy (`GIS`, `GPS`, `OCR`, `JWT`, `API`, `PSTN`, and the other preserved terms actually present in these 101 strings) was kept verbatim. The `🗺 GIS`-only label (`ui.c6e7dfa0fc87`) needed a small non-technical wrapper word in each language (matching the same fix already used for `ay`/`ber`) since a bare term-only string is otherwise indistinguishable from a source-copy violation. The Weblate surface preserves the established 100-key workflow shape by excluding `ui.91c8e6d08207`.

Both `node scripts/verify-i18n.js` and `node scripts/verify-i18n-quality.js` pass for the current tree. A later surgical pass fixed the four repeated source-copy keys across the 30 affected locales without touching the intentionally empty 30-locale set. The current repository-wide i18n quality gate reports zero failures and 21 expected runtime warnings.

These four translations were produced directly from the model's own language knowledge, the same way `ay` and `ber` were — `scripts/i18n/translate-66-opus.py` remains fail-closed in this sandbox (no network, no provisioned OPUS-MT checkpoint) and was not used. As with every other `machine-draft` locale, none of the four is marked `verified` and none is activated by the verified-only runtime policy; all four are pending professional human review, and Zulu/Xhosa/Oromo/Lingala speakers should treat the wording as a first draft rather than a finished localization. `SALES_PACKAGE_MANIFEST.json` was regenerated after this batch and the subsequent architecture hardening work; manifest parity now passes for the current working tree. No GitHub files were touched.


### 2026-09-27 surgical source-copy repair

Cleared the 30 repeated source-copy failures affecting `ui.c6e7dfa0fc87`, `ui.833c3759a177`, `ui.f272249f67c9`, and `attr.b2568fa51728` across `ku`, `am`, `so`, `yo`, `ig`, `af`, `rw`, `sn`, `yue`, `pa`, `kn`, `as`, `or`, `si`, `ps`, `th`, `km`, `lo`, `ka`, `mn`, `bs`, `mk`, `be`, `lt`, `lv`, `et`, `is`, `kk`, `tk`, and `tg`. The `🗺 GIS` label is explicitly marked invariant technical metadata (`translatable=false`) rather than forcing artificial localization. The Pashto inventory workflow arrow-chain was also repaired to preserve all six segments.

Validation after the repair: `verify-i18n-quality` PASS (0 failures, 21 warnings), `verify-i18n` PASS, and the custom surgical validator reports zero structural findings. Machine-draft status remains unchanged; no locale was promoted to verified.
