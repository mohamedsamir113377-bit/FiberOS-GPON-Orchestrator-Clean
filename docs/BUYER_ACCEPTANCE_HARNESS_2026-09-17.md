# Buyer Acceptance Harness — FiberOS R14.1 Sales Core

**Purpose:** Give the buyer a concrete, fail-closed checklist and scripts to verify live controls.  
**Authority:** Source kit only. Passing these checks is **buyer-attested**, not a vendor certification.

## 1. Preconditions
- PostgreSQL + PostGIS matching the migration target line
- Migrations `001`–`089` applied (see `PRODUCTION_MIGRATIONS.txt`)
- `LEDGER_SECRET_KEY` set only in the buyer’s secret store
- OIDC/JWKS configured if identity is required in production
- `PRODUCTION_HOLD` behaviour understood (hold active until buyer attestation)

## 2. Cross-tenant isolation (mandatory)
Run as two distinct tenant principals against the same database:

| Check | Expected |
|-------|----------|
| SELECT tickets / network_assets / optical_measurements as Tenant A | Only Tenant A rows |
| Attempt SELECT of Tenant B id while connected as Tenant A | Zero rows or policy deny |
| INSERT into protected evidence/ledger tables as `authenticated` / app role | Denied (REVOKE from 069) |
| Ticket status UPDATE without lifecycle GUC | `TICKET_STATUS_CHANGE_REQUIRES_LIFECYCLE_AUTHORITY` |

Script sketch (buyer runs with their connection strings):

```bash
# scripts/buyer-acceptance/cross-tenant-smoke.sh
# Requires: DATABASE_URL_A, DATABASE_URL_B, two seeded tenant UUIDs
psql "$DATABASE_URL_A" -c "SELECT count(*) FROM tickets;"   # baseline
psql "$DATABASE_URL_A" -c "SELECT count(*) FROM tickets WHERE tenant_id = '<tenant_b_uuid>';"
# Expect 0 under RLS
```

## 3. Operational control checklist
- [ ] `fiberos_assess_path_plausibility` exists after migration 084
- [ ] Trigger `trg_cable_segment_plausibility` exists and is **DISABLED** until thresholds reviewed
- [ ] `POST /v1/ftth-advisory/otdr-standards` returns SR-4731 note and empty vendor list (until resolver registered)
- [ ] `POST /v1/engineering/diagnosis` requires verified principal
- [ ] Hash ledger append returns `LEDGER_SECRET_MISSING` when secret unset (fail-closed)
- [ ] Production hold still blocks “production ready” without buyer attestation flags
- [ ] Application runtime gate reports `VERIFIED_RUNTIME` after the production migration chain completes (including migration 090)

## 4. Optical / engineering advisory
- [ ] Link budget compare returns `CALCULATED_NOT_MEASURED` on calculated side
- [ ] Calibrated diagnosis returns `advisory: true`
- [ ] OTDR process without registered vendor returns `fieldsParsed: false`

## 5. Sign-off
Buyer records: environment, migration head SHA, date, tester identity.  
This harness does **not** replace formal penetration tests or SLSA claims.

---
*Harness version 2026-09-17 — bound to session hardened package.*
