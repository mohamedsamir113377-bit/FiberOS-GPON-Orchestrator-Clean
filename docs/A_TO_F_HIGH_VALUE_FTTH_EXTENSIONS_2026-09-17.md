# A–F High-Value FTTH Extensions — Planning & Truth Gate (2026-09-17)

**Order of execution:** A → B → C → D → E → F  
**Standards note (critical):**

| Standard | What it actually governs | Relation to this package |
|----------|--------------------------|---------------------------|
| **Telcordia SR-4731 / Bellcore** | Binary structure of OTDR `.SOR` trace files (Map block, GenParams, FxdParams, KeyEvents, DataPts, …) | **This is the correct standard** for Feature A / OTDR parsing. Already used by `sorParser.js`. |
| **ITU-T G.988** | OMCI (ONU Management and Control Interface) for GPON/XG-PON — management messages between OLT and ONU | **Not** an OTDR file format. Useful for ONU inventory / status, not for parsing `.SOR` binary traces. |

Byte-level field layouts inside FxdParams / DataPts **vary by vendor and revision**. No universal public free table is assumed. Resolvers are registered only when a real layout is supplied.

---

## A — Vendor OTDR Field Resolver Registry

**Goal:** Make Feature 11 operational without inventing numbers.  
**Exists:** Block scanner + empty resolver registry.  
**This step:** Clear registration API, richer scan metadata export, documentation of how to add a vendor once layout is known.  
**Still required from buyer:** Actual byte layout (or vendor SDK) for each brand.

## B — Calibrated Likelihood Packs (Bayesian)

**Goal:** Data-driven priors + likelihoods instead of hard-coded physics.  
**Exists:** Generic `bayesianDiagnosis` + advisory ranker.  
**This step:** Pack schema + loader that feeds the real engine. Packs are versioned and tenant-scoped in design.

## C — Link Budget vs Measured Comparison

**Goal:** Compare `powerBudget()` (calculated) with a measured rx/loss value and surface margin + reason codes.  
**Exists:** `ftthRates.powerBudget`.  
**This step:** Pure comparison helper. Measured value must be supplied (from OTDR resolver or manual entry).

## D — Asset DNA binding on install events

**Goal:** On controlled install close-out, produce fingerprint and optionally append to ledger.  
**Exists:** `assetFingerprint` + `ledgerAppend`.  
**This step:** Thin pure orchestrator that never invents secret or writes without caller authority.

## E — Geometric plausibility on real geometry

**Goal:** Reject obviously impossible paths (zero length, extreme length with almost no vertices).  
**Exists:** PostGIS + network topology migrations.  
**This step:** Pure JS geometric checks + design note for a future migration on **existing** geometry columns. No invented tables.

## F — Exception-first board signals

**Goal:** Rank tickets/candidates that need human attention with explicit reason codes.  
**Exists:** `dispatch.rankCandidates`, `skillsEligibility`, `decisionSafety`.  
**This step:** Pure aggregator of exception signals.

---

## Non-goals (rejected)

- Autonomous work-order creation from Bayesian output.
- Invented OTDR numeric profiles.
- Claiming G.988 as the OTDR binary standard.
- Magic-token DML bypasses.
- Live multi-tenant certification.

---
*Implementation follows this document in order A→F.*
