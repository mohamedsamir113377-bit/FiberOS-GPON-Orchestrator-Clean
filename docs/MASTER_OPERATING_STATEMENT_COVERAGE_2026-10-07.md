# FTTH CORE — Master Operating Statement Coverage Matrix
Date: 2026-10-07
Branch: `handoff/final-commercial-candidate-2026-10-07`

## Evidence rule

This matrix separates **source implementation** from **test evidence** and **runtime proof**. A source feature is not labelled runtime-verified merely because the SQL or JavaScript exists.

| Specification area | Current source coverage | Primary implementation evidence | Proof state |
|---|---|---|---|
| Canonical physical taxonomy | Implemented foundation | migrations 007/022 + 137 class registry/semantic links | SOURCE IMPLEMENTED; runtime unproven |
| Fibre/core continuity | Implemented foundation | migration 019 + 137 DB continuity/range guards | SOURCE IMPLEMENTED; runtime/concurrency unproven |
| Structured service-path versioning | Implemented + guarded | migration 136 version table + 137 structured hops + 139 live-version guard | SOURCE IMPLEMENTED; end-to-end runtime unproven |
| Shared operational graph | Implemented foundation | migration 019 physical graph + 137 shared graph edges | SOURCE IMPLEMENTED; common graph integration unproven |
| Asset-specific acceptance | Implemented | migration 063 lifecycle states + 137 acceptance gate trigger | SOURCE IMPLEMENTED; runtime unproven |
| OLT/PON correlation | Boundary + pure telemetry contract | 137 telemetry registry + `@fiberos/southbound-contract` ponTelemetryBoundary (normalize/correlate only; connectivity never claimed) | BOUNDARY SOURCE IMPLEMENTED; BUYER/PROVIDER CONNECTIVITY REQUIRED |
| Optical assurance | Existing + path-bound ledger compile | optical measurements + 139 ledger + `assessOpticalAssurance` path fields + `compileOpticalAssuranceLedgerRecord` (service-path version required) | PARTIAL SOURCE; real instrument/vendor evidence remains separate |
| Fault blast radius / service problems | Existing + expanded foundation | fault workflows 132–134 + network graph/reality package | PARTIAL; exact production correlation unproven |
| Building/riser hierarchy | Implemented foundation | 137 buildings/floors/risers/units/riser-boxes | SOURCE IMPLEMENTED; runtime unproven |
| Civil/duct/third-party risk | Implemented foundation | 063 duct model + 137 inspections/corridor-risk | SOURCE IMPLEMENTED; buyer GIS/civil evidence unproven |
| Continuous network self-audit | Implemented source function | 137 `fiberos_run_network_integrity_scan` + integrity findings | SOURCE IMPLEMENTED; function not executed on exact runtime |
| Resilience/shared-risk | Scenario engine + service-path hop bridge | resilienceAdvanced + `dependenciesFromServicePathHops` / `analyseSharedRiskFromServicePaths` (hop identifiers only) | SOURCE IMPLEMENTED; live graph/runtime unproven |
| Predictive capacity/investment scenarios | Implemented deterministic calculation + simulation storage | `@fiberos/performance-capacity` + 137 capacity scenario storage | SOURCE IMPLEMENTED; exact-head runtime unproven |
| Controlled agentic assistance | Governance boundary implemented | reality-kernel authorization + 137 proof-carrying command fields/guard | SOURCE IMPLEMENTED; no live autonomous topology mutation claimed |
| Evidence admissibility | Implemented foundation | existing provenance + 136/137 evidence classes/admissibility rules | SOURCE IMPLEMENTED; external proof adapters unproven |
| Authority resolution / conflict handling | Implemented foundation | truth facts/conflicts + 137 authority policies/compiler/conflict events | SOURCE IMPLEMENTED; full compiler/runtime execution unproven |
| Deterministic replay | Implemented storage/control foundation | 137 replay events + sequence guard | SOURCE IMPLEMENTED; historical replay runtime unproven |
| Safety budget | Implemented foundation | 136 impact budget + 137 command expected impact | SOURCE IMPLEMENTED; live command execution not proven |
| Claim-carrying release | Implemented schema + package gate | 137 capability claims + package validation | SOURCE IMPLEMENTED; CI/runtime references remain evidence requirements |
| Offline field sync | Implemented source foundation | 018/120 sync idempotency/conflict processor + `packages/offline-field-queue` AES-GCM/IndexedDB queue | SOURCE IMPLEMENTED; exact device/browser runtime, key lifecycle and field verification remain unproven |
| Public tracking | Existing hardened boundary | 128/132/133 token hash/expiry/revocation/RLS | SOURCE IMPLEMENTED; exact-head runtime proof pending |
| Network knowledge system (Section 28) | Implemented source + DB authority | `packages/network-knowledge` + migration 141 `network_knowledge_records` | SOURCE IMPLEMENTED; persistence runtime unproven |
| Data quality / reconciliation (Section 29) | Implemented source + DB authority | `packages/data-quality-engine` + migration 141 reconciliation job/finding tables | SOURCE IMPLEMENTED; scheduled execution runtime unproven |
| Department KPI resolution (Section 33) | Implemented source + DB authority | `packages/operations-kpi` deterministic computation + `/v1/operations/department-kpis/{department}` + migrations 141/144 KPI authority | SOURCE IMPLEMENTED; all previously deferred KPI prerequisites now have a persisted source path; exact-head DB/runtime proof pending |
| Tenant isolation | Extensive source hardening | RLS/FORCE RLS, tenant FK guards, 121–128 + 138 reference guards | SOURCE IMPLEMENTED; adversarial exact-head runtime proof pending |
| Security controls | Extensive source hardening | TLS/auth/RLS/least privilege/hash/evidence controls in existing tree | PARTIAL by environment; KMS/HSM/real provider boundaries remain external |
| Performance architecture | Foundation exists | spatial indexes, bounded graph functions, derived projections, async/event boundaries | DESIGN/SOURCE FOUNDATION; benchmark SLOs must be deployment-specific |

## Acceptance Tests 01–16

| Test | Current status | Honest interpretation |
|---|---|---|
| 01 End-to-end trace | SOURCE IMPLEMENTED | Canonical explicit-link customer/service/network trace now exists in operations-trace; exact customer-to-OLT live chain still requires runtime/provider data |
| 02 Reverse impact | SOURCE IMPLEMENTED | Graph impact helper and fault/root-asset links exist; exact production blast-radius proof pending |
| 03 Temporal reconstruction | SOURCE IMPLEMENTED | Versioned paths + package reconstruction exist; database/runtime proof pending |
| 04 Port concurrency | SOURCE IMPLEMENTED | ODN active-port uniqueness exists and core locking guard added; exact concurrent DB test pending |
| 05 Core continuity | SOURCE IMPLEMENTED | DB trigger checks tenant/self/active continuity and splice ranges; runtime test pending |
| 06 Construction promotion | SOURCE IMPLEMENTED | Cable/duct/ODN accepted/live promotion requires acceptance gate fields |
| 07 Fault closure | SOURCE IMPLEMENTED | Fault command/lifecycle/evidence gates already exist |
| 08 Evidence non-promotion | SOURCE IMPLEMENTED | Kernel tests explicitly reject simulated/client/unverified self-promotion |
| 09 Tenant isolation | SOURCE IMPLEMENTED | RLS/FORCE-RLS + cross-reference guards exist; exact-head adversarial runtime proof pending |
| 10 GIS consistency | SOURCE IMPLEMENTED | Bounded planned/field/as-built reconciliation kernel exists; real GIS/as-built acceptance remains runtime/field proof |
| 11 OLT correlation | NOT RUNTIME-PROVEN | Telemetry registry/correlation boundary added; no real vendor/NMS connector is claimed |
| 12 Call correlation | SOURCE IMPLEMENTED | Explicit call/ticket/service/incident/asset correlation graph exists and surfaces ambiguity; provider/runtime end-to-end correlation remains pending |
| 13 Material trace | SOURCE IMPLEMENTED | Material chain events link inventory/work/package lifecycle |
| 14 Offline sync | SOURCE IMPLEMENTED | Server-side idempotency/conflict/replay controls plus AES-GCM browser queue, IndexedDB persistence and deterministic reconnect/conflict state machine; device/key/runtime verification remains pending |
| 15 Agent guard | SOURCE IMPLEMENTED | Command policy/authorization/impact/post-condition boundaries exist; autonomous live mutation is not enabled |
| 16 Recovery | SOURCE IMPLEMENTED | Replay/state structures plus deterministic interrupted-control recovery guard; exact interrupted-execution DB/runtime proof pending |

## Deep Architecture Addendum Coverage

The five-kernel target is now represented at source level as follows:

1. **Reality Kernel** — observations, semantic classes, truth claims, temporal validity, integrity findings.
2. **Proof Kernel** — evidence classes, proof references, admissibility rules, signed evidence support already present in the digital-twin layer.
3. **State / Invariant Kernel** — lifecycle gates, continuity guards, acceptance gates, tenant-reference guards, command pre/post contracts.
4. **Counterfactual / Impact Kernel** — failure simulation, capacity scenarios, impact budgets.
5. **Control Kernel** — authorized commands, policy/authorization fields, idempotency, execution state, post-condition proof.

This is **not** a claim that all five kernels are complete production engines. Sections 61–62 of the master statement explicitly require independent source/tests/runtime proof before those become full capability claims.

## Implementation order

The current branch follows the master statement's order rather than rewriting the product:

1. Canonical taxonomy
2. Core/port/fibre continuity
3. Temporal service paths
4. Shared network graph
5. Asset lifecycle/acceptance
6. OLT/PON correlation boundary
7. Optical assurance linkage
8. Fault impact correlation
9. Building/riser hierarchy
10. Civil/duct risk
11. Continuous integrity audit
12. Resilience/capacity simulations
13. Controlled agentic governance

### Source closure additions — 2026-10-07

- End-to-end trace: packages/operations-trace.
- GIS reconciliation: packages/gis-reconciliation.
- Call/incident correlation graph: packages/contact-center-intelligence.
- Optical provenance guard: validateOpticalEvidence in network-reality-kernel.
- Offline generic operation envelope: fiberos.operation-envelope.v1.
- Recovery reauthorization: explicit reauthorizationRef is now required for interrupted-cycle recovery.
- Static governance contracts: API authorization, security surface, performance and commercial consistency gates.

All of the above are source-level closures; no runtime certification is implied.

### Offline field-sync closure

The browser-side queue is now source-implemented with AES-GCM encryption, IndexedDB persistence, deterministic state transitions, conflict preservation, bounded retry, and explicit prohibition of client tenant authority. This closes the source-level queue gap without claiming device/runtime proof.

## Current release boundary

The branch remains:

**FINAL HANDOFF CANDIDATE — NOT PRODUCTION READY**

The exact-head hosted CI, PostgreSQL 18/PostGIS 3.6 migration execution, FORCE-RLS adversarial runtime tests, container/source security gates, and buyer/provider environment integrations remain proof boundaries. No runtime PASS is inferred from source presence.


### Additional hardening

Migration 139 additionally makes live service-path versions immutable with respect to topology identity/hash and requires a new version for path changes. It also adds an append-only optical-assurance ledger for current/history residuals, alarm correlation and peer observations, with no forecasting.

### Gap closure cycle — knowledge, reconciliation and department KPIs (migration 141)

Migration `141_network_knowledge_and_reconciliation.sql` closes the last specification areas
that had no database authority at all:

- **Section 28 — Network Knowledge System.** `network_knowledge_records` requires at least one
  evidence id (`cardinality(evidence_ids) > 0`) and requires a model reference **and** a human
  reviewer whenever `origin = 'model_generated'`. `@fiberos/network-knowledge` content-addresses
  every record, refuses to capture without evidence, and reports non-traceable records as
  `excludedUntraceable` instead of returning them.
- **Section 29 — Data Quality / Reconciliation Engine.** `network_reconciliation_jobs` only accepts
  explicitly declared source pairs and structurally disables `auto_repair` / `auto_resolve`.
  `network_reconciliation_findings` structurally cannot carry a selected winner for a
  `CONTRADICTED` fact (`CHECK (status <> 'CONTRADICTED' OR selected IS NULL)`).
  `@fiberos/data-quality-engine` implements the deterministic run with the same rule.
- **Section 33 — KPIs by department.** `@fiberos/operations-kpi` binds departments only to KPI ids
  that exist in the live `packages/domain/src/kpiCatalog.js`; KPIs the current schema cannot
  honestly compute are declared `DEFERRED` with their exact missing columns
  (`network_department_kpi_bindings.required_columns`) and are never given an invented value.
- **Defect fix.** `@fiberos/network-reality-kernel` referenced an undefined `finite()` helper inside
  `assessOpticalAssurance`, so the optical-assurance boundary threw `ReferenceError` instead of
  evaluating evidence. The helper is now defined and exported, and the stale recovery test that
  contradicted the hardened reauthorization contract was corrected.

All of the above remain **SOURCE IMPLEMENTED / RUNTIME UNPROVEN**. The release boundary of
Section 42 is unchanged: the branch is still FINAL HANDOFF CANDIDATE — NOT PRODUCTION READY until
exact-head hosted CI plus PostgreSQL 18/PostGIS 3.6/FORCE-RLS runtime evidence actually execute.

### Gap closure cycle — department KPI execution and previously deferred prerequisites (migration 144)

Migration `144_department_kpi_truth_primitives.sql` closes the six KPI prerequisites that were previously marked schema-blocked:

- **FIRST_TIME_FIX_RATE:** `tickets.reopen_tracking_observed` and `tickets.reopened_at` are now maintained by a database trigger. Legacy rows are not retroactively classified; only observed history enters the denominator.
- **TECHNICIAN_TRAVEL_MINUTES:** uses the existing `technician_positions` history and persisted `speed_mps`, with a bounded sample gap; the API reports GPS-observed moving intervals rather than inventing unobserved transit.
- **REVENUE_PER_TICKET:** uses the existing tenant-scoped `invoices.amount_minor` and `ticket_id`, preserving currency separation and performing no FX conversion.
- **CABLE_REEL_REMAINDER_METERS:** adds an append-only millimetre ledger `material_reel_ledger`; balances are derived from persisted conservation deltas only.
- **SPLITTER_LEG_UTILISATION:** derives used/total splitter-leg state directly from `network_ports.port_type/status`; no synthetic `splitter_leg_state` column is introduced.
- **PON_OPTICAL_MARGIN_DB:** derives current minus expected RX only from path-bound assurance assessments linked to `field_reading` or `nms_poll` measurements.

The new endpoint `GET /v1/operations/department-kpis/{department}` is database-backed, tenant-scoped, read-only, and exposes explicit evidence counts and limitations. All six previously deferred KPI declarations have been removed from the operations-KPI resolver. Runtime PostgreSQL 18.6+/PostGIS 3.6 and exact-head RLS execution remain release evidence boundaries.

### Gap closure cycle — resilience shared-risk scenario engine

`packages/engineering/src/resilienceAdvanced.js` now implements the Section 20 scenario questions as a pure deterministic ranking layer:

- `analyseSharedRiskExposure` ranks resources and shared-risk groups by structural exposure (declared service × customer counts × optional criticality), detects zero path-diversity dependencies, and flags resources without an acceptable alternative.
- `whatIfResourceFails` returns structural blast impact from an explicit dependency list only.
- `rankCriticalConcentration` ranks ducts/cabinets/corridors by critical-service concentration from explicit container membership.

No failure probabilities, cut rates, or investment costs are invented. Outputs remain recommendation/ranking only and never mutate network state. Tests: `packages/engineering/test/resilienceSharedRisk.test.js` (9 cases). Status remains **SOURCE IMPLEMENTED / RUNTIME UNPROVEN**.

### Gap closure cycle — service-path risk bridge, path-bound optical assurance, PON telemetry boundary

1. **Service-path → shared-risk** (`@fiberos/engineering` resilienceAdvanced):
   - `dependenciesFromServicePathHops` derives dependency resourceIds only from explicit hop asset/port/core identifiers.
   - `analyseSharedRiskFromServicePaths` composes that derivation with `analyseSharedRiskExposure`.
   - Proposed/empty paths are skipped; nothing is invented.

2. **Optical assurance path binding** (`@fiberos/network-reality-kernel`):
   - `assessOpticalAssurance` accepts optional `servicePathVersionId` / hop ordinals and sets `pathBound`.
   - `compileOpticalAssuranceLedgerRecord` refuses to compile without a service-path version id (path-only binding).
   - No forecasting; instrument verification remains external.

3. **PON telemetry adapter boundary** (`@fiberos/southbound-contract` ponTelemetryBoundary):
   - Validates read-only adapter declarations (write operations forbidden).
   - Normalizes samples with fail-closed evidence classification (measured requires instrument + receipt).
   - Correlation keys are external identifiers only; connectivity is never claimed (`connectivityProven: false`).

All remain **SOURCE / BOUNDARY IMPLEMENTED — RUNTIME / VENDOR CONNECTIVITY UNPROVEN**. Section 42 release posture unchanged.

### Completion cycle — path-bound optical DB + PON staging + API surfaces (migration 142)

Migration `142_path_bound_optical_and_pon_telemetry_boundary.sql`:

- Adds `service_path_version_id`, `path_hop_ordinals`, `path_bound`, `content_hash` to
  `network_optical_assurance_assessments` with CHECK that `path_bound` requires a path version,
  and tenant guard coverage for the new FK.
- Creates append-only `network_pon_telemetry_observations` with
  `connectivity_proven boolean NOT NULL DEFAULT false CHECK (connectivity_proven = false)`.
- Creates `network_pon_adapter_declarations` with `read_only` and `connectivity_claimed` structurally false.

API advisory surfaces (verified principal required; no live mutation):

- `POST /v1/engineering/shared-risk-exposure|what-if-resource-fails|critical-concentration|service-path-dependencies|shared-risk-from-service-paths`
- `POST /v1/reality-boundary/optical-assurance|optical-assurance-ledger|validate-optical-evidence|pon-adapter-declaration|pon-telemetry-sample|pon-telemetry-batch|pon-correlation-keys`

Status remains **SOURCE / BOUNDARY IMPLEMENTED — RUNTIME / VENDOR CONNECTIVITY UNPROVEN**. Section 42 unchanged.

### Completion cycle — auth admission, capability registry, trace→risk pipeline

- `POST /v1/reality-boundary/*` added to central `routeAuthorizationPolicy` (deny-by-default admission).
- `config/api-authorization-matrix.v1.json` gains the `reality-boundary` route family.
- Capability registry entries: `resilience.shared-risk-scenario`, `resilience.service-path-risk-bridge`,
  `optical.path-bound-assurance`, `pon.telemetry-adapter-boundary`.
- `servicePathsFromTraceNodes` / `analyseSharedRiskFromTraceNodes` convert ordered operational-trace
  node identities into hop dependencies without inventing nodes or querying a live graph.
- Canonical role `procurement` restored in `@fiberos/security` so route contracts reference only
  known roles.

Status remains **SOURCE / BOUNDARY IMPLEMENTED — RUNTIME / VENDOR CONNECTIVITY UNPROVEN**.

### Linked shared-risk analysis (authoritative path hops)

`packages/engineering/src/sharedRiskLinkedAnalysis.js` loads:

- `network_service_path_versions` + `network_service_path_hops` (live/accepted only)
- `services.customer_ref` for customer linkage
- `network_assets` types
- `network_failure_domains` / members for sharedRiskGroup + criticality + alternative flags
- `physical_topology_edges.shared_risk_group` as fallback group source
- optional duct/corridor containers via containment edges

API: `POST /v1/network-intelligence/shared-risk` (verified principal, RLS session, client `tenantId` forbidden).

When schema is absent, returns `available:false` with reason — never invents paths.


### 2026-10-08 hardening audit — linked risk completeness and evidence promotion

The linked shared-risk loader now counts authoritative service-path hops before retrieval and fails closed when a selected path exceeds 5,000 hops or the selected set exceeds 200,000 hops; it no longer truncates a large hop set behind a successful-looking report. Optical ledger compilation now requires `pathBound === true` and exact `servicePathVersionId` identity. PON telemetry evidence promotion no longer trusts a caller-supplied `sourceTrusted` flag or an adapter receipt alone; higher layers must provide explicit authoritative attestation. These are source-level hardening changes; hosted PostgreSQL/RLS and provider runtime execution remain unproven.
