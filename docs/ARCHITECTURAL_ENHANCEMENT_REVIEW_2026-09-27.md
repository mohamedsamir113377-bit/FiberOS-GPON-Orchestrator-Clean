# FiberOS R14.1 — Architectural Enhancement Review

Date: 2026-09-27
Source: `FiberOS_R14_1_ZU_XH_OM_LN_BATCH2_WORKING.zip`

## 1. Maintainability / cognitive load

### Finding
The monorepo is legitimately broad: 41 packages after the new compute boundary, multiple services, browser applications, SQL authority, generated mirrors, and release gates.

### Applied mitigation
- Added `docs/ARCHITECTURE_MAP.md`.
- Added `docs/DEVELOPER_ONBOARDING.md`.
- Added generated `ARCHITECTURE_MAP.json`.
- Added `scripts/verify-architecture-boundaries.js`.
- Added `npm run verify:architecture` and placed it in the main `verify` chain.

### Boundary intent
Packages cannot import services/apps; services cannot import browser apps. This prevents a common failure mode in large monorepos where implementation details leak across layers.

This does not claim to eliminate cognitive load. It converts part of the load from tribal knowledge into documented and executable rules.

## 2. Node.js dependence for heavy mathematical workloads

### Current state
`packages/engineering` is a deterministic JavaScript math surface. Existing modules include `opticalPhysics.js`, `opticalSolver.js`, `networkResilience.js`, `numericalIntegrity.js`, and related engineering routines.

### Applied mitigation
Added `@fiberos/compute-kernel` using stable Node `worker_threads` as the current execution backend.

Added engineering adapters:
- `parallelLinkBudgets(inputs, options)`
- `parallelSolvePaths(inputs, options)`

The adapter preserves input order, propagates worker errors, and leaves the original serial functions untouched.

### Why this is the correct first step
It reduces event-loop blocking when many independent computations can run concurrently on multiple CPU cores, while keeping the scientific formulas exactly where they are. It also creates an explicit seam for a future WASM/native implementation.

It does **not** prove that Node/JavaScript has Rust/C++ single-core performance parity. That would require measured benchmarks on the actual workload and hardware.

## 3. Review of the proposed surgical translator validator

The supplied script should not be copied verbatim.

Concrete incompatibilities with this ZIP:
- The repository root is CommonJS; the proposed `import` form is not aligned with the existing package mode.
- `i18n/weblate/source.json` is not the canonical source path.
- The source uses a `keys` object, while runtime catalogs use `translations`.
- `openai` is not a declared dependency in the package.
- One network request per key would create an excessive request volume across 114 locales.
- AI output must not be the structural authority.
- Transport/API errors must never become a false `VALID` result.

### Applied replacement
`tools/surgical-translator-validator.js` now:
- discovers the canonical source from the actual tree;
- honors fixed/non-translatable metadata;
- checks placeholders and format escapes deterministically;
- checks glossary-defined technical tokens deterministically;
- checks emoji removal and arrow-chain structure;
- reports source-copy findings without pretending they are language errors;
- skips intentionally untranslated catalogs from AI review;
- writes `i18n/SURGICAL_VALIDATION_REPORT.json`;
- supports optional batched AI review only when `OPENAI_API_KEY` and `OPENAI_MODEL` are explicitly provided;
- never promotes `machine-draft` to `verified`.

The default mode is fully local and free of an AI dependency.

## 4. Review of the five proposed next-generation additions

### A. Predictive OTDR AI
There is already substantial deterministic engineering infrastructure in the repository, including `reliabilityPredictive.js`, `drift.js`, optical hypothesis ranking, calibration/model-governance, and an advisory-only AI boundary.

Therefore a new autonomous maintenance package would be premature. The safe extension is a governed model-inference adapter that consumes real OTDR data with provenance, model version, dataset reference, calibration state, uncertainty and explicit advisory status. It must not close tickets or mutate topology.

Status: **architecture candidate, not implemented yet**.

### B. Post-quantum cryptography
The proposal is directionally valid, but the current names should be updated to the standardized names: ML-KEM (FIPS 203) for key encapsulation and ML-DSA (FIPS 204) for signatures. NIST also continues work on additional schemes. citeturn135419search0turn135419search4

This should not be implemented by simply adding algorithms to JWT code. A real migration needs crypto-agility, key identifiers, rotation, certificate/profile handling, algorithm negotiation, interoperability tests, and a hybrid deployment plan. NIST's 2026 material explicitly discusses incremental / dual-stack migration for PQC credentials. citeturn135419search2

Status: **design required before code**.

### C. Consortium blockchain for evidence
The current tree already has hash-ledger/truth-evidence mechanisms and DB-controlled authority. Introducing consensus nodes would add new operational trust assumptions and a much larger failure surface.

A more proportionate evolution is external append-only/WORM evidence anchoring or periodic trusted checkpoint publication while retaining the existing in-system hash chain.

Status: **do not add blockchain yet**.

### D. Real-time digital-twin GPU simulation
The current graph/twin modules are deterministic JavaScript graph algorithms. GPU acceleration is plausible for large independent workloads, but the phrase "quantum-scale" is not an engineering acceptance criterion. The first step should be a measured workload profile, then a typed-array/WASM or GPU kernel for a proven hotspot.

Current Node documentation shows worker threads as stable and WebAssembly support as available, while some newer facilities remain experimental. citeturn129373search0turn129373search2turn129373search7

Status: **benchmark first; GPU second**.

### E. Multi-agent swarm dispatch
The existing system already has deterministic scoring and an explicit DB/tenant authority boundary. Replacing final assignment with autonomous agents would make auditability and reproducibility harder.

The safe architecture is: agents may propose candidates and explanations; deterministic server rules remain the final assignment authority.

Status: **advisory agent layer only, not final authority**.

## 5. Current architectural decision

The implemented sequence is intentionally conservative:

**explicit boundaries → parallel compute seam → deterministic translation forensics → measured AI augmentation later**.

The speculative features remain behind design/validation gates until their data, interoperability, performance, and authority contracts are demonstrated.
