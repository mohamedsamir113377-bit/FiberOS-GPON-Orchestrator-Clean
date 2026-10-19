# Neon production HOLD — ECL / Migration 190

**Checked:** 2026-10-17 (read-only)

| Item | Value |
|------|--------|
| Project | FiberOS `fragrant-voice-83289037` |
| Branch | production `br-tiny-cherry-b4x1vpkw` |
| Migration ledger max | `189_tenants_update_membership_scope.sql` (count 189) |
| `enterprise_change_log` rows | 0 |
| Operational `t_ecl_*` triggers | 0 |

## HOLD rules

1. Do **not** apply migration 190 or rewrite 188/189 on production until non-prod multi-tenant adversarial tests pass.
2. Do **not** attach ECL capture triggers to business tables without signed design decision.
3. Production remains schema-capable through 189; ECL trail is **not** operationally complete.

## Allowed

- Read-only verification
- Disposable branch tests (Neon child branches)
- Forward-only migrations after review on a non-primary branch
