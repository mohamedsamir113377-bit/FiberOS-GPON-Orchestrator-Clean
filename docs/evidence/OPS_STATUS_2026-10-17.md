# Ops status 2026-10-17 (executed)

## Done via API

| Step | Result |
|------|--------|
| Vercel deploy production | READY `dpl_APYHGTbjX6a2fDYB8xaYFHDHgVjW` |
| Deploy SHA | `b9bfb454439b32d20a6fbb7cf2c08ac0cf5ed8a9` (= `main` at deploy time) |
| Alias | `gpon-orchestrator.vercel.app` |
| Neon production | ledger **189** · ECL rows **0** · **no DDL applied** |
| Branch protection API | **403** private free plan |

## Blocked without human UI

1. **Vercel GitHub App** not installed for this repo — permanent project Git link cannot be set until the app is installed: https://github.com/apps/vercel on `mohamedsamir113377-bit/GPON-Orchestrator`.
2. **GitHub branch protection / rulesets** — require Pro or public repo.
3. **Token rotation** — owner must revoke chat-exposed tokens in GitHub / Vercel / Neon consoles.

## Safe operating rule

`main` is source of truth. Neon ECL/190 remains HOLD. Auto-deploy works only after Vercel GitHub App + project Git link.
