# REQUIRED ADDITIONS STATEMENT — FiberOS R14.1 Sales Core
**Date:** 2026-09-17  
**Trigger:** User directive "execute all recommendations" + "execute the recommendations and resend the package"  
**Package baseline:** 1.0.0-alpha.88.1-sales.1+h5-dn-2026-09-17 (FINAL-CLEAN)  
**Positioning:** Source kit · truth-bound · multi-buyer preferred · domain-neutral mode preferred.

## Scope of this batch (truth boundary)

This statement records exactly what is being added or closed in the current incremental release. Nothing outside this list is claimed as complete.

### 1. H-5 Architectural Gap Closure (Truth-Bound Decision)

**Finding (from AUDIT_FIXES_2026-09-17.md H-5):**  
JWT claims model (`org_id` / `nation_iso` / `employee_id` / `role_key` produced by `packages/security/src/buildJwtClaims.js`) is not the same identifier space as the enforced RLS tenant model (`tenant_id` via `fiberos_current_tenant_id()` → `user_preferences.tenant_id` keyed by `auth.uid()`). No `organizations` table exists in any migration.

**Decision (explicit, no invention):**  
- The JWT claims model remains **advisory / non-enforcing** for tenant isolation.  
- Only `tenant_id` / `user_preferences` + RLS policies are the enforced isolation boundary.  
- `org_id` / `nation_iso` / `employee_id` / `role_key` may be present in tokens for hierarchical visibility helpers or future buyer wiring, but they **must never be treated as a substitute for tenant_id**.  
- Code comments, this statement, ENTERPRISE_HARDENING_INVENTORY, and SALES_HONESTY language are updated to make the separation un-ambiguous.  
- No new tables, no fabricated mapping, no silent equivalence assumption.

**Deliverables:**  
- Strengthened comment + decision in `buildJwtClaims.js`.  
- Inventory row + honesty note.  
- RELEASE_SCOPE note that buyer must decide whether to wire org claims to their own org model later.

### 2. Domain-Neutrality Gate Hardening (Multi-Buyer Mode)

**Finding:** Package still ships FTTH-specific terms, modules (`ftthRates.js`, `packages/ftth-measurements`, migrations with OLT/ONT/SPLITTER/GPON, routes under `/v1/ftth-advisory`, docs titles containing FTTH). Inventory already flagged “Partial — needs explicit gate”.

**Decision (truth-bound):**  
- Introduce / strengthen an explicit `domain-neutrality-gate.js` under `packages/assurance`.  
- Forbidden terms when multi-buyer / domain-neutral mode is selected: FTTH, GPON, OLT, ONT, OTDR, PON, splitter, and obvious variants.  
- Gate is fail-closed for sales-facing strings, UI labels, and capability registry claims when the mode flag is active.  
- FTTH-specific code remains in the source tree (it is real and useful for FTTH buyers) but is documented as **optional / sector profile**, not core multi-buyer capability.  
- No deletion of working optical code; only gating + honest positioning + inventory update.

**Deliverables:**  
- `packages/assurance/src/domain-neutrality-gate.js` with clear forbidden list and mode switch.  
- `scripts/verify-domain-neutrality.js`.  
- Update to ENTERPRISE_HARDENING_INVENTORY.  
- Soft rewrite of sales-facing sentences that over-claim FTTH as the sole purpose.  
- Note in 2026_HIGH_VALUE_EXTENSIONS and RELEASE_SCOPE.

### 3. Supporting Honesty Updates + Manifest

- Extend `docs/2026_HIGH_VALUE_EXTENSIONS.md`.  
- Update inventory.  
- Append execution log.  
- Regenerate / update `SALES_PACKAGE_MANIFEST.json` for this delta (full tree checksums remain seller responsibility on complete archive).  
- Keep production-hold, RLS, outbox, and fail-closed external providers untouched.

## Explicit Non-Goals (rejected)

- Inventing an `organizations` table or automatic org_id ↔ tenant_id mapping.  
- Deleting FTTH/OTDR source (it is real).  
- Claiming the package is now “domain-neutral only”.  
- Auto-dispatch, autonomous agents, road-ETA, or any marketing inflation.  
- Fabricating translations or live certifications.

## Acceptance Criteria for this batch

- [x] REQUIRED_ADDITIONS_STATEMENT.md (this file) exists and is consistent.  
- [x] H-5 decision is visible in code comments + inventory + honesty docs.  
- [x] Domain-neutrality gate exists and can be invoked.  
- [x] No new false claims introduced into sales surfaces.  
- [x] Updated package archive produced for delivery.

---
*Docs before code. Truth boundary first. Incremental release only.*
