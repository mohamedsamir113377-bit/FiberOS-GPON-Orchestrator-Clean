# @fiberos/i18n-runtime

Sector-neutral, fail-safe translation resolver added to the sales core (2026-09-26).

## Guarantees
- **Verified-only activation** — `activation` is `verified` only for `status: "verified"` catalogs.
  `machine-draft` catalogs resolve as `draft` (preview) and never silently activate.
- **Fixed-key protection** — keys flagged `translatable: false` always return the source value.
- **RTL awareness** — `direction` is derived per locale (ar, fa, he, ur, sd, ps, dv, ku, yi).
- **ICU plural selection** — `t(key, { count: n })` selects `key.one` / `key.few` / `key.many` / `key.other`.
- **NFC normalisation** — every returned string is Unicode NFC.
- **Placeholder integrity** — `{name}` placeholders are substituted; unknown ones are preserved verbatim.
- **Never throws** — a missing key degrades to the key string.

## Usage
```js
const { createTranslator } = require('@fiberos/i18n-runtime');
const tr = createTranslator({ sourcePath: 'i18n/source.json', catalogPath: 'i18n/catalogs/vi.json' });
tr.t('ui.516f0db4cbb4');
tr.direction;   // 'ltr' | 'rtl'
tr.activation;  // 'verified' | 'draft' | 'inactive'
```
