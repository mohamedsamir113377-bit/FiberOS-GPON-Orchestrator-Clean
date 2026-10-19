# Repository Health and Branch Topology

> **Historical branch-topology snapshot (2026-10-07).** The branch names and migration tip below describe the intermediate installation-workflow branch at that time; they are not the current release candidate. For current release state, use `FINAL_VERIFICATION_STATUS.md` and the exact commit/ref under review. The current source tree has a declared migration chain `001–177`; hosted/runtime admission remains pending.

**As of:** 2026-10-07  
**Release train tip:** `feature/installation-command-workflows-2026-10-07`  
**Do not treat `main` as the tip of this train.**

## Truth boundary

| Claim | Status |
|-------|--------|
| Source installation P0 batch (evidence, acceptance, tip 126) | Present on feature tip |
| Migration chain | **001–126** (see `sql/migrations/PRODUCTION_MIGRATIONS.txt`) |
| Hosted GitHub Actions | **FAIL** — billing/spending limit; `runner_id=0`; jobs not started (annotation-backed) |
| Live PostgreSQL/PostGIS/RLS adversarial | **NOT PROVEN** in CI |
| Production Ready | **FORBIDDEN** until live gates + assigned runners |

## Canonical path (ordered)

```
main @ 60c297a
  ↑ (DO NOT merge until Final RC after live proof)
fix/security-release-blockers-2026-10-06
  ↑ PR #31
feature/installation-command-workflows-2026-10-07   ← current work tip
```

## Open PRs (policy)

| PR | From → To | Policy |
|----|-----------|--------|
| #31 | feature/installation… → fix/security-release-blockers… | Merge only after runner admission works |
| #27 | fix/security-release-blockers… → main | Merge only after Final release audit |

## Stale / absorbed feature branches (do not develop further)

These were intermediate fix branches; work is merged into the feature tip. Prefer **delete after confirming tip contains commits**:

- `fix/installation-command-workflows-p0-p1-2026-10-07`
- `fix/installation-completion-tracking-p0-2026-10-07`
- `fix/installation-unified-batch-p0-2026-10-07`
- `docs/adversarial-release-path-2026-10-07`

## Parallel lines (not this release train)

| Branch | Role |
|--------|------|
| `i18n/forensic-certification-final-2026-10-06` | Machine-forensic i18n (not human certification) |
| `website/next-gen-command-nexus-2026-10-06` | Website visual train |
| `feat/2050-ops-website-2026-10-06` | Website experiments |
| `feat/visual-depth-motion-and-release-truth` | Visual depth |
| `release/finalization-120` | Historical tip ~120 |
| `chore/fiberos-r14-2-hardening` | Older hardening |
| `fix/tenant-containment-121` | Identical to main tip historically |

## CI classification (proven)

Annotation text from GitHub on SHA `2c98f191…`:

> The job was not started because recent account payments have failed or your spending limit needs to be increased.

Classification: **A — Billing / Spending Limit**  
Not application failure. Not YAML syntax failure for visual job start.

## Local gates (when DB available)

```bash
node scripts/adversarial-release-gate.js   # exit 2 without DATABASE_URL
node --test services/api/test/installationCompletionGate.test.js
```
