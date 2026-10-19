# Commercial Freeze — 2026-10-14

## Decision
Freeze the current FiberNexus-1 source snapshot for controlled pre-sale use. Do not merge feature work into `main`, apply production database migrations, or change the buyer-facing deployment until the first sale and a separately approved verification pass.

## Frozen source reference
- Repository: `codespine78-web/FiberNexus-1`
- Snapshot at freeze start: `ed57d107574bfd2e28f840615b81dccb74ad35e0`
- Freeze branch: `release/commercial-freeze-2026-10-14`
- Payment-plan/run isolation branch: `ops/payment-plan-run-isolation-2026-10-14`

## Evidence boundaries — do not overclaim
- GitHub status for the frozen source reported Vercel success, but this does not independently prove the public URL serves this exact SHA.
- Four GitHub Actions runs on the snapshot were reported failed: website-build (38496182535), truth-check (38496182577), visual-regression (38496182579), and release-admission (38496182512). Their detailed logs were unavailable during this freeze; their causes are not asserted here.
- Production Neon history showed 187 applied migrations; migration 188 (`188_enterprise_time_machine.sql`) was not applied. Do not claim the enterprise change-log/time-machine feature is production-verified.
- Production tables inspected during the audit were empty for tenants, network assets, technicians, tickets, customer accounts, and call sessions. End-to-end acceptance with production data is therefore not established.
- The known earlier Vercel URL `https://fibernexus-1-rnrh6na7d-fiber-os1.vercel.app` was not verified live or tied to the frozen SHA during the audit.

## Release claims allowed
Describe only capabilities that have been individually demonstrated and are supported by current source/evidence. Label advisory, integration-required, vision, and unimplemented items according to `config/html-feature-parity.json`. Do not present a feature-catalog label alone as production acceptance evidence.

## Change control until first sale
1. Keep `main` unchanged for commercial freeze purposes unless an explicit release-blocker fix is approved.
2. Use `ops/payment-plan-run-isolation-2026-10-14` for investigating payment-plan/CI runs; a historical GitHub Actions run cannot be reassigned to another branch. Any rerun must be triggered against the intended branch/commit.
3. Use `release/commercial-freeze-2026-10-14` as the frozen review reference, not as proof that all release gates pass.
4. No production DB migration, secret/config change, forced ref update, or deployment replacement under this freeze.
5. After the first sale, resume with a controlled acceptance plan: identify CI failure causes, test migration 188 and tenant/RLS behavior on an isolated database branch, verify the exact deployed URL/SHA, and collect end-to-end evidence before changing production.

## Status
**FROZEN FOR SCOPE CONTROL — NOT CERTIFIED GREEN / NOT FULLY PRODUCTION-VERIFIED.**

## 2026-10-15 amendment — owner-authorized feature merge
The repository owner explicitly instructed that the eleven capabilities classified `UNIMPLEMENTED`
be implemented and merged to `main`, and that the feature-status document and this commercial
release documentation be updated accordingly. That instruction supersedes, for this change only,
the "do not merge feature work into `main`" clause above.

Scope of the exception: the eleven items `architecture`, `theory-guide`, `ar-scanner`,
`energy-analytics`, `cross-project`, `reputation-index`, `business-weather`, `enterprise-tm`,
`constitution`, `self-improve`, `load-test` — code, unit/API-route tests and registry entries only.
Not in scope and still forbidden without a separate written decision: applying migrations to the
production database (production Neon remains at its observed ledger), changing the buyer-facing
deployment, and any claim of buyer-runtime certification.
