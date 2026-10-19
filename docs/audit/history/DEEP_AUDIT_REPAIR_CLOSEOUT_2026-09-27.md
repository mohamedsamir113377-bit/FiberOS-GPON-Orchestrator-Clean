# FiberOS R14.1 — Deep Audit Repair Closeout

## Scope
This closeout supersedes the stale findings in the 2026-09-27 deep audit that were generated before the i18n/source-copy repair and the subsequent architecture/deployment hardening pass.

## Closed findings

1. **Sales manifest parity** — closed. Manifest regenerated from the final tree; parity gate passes.
2. **120 i18n source-copy failures** — closed. Current quality gate reports zero source-copy failures.
3. **Stale 114-locale generated manifest** — closed. Current tally is 2 status objects verified (ar + source mirror en), 82 machine-draft, 30 intentionally untranslated.
4. **PostgreSQL/PostGIS compose contradiction** — closed at the package-contract level. Base compose now targets `postgis/postgis:18-3.6`, matching the PostgreSQL 18.6 runtime contract; the PostgreSQL 18+ volume path is used.
5. **Broken PostgreSQL TLS in base compose** — closed. Base compose no longer claims to have certificates it does not ship; production TLS is an explicit operator-supplied override with Docker secrets.
6. **Broken translation compose paths** — closed. The compose is now a validation-only service and does not reference unshipped `tools/translation` or `models/` assets.
7. **Enterprise Command DOM-XSS sink** — closed in the current tree: dynamic map labels are HTML-escaped before SVG string construction.
8. **Conflicting configured-locale RTL authority** — closed. The configured 114-locale selector and runtime metadata agree; `ku` is LTR for plain `ku`, while script-specific `ku-Arab` resolves RTL through `Intl.Locale`.
9. **Missing runtime catalog version metadata** — closed. All runtime catalogs and public mirrors now carry `version=1.0.0`.
10. **Plural metadata drift for fr/es/it/pt** — closed against the deployed runtime's `Intl.PluralRules` result.
11. **Commercial-priority client-base claim** — corrected to an explicit hypothesis; the package no longer presents unsupported customer-demand data as fact.
12. **Pseudo-secret documentation literal** — replaced with an explicit example-only marker.
13. **Stale current-work/i18n/deployment documentation** — reconciled to the current 114-locale state and current PostgreSQL 18/PostGIS 3.6 package contract.
14. **Compute-kernel workspace test breakage** — closed; the full node:test suite now passes 167/167 after the workspace dependency is installed.

## Explicitly bounded residuals

### Runtime formatting
17 configured low-resource locale tags do not have native DateTimeFormat/NumberFormat data in the audit Node ICU dataset. This is no longer an unhandled release failure: each has an explicit deterministic English formatting fallback recorded in `i18n/locale-metadata.json`. The quality gate and strict runtime-formatting gate both pass while still emitting transparent warnings identifying the fallback.

### Clean-install runtime baseline
The package contract requires Node >=24.21.0. The audit host is Node 22.16.0. A clean `npm ci` under the declared Node 24.21.x runtime was therefore not independently executed in this environment. This remains an evidence boundary, not a hidden pass.

### Live production boundaries
The source package still does not prove live OIDC/JWKS, PostgreSQL/RLS, routing, telemetry/NMS/OTDR, object storage, KMS/HSM, or messaging behavior. The PRE-DB gate intentionally reports these as `NOT_VERIFIED` and `productionReadyClaim=false`.

### Test coverage
The passing suite does not imply exhaustive behavioral coverage. Coverage gaps remain a quality-improvement area rather than a demonstrated defect. The project continues to fail closed on security/deployment claims instead of converting missing runtime evidence into a pass.

### Multi-instance rate limiting
The Redis backend remains intentionally fail-closed because no shared Redis implementation is bundled. Production multi-instance deployments must provision a supported shared rate-limit implementation before enabling that mode.

## Verification snapshot

- `npm test`: **167/167 PASS, 0 failures, 0 skipped**
- `npm run verify`: **PASS**
- `verify:i18n:runtime`: **PASS** (17 explicit fallback warnings)
- `--require-runtime-plural-parity`: **PASS**
- `verify:manifest`: **PASS**
- manifest parity: **PASS**
- JavaScript syntax: **PASS**
- architecture boundary: **PASS**
- release integrity: **PASS**
- root-cause contracts: **PASS**
- capability parity: **PASS**
- domain neutrality: **PASS**
- surgical translation structural findings: **0**

The remaining NOT_VERIFIED items are deliberately retained as evidence boundaries and are not described as production-certified.
