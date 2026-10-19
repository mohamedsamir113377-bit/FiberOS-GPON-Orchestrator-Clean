# Website Features Merge into Buyer Evaluation Package — 2026-10-03

## Source
- **Website (small):** `FiberOS-Website-main.zip` — static Netlify website surfaces only
- **Target (large):** `FiberOS-R14.1-BUYER-EVALUATION-30D-MERGED-WITH-8MB-FEATURES-2026-10-03.zip`

## Policy
- **Add** website-unique buyer/demo/Netlify features.
- **Do not replace** evaluation console assets, full i18n catalogs, or monorepo packages/services/sql from the large package.
- Large-package i18n catalogs remain authoritative (complete); website had many empty/placeholder locales.

## Added files
| Path | Role |
|---|---|
| `apps/ops-web/public/buyer.html` | Buyer Nexus landing |
| `apps/ops-web/public/buyer.js` | Buyer UI logic |
| `apps/ops-web/public/buyer.css` | Buyer styles |
| `apps/ops-web/public/buyer-data.json` | Buyer demo data |
| `apps/ops-web/public/nexus-components.js` | Shared nexus components |
| `apps/ops-web/public/web-truth.json` | Static truth labels for UI |
| `apps/field-web/public/buyer-demo.html` | Field buyer demo surface |
| `apps/field-web/public/engineering-demo.html` | Engineering demo surface |
| `scripts/build-netlify-site.js` | Static site builder (monorepo-aware) |
| `scripts/verify-netlify-site.js` | Static site verification |
| `netlify.toml` | Netlify publish config |
| `NETLIFY_DEPLOYMENT.md` | Deployment notes |
| `SOURCE_SNAPSHOT.txt` | Website source provenance |
| `.github/workflows/website-build.yml` | CI for static site (`npm run website:test`) |

## package.json scripts
- `website:build` / `website:check` / `website:test`

## Static site routes after build
- `/` — Buyer Nexus
- `/ops/` — Operations / evaluation console (from large package)
- `/enterprise-command.html` — Enterprise command
- `/field/` — Field tech + demos
- `/i18n/` — full catalog tree from monorepo `i18n/`

## Explicit non-merge
- Website `package.json` (would destroy monorepo scripts)
- Website incomplete i18n catalogs overwriting large catalogs
- Website `npm test` mapping (full monorepo test suite preserved)


## Supplement — website standalone surfaces (no fake code)

Added **as alternate demos only** (primary evaluation modular pages unchanged):

| File | Origin |
|---|---|
| `apps/ops-web/public/ops-console-website-standalone.html` | Website `ops-web/public/index.html` |
| `apps/ops-web/public/enterprise-command-website-standalone.html` | Website `enterprise-command.html` |
| `apps/field-web/public/field-website-standalone.html` | Website `field-web/public/index.html` |

Netlify publishes them under `/demos/*` via `website:build`.

**Not replaced:** last package `index.html` / `ops.js` / `field.js` / evaluation-mode (these remain the buyer-evaluation primary surfaces).

**Not copied over:** website incomplete i18n catalogs (would regress coverage).
