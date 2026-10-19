# Netlify Deployment

## Site contents

This project builds the existing static FiberOS web surfaces:

- Buyer Nexus at `/`
- Operations Console at `/ops/`
- Enterprise Command at `/enterprise-command.html`
- Field Tech at `/field/`
- Source-backed i18n assets at `/i18n/`

The static site does not claim that the FiberOS API, PostgreSQL/PostGIS, OIDC/JWKS, KMS, network devices, object storage, or backups are available or production-verified.

## Netlify build settings

Import `mosamiryamany-hub/FiberOS-Website` and deploy branch `main`. Netlify reads `netlify.toml` from the repository root.

- Build command: `node scripts/build-netlify-site.js`
- Publish directory: `.netlify/site`
- Node version: `24.21.0`

## Optional API URL

Set `FIBEROS_API_BASE` only if a real FiberOS API endpoint exists and has been configured for browser access. This is a public URL, not a secret. Never put JWTs, database passwords, private keys, or provider credentials in this variable.

When `FIBEROS_API_BASE` is empty, the UI uses its existing same-origin behavior and does not invent API results.

## Verify a deploy

After connecting Netlify, test `/`, `/ops/`, `/enterprise-command.html`, and `/field/`. The website is the web layer only; backend runtime and infrastructure must be operated separately.
