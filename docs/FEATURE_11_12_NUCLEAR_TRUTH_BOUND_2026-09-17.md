# Features 11 & 12 — Nuclear / Sovereign Layer (Truth-Bound)

**Date:** 2026-09-17  
**Principle:** Zero illusions. The code that already exists in FiberOS-R14_1 is stronger and more honest than the drafts that were pasted.

---

## Feature 11 — OTDR .SOR Binary Parser

### What the pasted draft claimed
- Full extraction of `lossProfileDistances` + `lossProfileValuesDb` from arbitrary .SOR files.
- Hard-coded byte offsets, scaling factors, and a fixed 0.2 m step.

### What actually exists in the package (and why it is better)

| File | Honest capability |
|------|-------------------|
| `packages/domain/src/sorParser.js` | Real Telcordia SR-4731 / Bellcore **block-boundary scanner**. Finds `GenParams`, `FxdParams`, `KeyEvents` (and can locate `DataPts`). Explicitly sets `fieldsParsed: false` and refuses to invent numeric values. |
| `packages/adapters/src/global/otdrFileAdapter.js` | Adapter that calls the scanner. Field extraction is delegated to a **vendorFieldResolvers** registry. Empty by default. Throws `ERR_VENDOR_LAYOUT_NOT_REGISTERED` until a real vendor layout is supplied. |

**Why the pasted offsets are rejected**
The exact byte layout of FxdParams / DataPts depends on the block’s own revision number and varies by OTDR vendor and firmware. Reading a fixed offset and dividing by a guessed scale produces plausible-looking but **physically false** numbers. That is the exact "ornamentation" the package was designed to eliminate.

**How to make field parsing real (half-day once the layout is known)**
1. Obtain the Telcordia SR-4731 field table **or** the specific vendor’s SDK/spec for the revision in use.
2. Register a resolver:  
   `vendorFieldResolvers['EXFO'] = (scanResult, buffer) => { … real offsets … }`
3. The scanner and adapter stay unchanged; only the resolver is added.

**Frontend question answer**
> “How do you want to link `lossProfileValuesDb` to a radar chart (Chart.js / D3)?”

**Answer:**  
Until a real vendor resolver is registered, **there is no trustworthy `lossProfileValuesDb`**.  
We can only surface the scan metadata (`blockOffsets`, `standard`, `fieldsParsed: false`) in the UI.  
Any Chart.js / D3 plot of invented dB values would be a lie. Once a resolver exists, the same pure array can be fed to either Chart.js (simple line) or D3 (interactive engineering view). Prefer D3 only if the operator needs zoom/brush on long traces; otherwise Chart.js is sufficient and lighter.

---

## Feature 12 — Sensitive Direct-DML Closure (Sovereign Lockdown)

### What the pasted draft claimed
- A new table `ftth_network_topology` with `PROFILE_GEOMETRY`.
- A PL/pgSQL (or pljs) trigger that checks a illustrative GUC `fiberos.sovereign_governance_token === 'EXAMPLE_ONLY_GOVERNANCE_TOKEN_NOT_A_SECRET'`.

### What actually exists (and is stronger)

| File | Honest capability |
|------|-------------------|
| `sql/migrations/069_r8_sensitive_direct_dml_closure_ported.sql` | **REVOKE INSERT/UPDATE/DELETE/TRUNCATE** on the real append-only evidence tables (`audit_log`, `hash_ledger`, `payment_cycle_events`, `rework_case_events`, `material_chain_events`, `telco_webhook_replay_guard`) from `anon`, `authenticated`, `fiberos_app`. Then re-grants **SELECT only** where appropriate. |
| Companion migrations 067–071 | Additional privilege-surface and RLS closures. |
| `packages/enterprise-kernel/src/decisionCertificate.js` | Creates signed decision certificates that require non-simulated evidence. This is the proper governance path, not a session magic string. |

**Why the magic-token trigger is weaker**
- A session GUC can be set by any code that has the right to call `SET`. It is not a cryptographic authority.
- REVOKE at the privilege level is the correct PostgreSQL pattern: the application role simply **cannot** issue the DML. Server-side functions that run as a privileged owner remain the only write path.
- The invented table and `PROFILE_GEOMETRY` type do not exist; PostGIS geometry + the existing network topology migrations already cover the geographic path.

**How authorized writes happen**
1. Application calls a server-side function / service that runs with the necessary owner privileges.
2. That function may call `decisionCertificate.createDecisionCertificate` (requires real evidence).
3. The function then performs the controlled write.
4. Client roles never hold INSERT/UPDATE/DELETE on the protected tables.

**Node.js question answer**
> “Do you want the Node.js code that sets `fiberos.sovereign_governance_token` to legally break the lock?”

**Answer:**  
**No.** That pattern is not used.  
The legal path is:
- Keep the REVOKE.
- Expose only controlled server functions (or service-layer methods) that already run with the correct database role.
- Optionally, those functions can require a valid `decisionCertificate` before writing.

Setting a GUC from Node would be security theatre and is deliberately avoided.

---

## Session stance

- The existing `sorParser.js` + `otdrFileAdapter.js` are already more rigorous than the pasted draft.
- The existing `069_…sql` is already the correct sovereign lockdown.
- No invented numeric OTDR profiles will be returned.
- No magic-token trigger will be added.
- Frontend charting of OTDR data is blocked until a real vendor field resolver is registered.

---
*This document is the nuclear-layer planning gate for features 11 and 12.*
