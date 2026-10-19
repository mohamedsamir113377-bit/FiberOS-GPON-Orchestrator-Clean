# Pre-CI Static Audit — 2026-10-16

> **Current-state addendum — 2026-10-17.** This report is pinned to repository `codespine78-web/FiberNexus-1`, reference commit `3671a25820094f71e69d963b87bf5a857b038ce4`. Its findings below are a historical source audit, not current-main CI results for `mohamedsamir113377-bit/GPON-Orchestrator`. The latter's exact `main` base `63d9ecb98540766aee5adc22a9a58a4f2dccde22` completed 12/12 GitHub Actions checks, including 884 passing tests, ephemeral PostgreSQL/PostGIS RLS, dependency audit, source hygiene, container security, release admission, website build and visual regression. `package-lock.json` and `SBOM.cdx.json` now both include `net-snmp@3.29.2`; the lock entry has integrity metadata, and `npm audit --omit=dev --audit-level=high` passed. The dependency/SBOM blocker and instruction not to start CI are therefore superseded for that exact main base. The Migration 188 warning remains relevant: production records migrations 001–189, yet `enterprise_change_log` has 0 rows and no operational `t_ecl_*` capture triggers. Migration 190 is still a draft; fix the `event_outbox_contract` key mismatch, trusted actor/tenant attribution, canonical hash format, and multi-tenant runtime tests before any production application. Current Vercel parity and buyer-runtime acceptance remain unverified.


## Scope and limitations

Repository: `codespine78-web/FiberNexus-1`  
Reference commit: `3671a25820094f71e69d963b87bf5a857b038ce4`  
This is a source inspection only. No CI/workflow was run, no Vercel deployment was changed, and no Neon/production database was mutated. Findings below are not a security certification.

## Findings summary

| Work item | Static finding | State |
|---|---|---|
| 1.2 Branch governance | Policy written in `docs/BRANCH_PROTECTION_POLICY.md`; native GitHub protection not API-confirmed | Documented; enforcement open |
| 2.1 External adapter / tenant boundary | Adapter is fail-closed when no source/transport is configured; migration 188 has material audit-chain gaps described below | Open; remediation needed |
| 2.2 Dependencies / SBOM | Lockfile resolves `net-snmp@3.29.1` without an integrity field; SBOM timestamp is 2026-09-30 and omits the component. npm 3.29.2 notes a fix for malformed unauthenticated UDP input that could loop indefinitely and exhaust CPU/memory | Blocker; update dependency/lockfile, regenerate SBOM, scan and test |
| 2.3 Migration 188 | Actor omitted from hash; timestamp representation is not explicitly canonical; capture triggers are described but not installed; verifier uses one previous hash across tenants although insertion chains per tenant | Blocker; redesign/repair and multi-tenant database tests |
| 2.4 Official 84 locales | All 84 catalog files fetched and parsed at the reference SHA. Every catalog has the exact 101-key canonical set (zero missing/extra); direction/path/status/key-count metadata matches the 114-locale manifest. Human linguistic certification remains separate | Structural parity passed; human review open |
| 3.1 `.env.example` | Removed sample production-looking Redis resource/build identifiers and the OIDC secret placeholder value. Full source-to-environment-variable parity remains unverified | Safer template; parity gate open |
| 3.2 README / SECURITY / status | Current status banner, README, and SECURITY now include dated 2026-10-16 caveats. Older statements remain as dated historical evidence, not current status. Generated manifest/provenance still needs regeneration after these edits | Documentation updated on review branch; provenance gate open |
| 3.3 Vercel headers | Tightened `base-uri` to `none` in Vercel config, Netlify builder headers, and the NOC3D page meta CSP. Vercel's static CSP still has `connect-src 'self'`, while the Netlify builder's CSP adds `FIBEROS_API_BASE` dynamically; external API mode on Vercel would be blocked. `wasm-unsafe-eval` is global although only field OCR needs it | Source hardening committed to review branch; Vercel/API compatibility and live headers open |

## 2.1 — External-input adapter and tenant-boundary review

Inspected:
- `services/api/src/capabilities/external-input-adapter.cjs` (149 lines at this reference)
- `config/capability-input-adapters.schema.json`
- `config/capability-input-adapters.v1.json`

Positive source evidence:
- The adapter registry lists exactly four externally dependent capabilities.
- Unconfigured capabilities return `INTEGRATION_REQUIRED`; unsupported transports are rejected; missing transport bindings return `ADAPTER_UNAVAILABLE`; malformed payloads are rejected.
- Configuration has `failClosed: true`, `allowDefaults: false`, `allowEstimates: false`, and all four entries are unconfigured.

Limits:
- This does not establish tenant authorization for every route that calls the adapter. Route middleware, database authority, RLS, and adversarial cross-tenant tests must be reviewed separately.
- Schema validation alone does not prove the runtime configuration is always schema-validated.
- Do not promote these four capabilities to READY without a live probe against the buyer's authoritative source.

## 2.2 — Lockfile / SBOM

At the reference commit, `package-lock.json` resolves `node_modules/net-snmp` to **3.29.1** (not the requested 3.29.2). The lock entry has no `integrity` field. The checked-in `SBOM.cdx.json` metadata timestamp is **2026-09-30T06:04:02.023Z** and the string `net-snmp` was not present in the SBOM file. Therefore the checked-in SBOM cannot be accepted as proof that the current lockfile is fully represented, and no clean vulnerability result is claimed.

Upstream npm metadata lists `net-snmp@3.29.2` published 2026-10-09 and describes a fix for a malformed unauthenticated UDP varbind that could otherwise loop indefinitely and exhaust CPU/memory (https://www.npmjs.com/package/net-snmp). This makes the checked-in 3.29.1 version a concrete update blocker, not merely a version-preference mismatch. The upstream listing is not a complete dependency-tree scan and does not prove 3.29.2 is globally vulnerability-free. Required next action: update the declared range/lockfile to an approved 3.29.2-or-later release, regenerate the SBOM from the resolved lockfile, then run current advisory scanning and relevant tests. Do not edit only the lockfile or hand-edit the SBOM.

## 2.3 — Migration 188 Enterprise Time Machine

Source inspected: `sql/migrations/188_enterprise_time_machine.sql`.

Blocking source gaps:
1. The header still says migration 188 assumes 187 is latest and that the tenant setting is an assumption to verify. These are unresolved migration-authority notes, not acceptable final migration documentation.
2. `actor` is a persisted column but is **not included** in the `row_hash` input or in `ecl_verify_chain()` recomputation. The chain therefore does not bind the actor identity.

3. The verifier loops over all rows ordered by global `seq` while keeping one `prev` variable, but `ecl_chain()` selects the previous hash only within `NEW.tenant_id`. This makes the verifier's chain model inconsistent with the writer's per-tenant chain model. Verification must maintain prior hashes independently per tenant and must test interleaved events from at least two tenants.

4. The hash input concatenates values without delimiters or length-prefix encoding. Distinct field tuples can produce the same pre-hash byte sequence when field boundaries are ambiguous; use an explicitly versioned canonical serialization before hashing.

3. `changed_at::text` participates in the digest. PostgreSQL text rendering of `timestamptz` can depend on session timezone; verification should use a canonical UTC representation or a stable binary/canonical encoding.
4. The migration defines `ecl_capture()` and gives an example of how to attach it, but it does not create capture triggers on actual business tables. A log table and capture function alone do not prove that changes are captured.
5. `ecl_verify_chain()` iterates visible rows globally in sequence order while the chain is maintained per tenant. Its behavior relies on RLS visibility and is not explicitly tenant-filtered; test it under the exact runtime, policy-reader, owner, and bypass-RLS roles.
6. The hash input concatenates fields without explicit delimiters or canonical structured serialization. Use an unambiguous canonical encoding before treating the chain as strong integrity evidence.
7. A hash chain is not a digital signature. No signature over an actor-bound payload is implemented in this migration.

Conclusion: migration 188 is **partially implemented and not eligible for a claim of complete tamper-evident, actor-bound, per-tenant audit history** until the gaps are fixed and runtime PostgreSQL/RLS tests pass. No production migration was executed.

## 2.3.1 — Capture-trigger tenant context remains unproven

A further source-path check found a context mismatch that must be resolved before installing automatic capture triggers:

- `packages/db/src/session.js` sets `request.jwt.claim.sub`, `request.jwt.claim.role`, and `request.jwt.claims`, then executes `SET LOCAL ROLE fiberos_app`. That helper does not set `app.tenant_id`.
- `services/worker/src/worker.js` starts a transaction and executes `SET LOCAL ROLE fiberos_worker`; the inspected worker transaction helper does not establish JWT subject claims or `app.tenant_id`.
- Migration 188's `ecl_tenant` policy checks `current_setting('app.tenant_id', true)`. Therefore trigger-generated inserts are not yet demonstrated to succeed on normal API or background-worker paths. A missing/mismatched setting can reject a business transaction; treating an arbitrary caller-controlled GUC as tenant authority would also be unsafe.

This is a source-level trace of these two helpers, not a claim that every call path has been exhaustively searched. Before any capture-trigger migration, define and test a trusted tenant-context contract for authenticated API requests and worker jobs, review direct table privileges and trigger-function ownership, and add adversarial tests proving that changing a session GUC cannot forge cross-tenant entries. Do not use the earlier experimental migration-190 patch as production-ready evidence: its five passing Node tests were source-pattern tests, not live API/worker authorization tests.

## 2.4 — Official 84-locale manifest

`i18n/official-84.json` declares 84 included locales and 101 canonical keys. It explicitly identifies translation as automated, says semantic correctness is not guaranteed, and reports zero human-certified locales. These are appropriate limitations to preserve in buyer-facing claims.

All 84 files listed by `i18n/official-84.json` were fetched and JSON-parsed. Each file's `translations` object contains 101 keys and exactly matches `i18n/catalogs/source.json`: zero missing keys and zero extra keys. The 84 entries also match `i18n/manifest-114.generated.json` on locale inclusion, direction, file path, key count, and catalog status. Two catalogs have status `verified` and 82 are `machine-draft`; `humanCertifiedLocaleCount` is zero. Structural key parity is closed for this reference SHA, but linguistic accuracy, domain terminology, locale-specific formatting, RTL layout, and native-speaker semantic certification remain open. A duplicate-aware JSON parser/lint gate is still needed because JSON.parse can silently overwrite duplicate member names.

## 3.1 — Environment template

`.env.example` uses secret-file references for database credentials. I removed the example values `prod-redis-cluster-1`, `git-tag:v14.1-2026-09-28`, and `<from-provider>` from the review branch so the template no longer implies deployment-specific resource identity or a configured secret. The database secret references remain paths only. A complete cross-reference of every runtime environment lookup against the template has not been completed; do not mark the template complete until a source-driven parity check is run.

## 3.2 — Documentation truth

The top-level `FINAL_VERIFICATION_STATUS.md` still contains stale text saying 11 capabilities are unimplemented and references older CI SHAs and migration/runtime snapshots. The current feature-parity registry has moved past that state. Historical statements must remain clearly labelled historical; current status must identify the exact inspected SHA and separate source tests, hosted CI, production database evidence, and buyer-runtime acceptance.

## 3.3 — Vercel response headers

The checked-in `vercel.json` defines CSP including `frame-ancestors 'none'`, HSTS with `includeSubDomains; preload`, `X-Frame-Options: DENY`, `nosniff`, referrer, permissions, opener and resource policies. This is source evidence only. Validate all required resources against CSP in a browser, verify HSTS eligibility for every subdomain, and inspect actual deployed headers before asserting deployment security. No deployment was changed or tested during this pass.

## Hosted check-run snapshot — current main at 52c770ad (observed 2026-10-16)

The existing push-triggered Actions runs for `main` SHA `52c770ad9d6bd5d9519082fe5aab8fc9fa25bd20`, created at 2026-10-15 21:52:24 UTC, show failures:

- [Final release admission](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38813110505)
- [PostgreSQL/PostGIS RLS runtime gate](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38813110505)
- Source verification, release source security/source-hygiene, and four container image jobs (API, AI, GIS, worker) in the same run
- [Website build](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38813110485)
- [Truth check](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38813110512)
- [Visual regression](https://github.com/codespine78-web/FiberNexus-1/actions/runs/38813110427)

A separate Vercel commit status reported `success`; it is not a substitute for the failed check-runs. The GitHub API returned the job identities and conclusions, but the connected log-download path returned `BlobNotFound`, available step endpoints returned empty arrays, and no runner name was recorded. The affected jobs started at approximately 21:52:27 UTC and ended between 21:52:29 and 21:52:30 UTC with zero reported steps. That timing is consistent with failure before ordinary job steps, but does **not** prove a billing, runner, workflow, or code cause. Exact failing steps and root causes remain unestablished. The clean review branch has only a Vercel preview-comment success and a skipped Supabase Preview check; it has not passed the required release gates. Before any rerun, obtain the raw job annotations/logs through GitHub Actions UI and inspect repository/account Actions usage, spending limits, runner availability, and workflow initialization. Do not infer source-code test failures merely from the failed conclusion.

## Exit decision

**HOLD — do not start the final CI run yet.** The confirmed dependency/SBOM mismatch and migration 188 integrity/actor-binding/capture gaps are concrete blockers. The `.env.example` template has had misleading environment-specific example values removed, but source-to-template variable parity is still unverified. The official 84-locale JSON/key-set and manifest metadata comparison **passed** at the reference SHA; duplicate-aware parsing and human translation certification remain open. GitHub branch protection and the 21 archive tags could not be verified through the currently connected API path. CSP source was tightened to `base-uri 'none'` on `audit/pre-ci-static-clean-2026-10-16`, but the deployed Vercel response headers and live external-API behavior remain unverified. `SALES_PACKAGE_MANIFEST.json`, generated hashes, and provenance remain stale on this branch until regenerated from the full tree. No CI, tag creation, Vercel deployment, or Neon Production migration was performed. Do not promote/merge this branch or begin final CI until the dependency/SBOM and migration gaps are fixed and all generated release-integrity records are regenerated and reviewed.


## Repository provenance and merge gate

The audit documents and static source changes are on `audit/pre-ci-static-clean-2026-10-16`, created directly from current `main` SHA `52c770ad9d6bd5d9519082fe5aab8fc9fa25bd20`. The prior branch `audit/pre-ci-static-2026-10-16` is left untouched. `SALES_PACKAGE_MANIFEST.json`, generated hashes, and release provenance have **not** been regenerated from the complete candidate tree, so this branch must not be merged, tagged as an admitted release, or passed to the final CI gate.

A repository compare between baseline `3671a25820094f71e69d963b87bf5a857b038ce4` and current `main` found no changed files; the source tree is unchanged from that baseline even though current `main` has four additional history commits. Preserve that history; do not force-reset a branch to make its SHA appear unchanged. The new review branch starts from the actual current `main` SHA, so it is not divergent at creation.

The GitHub API returned 403 for branch-protection inspection (`Resource not accessible by integration`) and for repository rulesets (plan/feature unavailable for this private repository), so server-side protection is unverified. No CI run, tag creation, Vercel deployment change, or Neon Production migration occurred in this audit pass.


## 3.3 — Vercel CSP / security-header review

Reference: [OWASP ASVS 5.0 V3.4.3](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x12-V3-Web-Frontend-Security.md) and the [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html).

The source CSP already denies objects, constrains scripts to same-origin (with `wasm-unsafe-eval` for OCR), denies framing through `frame-ancestors 'none'`, upgrades insecure requests, and sets HSTS, nosniff, referrer, permissions, opener and resource policies. ASVS 5.0 V3.4.3 calls for `object-src 'none'` and `base-uri 'none'` as minimum directives. The source review found three `base-uri 'self'` occurrences in policy source, and no `<base>` tags in the sampled served HTML pages. On the review branch, I changed these to `base-uri 'none'` in `vercel.json`, `scripts/build-netlify-site.js`, and `apps/ops-web/public/noc3d.html`. This is a source change only and still needs website/CSP checks before merge.

**Confirmed compatibility gap:** `scripts/build-netlify-site.js` generates a Netlify `_headers` file with `connect-src 'self' <FIBEROS_API_BASE origin>` when an API base is configured. Vercel uses the separate static CSP in `vercel.json`, where `connect-src 'self'` is fixed. Consequently, setting an external `FIBEROS_API_BASE` for a Vercel deployment would inject the API URL into the site but the response header would block its browser connections. Keep `FIBEROS_API_BASE` unset for the Vercel static buyer preview until the deployment has either an explicit, narrow origin allowlist or a same-origin API proxy. Do not broaden the policy to `https:` or `*` just to make this work.

**Defense-in-depth item:** `wasm-unsafe-eval` is currently allowed by the global Vercel CSP for every route although the source comment identifies field Tesseract OCR as the reason. Consider a verified route-specific policy only after checking Vercel's multi-match header behavior; do not attempt a naive second CSP header, because multiple CSP policies are enforced cumulatively.

The current HTTP response headers, external API behavior, route-specific CSP behavior, and browser console were not verified live in this pass. Those tests belong to the approved post-freeze website acceptance stage, not to this static-only review.
