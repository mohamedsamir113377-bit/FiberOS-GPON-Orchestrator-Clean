# Web Team Productivity Pack 2026 — FiberOS / OpsCore

**Audience:** Dispatcher, Supervisor, Back-office, Web Console operators  
**Goal:** Exception-first operations that reduce time, effort and money while keeping the human in the loop.  
**Baseline:** FiberOS R14.1 Sales Core  
**Updated:** 2026-09-16  
**Rule:** Document → implement → test → checksum. Operator confirmation is mandatory for any state-changing action.

## Principles

- Exception-first: surface only what needs attention.
- Explainable reason codes on every ranking or suggestion.
- No auto-dispatch or auto-remediation.
- Customer notifications remain buyer-keyed via the existing outbox pattern.
- All scores are deterministic functions of persisted records.

## Capability Catalog (W1–W8)

| ID | Capability | Description | Truth boundary | Status |
|----|------------|-------------|----------------|--------|
| W1 | Exception-first board | Board that prioritises open conflicts, stale evidence, high-risk tickets, SLA breaches, missing skills | Pure filter + sort on existing records | Planning |
| W2 | Candidate ranker | Ranked technician list with composite score and ordered reason codes (skills, load, straight-line distance, SLA, parts) | Uses `dispatch.rankCandidates`; operator confirms assignment | Partial (kernel present) |
| W3 | Bulk move / reassign | Select multiple tickets and propose reassignment; still requires confirmation | No silent moves | Planning |
| W4 | Parts readiness overlay | Surface missing-parts penalty and inventory balance on candidates and tickets | Inventory balance is transactional ledger sum only | Planning |
| W5 | Cost overlay | Show already-recorded labour + parts cost on risk / brief / ticket views | Pure aggregation of ledger; no forecasts | Planning (HV-07) |
| W6 | Closure gate | Structured checklist + evidence requirements before close-out; blocks final close on simulated-only evidence | Aligns with evidenceIntegrity + truth-evidence classes | Partial |
| W7 | Customer status push | Push status updates via outbox (buyer-keyed email/SMS/push) | Fail-closed if provider keys missing | Partial (outbox present) |
| W8 | Skills / cert filter | Filter candidates by required skills and non-expired certifications | Pure function; expired cert excludes | Implemented (kernel module + 20 tests 2026-09-16) |

## Implementation Order (recommended)

1. W2 + W8 (already have ranking kernel; add skills filter).
2. W1 (exception board) — highest productivity leverage.
3. W6 (closure gate) — improves First-Time-Right.
4. W5 + W4 (cost + parts).
5. W3, W7.

## Acceptance Criteria (shared)

- Every suggestion carries at least one explicit reason code.
- State-changing actions require operator confirmation.
- Cross-tenant isolation tests pass.
- Offline / sync contracts remain unbroken.
- No new external provider is hard-coded; all remain buyer-keyed and fail-closed.
- After implementation: update REQUIRED_ADDITIONS_STATEMENT, 2026_HIGH_VALUE_EXTENSIONS, this file, SALES_PACKAGE_MANIFEST, and regenerate checksums.

## Mapping to High-Value Features

- W2 ↔ HV-05
- W5 ↔ HV-07
- W6 ↔ HV-01 (visual evidence / quality gate)
- W8 ↔ HV-03

---
*This pack is advisory productivity tooling. It does not introduce autonomous decision authority.*
