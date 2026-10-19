# FiberOS R14.1 — 66-Locale Translation Execution Evidence

## Current state

The 66 locales listed below remain intentionally `untranslated`. No source-copy, placeholder, invented translation, or fake provider result was inserted.

The repository now contains `scripts/i18n/translate-66-opus.py`, a fail-closed execution path for a locally provisioned, explicitly licensed OPUS-MT checkpoint.

## Why NLLB-200 is not bundled

NLLB-200 is technically broad and supports 200 languages, but the published 1.3B model card lists CC-BY-NC 4.0 and describes the model as a research model not released for production deployment. That is not an appropriate assumption for a product that is intended for sale. See the model card before any future use.

## Commercial-safe direction

Helsinki-NLP's OPUS-MT repository documents public pre-trained models under CC-BY 4.0, but availability and source-data obligations must be checked per model before redistribution. The runner therefore refuses to guess a model or silently pivot unsupported languages.

## 66 target locales

ku, am, om, so, ti, yo, ig, zu, xh, af, ff, wo, bm, mg, rw, rn, st, tn, ss, ts, ve, nr, sn, ny, ln, ktu, sg, tig, din, nus, ber, yue, pa, kn, as, or, sat, ks, si, dv, ps, th, km, lo, ka, mn, bs, mk, be, lt, lv, et, is, kk, tk, tg, qu, ay, gn, mi, fj, sm, to, bi, pau, ch

## Release rule

No locale is promoted to `machine-draft`, `human-reviewed`, or `verified` until real translated values exist and the existing quality gate passes. `verified` remains human-evidence gated.
