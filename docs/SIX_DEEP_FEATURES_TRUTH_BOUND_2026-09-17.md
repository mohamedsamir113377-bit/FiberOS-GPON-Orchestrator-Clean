# Six Deep Features — Truth-Bound Mapping (2026-09-17)

**Package:** FiberOS-R14_1-SALES-CORE (baseline + session hardening)  
**Principle:** Zero illusions. Every claim is mapped to real source. Gaps are stated explicitly.  
**Rule:** Docs before any further code. No autonomous agents. No fabricated predictions. Fail-closed external providers.

---

## 1. Reality Gate & Digital Twin GIS

**User claim summary:** Interactive dashboard that rejects fake field reports by real-time cross-reference of GPS, Photo OCR, and network topology (cm accuracy).

**What actually exists today**
| Component | Location | Honest capability |
|-----------|----------|-------------------|
| Reality Gate | `packages/domain/src/realityGate.js` | Pure Haversine distance check between job point and technician point. Default max 50 m. Returns `passed` / `GEO_OUT_OF_RANGE` / `INVALID_COORDINATES`. Authority marked `PURE_FUNCTION`. |
| Digital Twin GIS contracts | `packages/digital-twin-gis/src/index.js` | Hierarchical FTTH asset model (OLT→…→ONT), derived capacity, impact helpers. Spatial distance uses same Haversine; PostGIS is authoritative for geography columns. |
| GIS foundation migrations | `034_gis_fusion_foundation.sql`, `040_customer_impact_gis_fusion.sql`, `079_sovereign_gis_runtime.sql`, `080_sovereign_gis_spatial_intelligence.sql`, `063_odn_digital_twin_and_construction_chain.sql` | Schema and runtime surfaces for spatial intelligence and digital twin. |
| Photo OCR adapter | `packages/adapters/src/global/photoOcrAdapter.js` | Adapter present (buyer-keyed / fail-closed pattern expected). |
| Network topology | `007_network_topology.sql` + related | Topology tables exist. |

**Gaps (must not be claimed as done)**
- No single orchestration that automatically joins GPS + OCR result + topology node and rejects with centimetre precision.
- No interactive “dashboard” UI that surfaces the rejection reason to the technician in the current sales core.
- Centimetre-level accuracy is not claimed by Haversine; it is a great-circle approximation. PostGIS remains the source of truth for precise geography.

**Safe next steps (this session)**
- Keep Reality Gate pure.
- Document the integration contract so a future thin orchestrator can call: `realityGate.evaluate` + OCR adapter result + topology lookup under RLS.
- Any rejection remains advisory until server policy + RLS + operator confirmation.

---

## 2. Bayesian Diagnosis & Predictive Reliability

**User claim summary:** Sovereign AI that predicts what / where / when a fibre fault will occur before service interruption.

**What actually exists today**
| Component | Location | Honest capability |
|-----------|----------|-------------------|
| Bayesian engine | `packages/engineering/src/bayesianDiagnosis.js` | Explicit Naive Bayes posterior + ranking + entropy. Gaussian information fusion (independent + correlated via GLS). Likelihoods must be supplied by calibrated models. |
| Uncertainty / covariance | `packages/engineering/src/uncertainty.js` | Cholesky, matrix inverse, quadratic form, covariance-to-variance propagation, Gaussian P(positive). |
| Optical measurements | `008_optical_measurements.sql` + engineering optical modules | Measurement storage and physics helpers exist. |
| Fault localization | `packages/engineering/src/faultLocalization.js` | Present. |

**Gaps**
- No continuous “listening” loop that automatically pulls live optical measurements and issues preventive work orders.
- No claim of production-grade prediction of exact future failure time.
- Posterior is only as good as the calibrated likelihoods the buyer supplies.

**Truth language required**
- “Advisory ranking of hypotheses given supplied likelihoods and optical observations.”
- “Deterministic math; human confirms any maintenance action.”

---

## 3. Cryptographic Ledger Append & Asset DNA

**User claim summary:** Immutable ledger for ownership, handover stages, and “Asset DNA” fingerprints for splitters / ODF etc.

**What actually exists today**
| Component | Location | Honest capability |
|-----------|----------|-------------------|
| Hash ledger append | `packages/domain/src/ledgerAppend.js` + `012_hash_ledger.sql` + `025_p0_ledger_append_authority.sql` | Real append-only chain with previous_hash, block_hash, advisory transaction lock, and `LEDGER_SECRET_KEY`. If secret missing → `{ appended: false, reason: 'LEDGER_SECRET_MISSING' }` (fail-closed). |
| Ledger primitives | `packages/domain/src/ledger.js` | Genesis hash, computeBlockHash. |

**Gaps**
- No pre-built “Asset DNA” helper that fingerprints a physical asset and automatically appends.
- No automatic injection on every splitter/ODF installation event (that would require ticket lifecycle hooks + RLS-safe write path).

**Safe extension (this session)**
- Add a pure `createAssetFingerprint` helper that deterministically hashes canonical asset attributes (type, serial, location ref, install event id). The actual append remains an explicit call to `appendLedgerBlock` under buyer secret + RLS.

---

## 4. Model Governance & Uncertainty Engine

**User claim summary:** Web simulation / engineering tool that evaluates FTTH network efficiency in planning, with human-error margin and robust statistics.

**What actually exists today**
| Component | Location | Honest capability |
|-----------|----------|-------------------|
| Model governance | `packages/engineering/src/modelGovernance.js` | Full lifecycle: DRAFT → CALIBRATION → VALIDATION → PROPOSED → APPROVED → SUSPENDED → RETIRED. Parameter objects with provenance, validRange, stdUncertainty, distribution. Approval authority check. Calibration envelope. |
| Uncertainty engine | `packages/engineering/src/uncertainty.js` | Positive-definite checks, covariance propagation, Gaussian probability. |
| Related SQL | `020_model_parameter_governance.sql` | Schema support. |

**Gaps**
- No full interactive web simulation UI that runs end-to-end planning scenarios.
- The math is solid; the orchestration layer and UI are the remaining work.

**Status:** Strong pure foundation. Keep as-is; document as the authoritative calculation core.

---

## 5. Tenant RLS Completion & Zero Trust Boundary

**User claim summary:** Multi-tenant platform where hundreds of contractors / ISPs work with zero data leakage.

**What actually exists today**
| Component | Location | Honest capability |
|-----------|----------|-------------------|
| RLS core + progressive hardening | `009_rls_core.sql`, `023_p0_tenant_authority.sql`, `024_p0_trust_boundary_hardening.sql`, `028_zero_trust_hardening.sql`, `029_zero_trust_integrity_gate.sql`, `051_tenant_rls_completion.sql` (and later 072, 082, 083) | Extensive Row-Level Security source. |
| Production hold | core productionHold pattern | Active by default; buyer attestation required. |
| Secrets / leakage controls | security packages + config | Fail-closed patterns. |

**Gaps / hard truth**
- Source migrations are **not** live proof of isolation. Buyer must execute cross-tenant tests in their own PostgreSQL environment.
- This remains a buyer-attested control, not a delivered certification.

---

## 6. FTTH Rates & Incident Kernel (Dynamic Costing)

**User claim summary:** Instant CapEx/OpEx pricing of optical paths based on field changes and emergencies.

**What actually exists today**
| Component | Location | Honest capability |
|-----------|----------|-------------------|
| Optical budget rates | `packages/domain/src/ftthRates.js` | Deterministic power-budget calculator (attenuation tables, splitter loss, splice/connector constants). Explicitly tagged `CALCULATED_NOT_MEASURED`. |
| Incident correlation | `packages/enterprise-kernel/src/incidentKernel.js` | Groups signals by topology key into OPEN incidents. |
| Construction lifecycle | `060_ftth_construction_lifecycle.sql` (and related) | Schema present. |

**Gaps**
- No live material-price feed or automatic invoice generation.
- No continuous re-pricing engine that reacts to every field change without explicit invocation.

**Safe extension**
- Pure cost estimator that multiplies recorded quantities (km, splices, splitters, connectors) by buyer-supplied unit rates + optical budget from `ftthRates`. All numbers must already exist or be supplied by the caller.

---

## Session Actions (truth-bound)

1. Document the six features exactly as above (this file).
2. Add pure helpers only:
   - Asset fingerprint (for ledger / DNA).
   - Thin advisory Bayesian optical-hypothesis ranking helper (likelihoods required).
   - Pure construction cost estimator that re-uses `ftthRates` + recorded quantities.
3. Update REQUIRED_ADDITIONS_STATEMENT, 2026_HIGH_VALUE_EXTENSIONS, ENTERPRISE_HARDENING_INVENTORY.
4. Re-package the complete archive.

**Never claimed**
- Autonomous prediction or auto-work-order creation.
- Centimetre GPS+OCR rejection already live.
- Live multi-tenant isolation certification.
- Hard-coded third-party keys or free hosted AI.

---
*This document is the planning gate for the six features. All subsequent implementation must stay inside these bounds.*
