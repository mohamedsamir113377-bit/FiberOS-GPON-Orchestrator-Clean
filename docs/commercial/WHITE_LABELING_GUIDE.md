# FiberOS R14.1 — White-Labeling Guide

## Goal

This guide lets a reseller replace the visible FiberOS identity with the reseller's own brand without changing database authority, security policy, migration history, or technical contracts.

## Golden rule

Do not perform a blind global search-and-replace across the repository. `FiberOS` also appears in technical identifiers, environment variables, package names, audit paths, and protocol contracts that must remain stable.

## 1. Identify buyer-visible branding

Start with a scoped search:

```bash
rg -n "FiberOS|FiberOS R14\.1" apps/ packages/ config/ i18n/
```

Review the results and change only buyer-visible labels.

Common buyer-visible surfaces in the delivered tree include:

- `apps/field-web/public/index.html`
- `apps/field-web/public/buyer-demo.html`
- `apps/field-web/public/engineering-demo.html`
- `apps/ops-web/public/index.html`
- `apps/ops-web/public/enterprise-command.html`
- `apps/field-web/public/i18n/source.json`
- `apps/field-web/public/i18n/catalogs/ar.json`
- `apps/ops-web/public/i18n/source.json`
- `apps/ops-web/public/i18n/catalogs/ar.json`

Exact files may change in future releases; always confirm with the scoped search first.

## 2. Replace brand assets

Update the visible product name, favicon/logo assets, and browser titles on the buyer-facing web surfaces. Keep API route names, database roles, environment variable names, migration names, and package identifiers unchanged unless an explicit engineering migration is planned.

## 3. Update localization strings

The repository currently verifies one completed runtime locale: Arabic. The other locale catalog files are structural placeholders and must not be marketed as completed translations. Update the source and the verified Arabic catalog together, then keep the locale disclosure honest.

## 4. Update the buyer demo

The interactive buyer demo supports English/Arabic presentation and is intended as a presentation surface. Keep its truth boundary intact: simulated scenario data must remain labeled simulated, and live infrastructure must never be implied by browser-only results.

## 5. Run release checks

After branding changes:

```bash
npm run verify:domain
npm run verify:manifest
npm run verify:commercial
```

If a source file changes, regenerate the sales manifest using the repository's canonical generator and re-check the final archive SHA-256.

## 6. What must never be white-labeled away

Do not remove or weaken the production hold, security boundaries, migration integrity checks, truth/evidence classifications, buyer acceptance requirements, or disclosure that live external systems require buyer-side verification.

## 7. Downstream resale

White-labeling changes the visible business identity. It does not by itself transfer source ownership or grant downstream source-redistribution rights. Those rights must be stated explicitly in the signed commercial agreement.
