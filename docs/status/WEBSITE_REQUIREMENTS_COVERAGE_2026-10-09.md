# FiberOS Website Requirements Coverage — 2026-10-09

## Scope and evidence rule

This matrix is derived from the two supplied documents, **تدقيق_FiberOS_R14.docx** and **خطة_تنفيذ_FiberOS_R14.docx**, and checked against the accessible source and workflow files on `feat/deep-reality-kernel-gaps` plus the buyer-page changes on `feat/website-ftth-asset-hierarchy-2026-10-09`.

Status labels mean:
- **SOURCE PRESENT** — the source or contract was located; not proof that it ran successfully.
- **PARTIAL** — some required source exists, but the stated target is not fully met or has not been verified.
- **BLOCKED / UNVERIFIED** — evidence needed to close the requirement is missing.
- **CONFLICT** — the source organization differs from the architecture specified in the implementation plan.

No current-head tests are claimed as passed. GitHub Actions runs on commit `fd15ab3066c4956a2aba169f464d9aae0988dec4` failed before executing any steps; their step lists were empty.

## Requirement-to-evidence matrix

| Requirement from the supplied documents | Repository evidence found | Status | Remaining action / acceptance evidence |
|---|---|---|---|
| Keep public Buyer Portal separate from authenticated Operations App; do not leak tenant/runtime data into public pages | Buyer surface is `apps/ops-web/public/buyer.html`; current page explicitly states it does not produce live inventory, port availability, optical levels, technician positions, or NMS alarms | **CONFLICT / PARTIAL** | Decide and implement a clear public-app boundary (the plan names `apps/buyer-web/public/`) or document the static build/output boundary and prove no protected operational data is bundled. Add an automated leak check against generated public output. |
| Public portal must present only evidenced capabilities and avoid claiming unconnected integrations | `buyer-data.json` reports 106 capabilities, five status classes, and `productionCertification: false`; the updated page includes an explicit truth boundary | **SOURCE PRESENT** | Run generator, website build/check/performance and tests on the exact head; inspect the final built artifact and headers. |
| Deep FTTH hierarchy: G-PON/OLT → main cabinet → passive cabinet → main box → riser/floor boxes → customer fiber/ONT | Buyer page contains six explicit `data-asset-layer` identifiers and separates calculated optical budget from measured OTDR/power-meter evidence | **SOURCE PRESENT — PRESENTATION ONLY** | Test the generated static output; prove the backend canonical asset graph, cable/core continuity, parent/child constraints, and live inventory through migrations/API/DB runtime checks before calling this operational. |
| Installation workflows: new installation, migration/replacement, and router installation; customer intake; call-center verification; schedule; nearest technician; acceptance; evidence; optical reading | `apps/ops-web/public/installation-command.js` and `docs/status/INSTALLATION_COMMAND_WORKFLOWS_2026-10-07.md` describe these paths and their server API calls | **SOURCE PRESENT / RUNTIME UNVERIFIED** | Execute unit/contract tests at exact head; run PostgreSQL/PostGIS migration and tenant-isolation tests; prove object-storage persistence and provider delivery separately. |
| Fault workflow mirrors call-center scheduling/dispatch and has tenant-safe resolution gates | `apps/ops-web/public/fault-command.js` and `docs/status/DEEP_GIS_AND_FAULT_WORKFLOWS_2026-10-07.md` describe intake, verification, appointment, dispatch, evidence, acceptance and tokenized tracking | **SOURCE PRESENT / RUNTIME UNVERIFIED** | Exact-head test suite plus live DB/RLS and provider-backed evidence tests. Confirm stale technician position handling, open-work exclusion and dispatch concurrency under load. |
| Deep GIS: technicians, installs, faults, assets, cables/ducts, nearest technician, impact analysis, provider-backed routes | Deep GIS status document describes MapLibre, bbox-bounded APIs, tenant-derived scope and routing-provider boundary | **SOURCE PRESENT / PROVIDER UNVERIFIED** | Test spatial authorization and query bounds; prove route provider attestation, tile/style SLA strategy, performance and location freshness. Do not label an illustrative map as live GIS. |
| Shared design system; responsive layout; RTL/LTR; accessibility; reduced motion; precise operational states | The plan specifies these principles; existing pages are standalone HTML/CSS/JS | **PARTIAL** | No current-head visual/browser test executed. Verify all target viewports, keyboard/screen-reader states, RTL/LTR, reduced motion, loading/unavailable/degraded/unauthorized states, and contrast using executable checks plus human review. |
| Security: no public secrets; server-side OIDC/PKCE; HttpOnly session; CSRF; CSP/HSTS/nosniff/frame-ancestors/Permissions-Policy | Existing repository documentation and API/page code describe security boundaries; installation code sends session cookies and CSRF token on mutation requests | **PARTIAL / UNVERIFIED** | Inspect generated response headers and deployment config; run source-security and browser tests; verify session/CSRF/redirect/origin behavior against live identity provider. Never place tokens or secrets in public assets. |
| Route manifest synchronized with actual pages and route ownership | The implementation plan requires a route manifest synchronized with source; no runtime route-manifest pass is evidenced by the CI results available here | **BLOCKED / UNVERIFIED** | Locate or implement the canonical manifest and enforce a test that every published route maps to a source file and auth policy; test public/protected route separation. |
| Locale support: Arabic/English RTL/LTR and translation quality | Current generated buyer facts report 114 locale catalog files, only 1 verified locale, and 113 structural placeholders | **PARTIAL — NOT MULTILINGUALLY ACCEPTED** | Do not claim 114 production-ready languages. Verify actual runtime selector/formatting and conduct human linguistic review for each language intended for release. |
| Release provenance: manifest, checksums, migration ledger, exact-head verification | Manifest declares 1,510 entries / 50,597,451 bytes and migrations 001–169, but does not include the new test file in `sha256ByFile`; CI jobs did not execute | **BLOCKED** | On a functioning runner, run the canonical `node scripts/release-provenance.js`, `npm run verify:manifest`, `npm run website:test`, the new focused test, full `npm test`, `npm run verify`, and exact-head release admission. Review the generated diff before accepting it. |
| No production-ready claim without hosted CI, PostgreSQL/PostGIS/RLS, security and E2E admission | `FINAL_VERIFICATION_STATUS.md` says HANDOFF HOLD / NOT PRODUCTION READY; current workflows failed with zero executed steps | **HOLD — CORRECT** | Preserve the hold until every required exact-head gate succeeds. Customer-specific OIDC/KMS/HSM/storage/NMS/telephony/optical-instrument proof remains separate even after source CI passes. |

## Critical order of closure

1. Preserve the current refs and keep `main` untouched.
2. Repair/verify CI runner allocation. The manifest workflow had an escaping defect in its migration filename regex and newline output; it has now been corrected in commit `fd15ab3066c4956a2aba169f464d9aae0988dec4`, but it has **not** been executed successfully.
3. Regenerate manifest/provenance only with the canonical repository generator, then review the exact generated diff.
4. Run static tests and full source/security gates at the exact head.
5. Run PostgreSQL 18/PostGIS 3.6/FORCE-RLS, concurrency and tenant-isolation tests with a real configured database.
6. Validate public/protected route separation, built assets, browser behavior, GIS and provider boundaries; obtain human linguistic review where required.
7. Re-evaluate merge base and branch divergence before any merge. A green source suite alone does not certify buyer production infrastructure.
