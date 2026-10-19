# Buyer Acceptance Results Template

**Environment:** _______________________  
**Migration head:** _______________________ (expect through 084)  
**Archive SHA-256:** _______________________  
**Tester:** _______________________  
**Date:** _______________________

## Results

| Check | Result (PASS/FAIL/N/A) | Notes |
|-------|------------------------|-------|
| Migrations applied without error | | |
| cross-tenant-smoke: Tenant A cannot see Tenant B tickets | | |
| Direct INSERT on hash_ledger as app role denied | | |
| Ticket status change without lifecycle authority denied | | |
| Ledger append without secret returns LEDGER_SECRET_MISSING | | |
| `/v1/ftth-advisory/otdr-standards` returns SR-4731 note | | |
| OTDR process without vendor → fieldsParsed false | | |
| Exception board returns only tickets with reasons | | |
| Geometric function exists; trigger DISABLED until review | | |
| Production hold still blocks unverified production claim | | |

## Sign-off
Buyer acknowledges: live isolation and production readiness are **not** certified by the vendor archive alone.

Signature: _________________ Date: _________

---
*Template 2026-09-17*
