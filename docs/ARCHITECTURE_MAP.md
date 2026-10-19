# FiberOS R14.1 — Architecture & Maintenance Map

## Purpose

This document is the onboarding boundary for the monorepo. It is paired with the machine-generated `ARCHITECTURE_MAP.json` and the executable `scripts/verify-architecture-boundaries.js` gate.

## Layer model

**Interfaces/apps** (`apps/*`) consume the server/API contracts and must not import server internals directly.

**Services** (`services/*`) own transport, orchestration, jobs, and integration boundaries. Services may depend on domain/math/security packages, but not on browser application code.

**Domain packages** (`packages/domain`, `packages/core`, `packages/enterprise-kernel`, etc.) own business state, policies, and truth boundaries. They remain independent of browser or service bootstrapping concerns.

**Scientific/engineering packages** (`packages/engineering`, `packages/ftth-measurements`, `packages/scientific-validity`, `packages/formal-verification`) are pure deterministic computation surfaces. They must not acquire database/network/application dependencies merely to optimize a call site.

**Infrastructure/adapters** (`packages/adapters`, `packages/db`, `packages/security*`, observability and southbound contracts) isolate external effects.

## New compute boundary

`packages/compute-kernel` is the execution boundary for parallel deterministic workloads. It uses Node `worker_threads` today and deliberately does not expose a JavaScript-specific business API. This allows a future WASM/native backend to replace the execution engine without changing engineering-domain contracts.

`packages/engineering/src/computeKernel.js` is the engineering-facing adapter. It exposes parallel link-budget and path-solver batch execution while preserving result order and propagating worker failures.

This is a mitigation for high CPU concurrency, not a claim that JavaScript has the same single-core performance as Rust/C++.

## Maintenance rules

1. Business logic belongs in the smallest appropriate package.
2. Cross-package dependencies should follow the layer model and are gate-checked.
3. Browser UI must consume explicit API/data contracts rather than import service internals.
4. Scientific functions remain deterministic and side-effect free.
5. High-volume scientific jobs use the compute-kernel boundary rather than spawning ad-hoc workers in individual modules.
6. Generated maps and manifests must be regenerated instead of hand-editing derived state.
