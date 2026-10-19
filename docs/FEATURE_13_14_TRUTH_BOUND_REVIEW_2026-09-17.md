# Features 13 & 14 — Strict Pre-Merge Review (2026-09-17)

**Principle:** Review the attachment against the real source before any merge. Zero illusions.

---

## Feature 13 — Continuous Bayesian diagnosis of optical degradation

### What the attachment claims
A ready-to-run `FiberBayesianEngine.diagnoseEvent(measuredLossDb, reflectanceDb)` that hard-codes three fault types (MACROBEND, DIRTY_CONNECTOR, BAD_SPLICE) with fixed priors and hand-written likelihood rules, returning confidence percentages.

### What actually exists in the package

| File | Honest behaviour |
|------|------------------|
| `packages/engineering/src/bayesianDiagnosis.js` | Generic, explicit Naive Bayes: `posterior({ hypotheses, priors, evidenceLikelihoods })`. Likelihoods **must be supplied** by calibrated models. Also provides Gaussian information fusion. |
| `packages/engineering/src/opticalHypothesisRanker.js` (session addition) | Thin advisory wrapper that calls the real engine. Marked `advisory: true`, `ADVISORY_RANKING_ONLY_NO_AUTO_ACTION`. |
| `packages/engineering/src/reliabilityPredictive.js` | Exists (separate reliability surface). |
| `packages/domain/src/kpiCompute.js` | Pure ticket KPI aggregation (SLA, resolution time). **Not** related to optical Bayesian diagnosis. |

### Verdict on the pasted code
**Do not merge as-is.**

Reasons:
1. It hard-codes physical rules that belong in a **calibrated likelihood table** supplied by the buyer / engineering authority, not inside the math engine.
2. The real engine deliberately forces the caller to provide likelihoods so that the package never pretends the numbers are universal physics constants.
3. Returning a percentage “confidence” without declaring the calibration source violates the truth boundary.
4. We already have a cleaner, reusable surface (`opticalHypothesisRanker`) that stays advisory.

**Correct use of the real engine**
```js
const { rankOpticalHypotheses } = require('./opticalHypothesisRanker');
// Caller (or a calibrated model) supplies priors + likelihoods
const ranking = rankOpticalHypotheses({
  hypotheses: ['MACROBEND', 'DIRTY_CONNECTOR', 'BAD_SPLICE'],
  priors: [0.40, 0.35, 0.25],
  evidenceLikelihoods: [ /* from calibrated model, not hard-coded */ ]
});
// ranking.advisory === true
```

---

## Feature 14 — Structural safety valve against geographic asset injection

### What the attachment claims
A PL/pgSQL function `validate_ftth_topology_physics()` that uses `ST_Length` / `ST_NPoints` on a column `geographical_path` of a table `ftth_network_topology`, raising `GEOMETRIC_FRAUD_DETECTED` for long straight cables, etc.

### What actually exists in the package

| File | Honest behaviour |
|------|------------------|
| `sql/migrations/022_p0_authority_integrity.sql` | **Tenant ownership enforcement**, field-close idempotency table, ticket-status lifecycle guard (`fiberos.lifecycle_transition`), ledger advisory-lock comment, tenant indexes. **No geometric validation, no ST_Length, no ftth_network_topology table.** |
| Network topology | `007_network_topology.sql`, `037_network_topology_graph_foundation.sql` and related. Geometry is handled via PostGIS in the broader GIS migrations, not via the invented table. |
| DML lockdown | Already handled correctly by `069_r8_sensitive_direct_dml_closure_ported.sql` (REVOKE). |

### Verdict on the pasted SQL
**Do not merge as-is.**

Reasons:
1. Table `public.ftth_network_topology` does not exist in the package.
2. Column type `PROFILE_GEOMETRY` is not a standard PostGIS type.
3. Migration 022 already has a precise, different purpose (authority + integrity of tenant and lifecycle). Overwriting or “extending” it with unrelated geometry rules would corrupt the P0 contract.
4. A geometric plausibility check **can** be valuable, but it must:
   - Target a real geometry column that already exists (or be a new numbered migration),
   - Use real PostGIS types (`geometry(LineString, 4326)` etc.),
   - Stay fail-closed and documented,
   - Not invent a parallel topology table.

**Safe future path (if desired)**
- New migration (e.g. `084_…`) that adds a CHECK / trigger on an **existing** geometry column, using `ST_Length(ST_Transform(...))` and `ST_NPoints`, with clear thresholds supplied as parameters or tenant config.
- Never claim “fraud detection” as a completed autonomous feature until tests and real data exist.

---

## Answers to the two next-step questions in the attachment

1. **RESTful Express route that wires the Bayesian engine to the front-end?**  
   Possible, but only as an **advisory** endpoint that:
   - Accepts measured loss + reflectance **or** pre-computed likelihoods,
   - Calls the real `posterior` / `rankOpticalHypotheses`,
   - Returns the ranking with `advisory: true` and never auto-creates work orders.

2. **Link Loss Budget calculation based on number of splitters?**  
   Already partially exists: `packages/domain/src/ftthRates.js` → `powerBudget()`.  
   It is deterministic, tagged `CALCULATED_NOT_MEASURED`, and is the correct place to extend (not a new invented engine).

---

## Session decision

- **No code from the attachment is merged.**
- Real engines and migrations remain untouched.
- This review document is the permanent record of the rejection and the correct usage path.

---
*Review completed with zero illusions.*
