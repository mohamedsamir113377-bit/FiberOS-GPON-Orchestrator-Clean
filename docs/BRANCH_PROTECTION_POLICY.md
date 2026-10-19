# Branch protection policy — main

## Intent

`main` is the sole integration branch for shippable source. Feature, review, and fix work must land via pull request after green checks on the **exact PR head SHA**.

## Required checks (when platform allows)

- verify
- release-admission
- website-build
- truth-check
- i18n-gate
- runtime-postgres-rls
- runtime-container-security
- release-security-gate

Settings: require PR, no force-push, no branch deletion, dismiss stale reviews.

## Platform limitation (2026-10-17)

Repository `mohamedsamir113377-bit/GPON-Orchestrator` is **private** on a plan that returns HTTP 403 for:

- Classic branch protection API
- Repository rulesets API

Message: *Upgrade to GitHub Pro or make this repository public to enable this feature.*

Until Pro or public:

1. Do not force-push `main`
2. Merge only via PR with green checks on the PR SHA
3. Keep fix/review work on `fix/*`, `review/*`, `cleanup/*` branches
4. Re-apply API protection immediately after plan upgrade

## Token hygiene

Rotate any GitHub / Vercel / Neon tokens that appeared in chat. Prefer fine-scoped PATs and Vercel/Neon secrets in Actions only.
