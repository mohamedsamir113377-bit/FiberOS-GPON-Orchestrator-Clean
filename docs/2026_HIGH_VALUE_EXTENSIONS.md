# 2026 High-Value Extensions — FiberOS R14.1 Sales Core
**Updated:** 2026-09-17 (execution of residual-fault closure + package re-delivery)  
**Baseline version:** 1.0.0-alpha.88.1-sales.1+h5-dn-2026-09-17  
**Truth rule:** Only capabilities that exist in source, are deterministic or fail-closed, and are honestly scoped are listed. No autonomous agents, no fabricated predictions, no road-network ETA.

## Priority Tier — Enterprise Hardening & Domain Neutrality (this batch)

### DN-01 — Domain-Neutrality Gate (Multi-Buyer Mode)
- **What exists after this batch:** Explicit gate (`packages/assurance/src/domain-neutrality-gate.js`) that can be run statically or at build/sales-surface generation time.  
- **Forbidden terms (when multi-buyer / domain-neutral mode selected):** FTTH, GPON, OLT, ONT, OTDR, PON, splitter (and common variants).  
- **Truth boundary:** FTTH/optical source code remains in the tree for sector buyers; it is not deleted. The gate prevents those terms from appearing as core multi-buyer claims.  
- **Environment-dependent validation:** Buyer must choose mode (FTTH profile vs general multi-buyer). Default sales positioning prefers domain-neutral language.  
- **Status:** Implemented in this batch.

### H5-01 — JWT Claims vs Tenant Isolation Separation (Truth-Bound Closure)
- **What exists:** Strengthened documentation and module header in `packages/security/src/buildJwtClaims.js` that makes the separation un-ambiguous.  
- **Truth boundary:** `org_id` / `nation_iso` / `employee_id` / `role_key` are **not** the enforced tenant isolation boundary. Only `tenant_id` via `user_preferences` + RLS is enforced. No mapping table invented.  
- **Why this is high-value:** Prevents future silent security bugs where a developer assumes the two models are equivalent.  
- **Status:** Closed by explicit decision + documentation (no schema invention).

## Existing HV Catalog (unchanged reference)

HV-01 Structured Visual Evidence + Quality Gate  
HV-02 Asset Installed-Base Condition Ledger  
HV-03 Skills & Certification Eligibility Matrix  
HV-04 Bounded Offline Decision Support Pack  
HV-05 Explainable Dispatch Suggestion Layer  
HV-06 Customer Self-Service Constraint Booking  
HV-07 Labor + Parts Cost Attribution to Risk/Brief  

(See previous session docs and feature-specs for detailed acceptance criteria. None of the above were altered by this residual-fault batch.)

## Domain-Neutrality Gate Behaviour (summary)

When `FIBEROS_DOMAIN_MODE=multi-buyer` (or domain-neutral / general):
- Forbidden terms are detected and reported by the gate.
- Sales/UI/capability surfaces should stay clean of those terms.

FTTH-specific routes (`/v1/ftth-advisory/*`), `ftthRates.js`, optical migrations stay available under an explicit sector profile flag.

## Non-claims retained

- No autonomous dispatch or self-healing.  
- No live multi-tenant certification shipped.  
- No universal OTDR field extraction without buyer-supplied vendor resolver.  
- Geometric pre-check trigger remains DISABLED until buyer enables.  
- Rate-limit Redis backend still not implemented (PROCESS_LOCAL only; REDIS throws).

---
*All extensions remain source-kit, offline-first compatible, tenant-isolated, and fail-closed for external providers.*
