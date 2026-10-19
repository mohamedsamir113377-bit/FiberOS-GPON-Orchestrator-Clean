# Migration 188 — Tenant/Actor Contract Analysis (non-production)

**Branch:** `audit/pre-ci-static-clean-2026-10-16`  
**Date:** 2026-10-16  
**Scope:** Design analysis only. No production migration. No trigger attachment.

## 1. What 188 implements

- Table `enterprise_change_log` (append-only, FORCE RLS).
- RLS policy `ecl_tenant`: `tenant_id = current_setting('app.tenant_id', true)`.
- Hash chain via `ecl_chain()` using advisory lock per tenant string.
- Capture helper `ecl_capture()` reading `tenant_id` from row JSON (OLD/NEW).
- Verify helper `ecl_verify_chain()` walks rows ordered by global `seq`.
- **No production table triggers are created** — comments only show how to attach `ecl_capture`.

## 2. Defects / design gaps (evidence-based)

| ID | Issue | Location | Risk |
|----|--------|----------|------|
| E1 | RLS trusts GUC `app.tenant_id` which any `SET` capable role might influence if not locked down | policy lines USING/WITH CHECK | Tenant spoof / cross-tenant read of log |
| E2 | API session (`packages/db/src/session.js`) sets JWT claims + `SET LOCAL ROLE fiberos_app` but **never** sets `app.tenant_id` | session.js ~17–26 | ECL RLS sees NULL/empty tenant under API path |
| E3 | Worker (`services/worker/src/worker.js`) only `SET LOCAL ROLE fiberos_worker` — **no** tenant GUC | worker.js ~withWorkerTransaction | Same as E2 for worker path |
| E4 | `actor` column defaults to `current_user` but is **excluded** from `row_hash` input | `ecl_chain()` | Actor tampering not covered by chain |
| E5 | `changed_at::text` in hash is session/DateStyle sensitive | `ecl_chain()` / `ecl_verify_chain()` | Verify false negatives across sessions |
| E6 | `ecl_verify_chain()` uses single `prev` across **all** tenants ordered by global `seq` while writer chains **per tenant** | verify vs chain | False integrity failures in multi-tenant data |
| E7 | No triggers on business tables | migration body | Feature inert until explicit attach + contract |

## 3. Required contract before any forward migration / triggers

1. **Tenant authority source (mandatory):**  
   Trusted membership resolver already used by FiberOS (`fiberos_current_tenant_id()` / JWT `sub` + membership), **not** client-supplied `app.tenant_id` alone.

2. **Session binding (API):** After JWT claim injection and `SET LOCAL ROLE fiberos_app`, set a **server-only** tenant context derived from membership (prefer function-owned setting or `SET LOCAL` of a restricted GUC that application roles cannot override arbitrarily). Document privilege: who can `SET` the GUC.

3. **Worker binding:** For each job row, bind tenant from the **row’s tenant_id** inside a SECURITY DEFINER or constrained path; never from request body.

4. **Hash canonicalization (v1 proposal):**  
   UTF-8, field separators that cannot appear unescaped, include `actor`, use `to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` or equivalent fixed format, per-tenant chain with verify matching writer.

5. **Verify semantics:** Filter `WHERE tenant_id = current_trusted_tenant()` or loop per tenant; never one global prev across tenants.

6. **Trigger allowlist:** Explicit table list + PK column; reject tables without non-null `tenant_id`.

## 4. Acceptance tests (non-production DB only)

- Two tenants A/B: writer as A cannot read B’s log rows under FORCE RLS.  
- Attempt `SET app.tenant_id` to foreign tenant as `fiberos_app` must not grant access (or setting must be impossible).  
- Hash verify returns NULL on intact per-tenant chain; detects bit-flip on `actor` once actor is in the hash.  
- Concurrent inserts same tenant serialize via advisory lock (no fork).  
- API and worker paths both produce log rows with correct tenant without client GUC trust.

## 5. Explicit non-actions

- Do **not** rewrite applied 188 on production in place.  
- Do **not** attach triggers until tests above pass on a disposable database.  
- Forward-only corrective migration (e.g. 190+) after design sign-off.

## 6. Relation to current production

Production ledger was observed at **189** in prior live checks (includes applied 188 SQL). Any corrective work must assume 188 may already exist in target environments and must be **forward** fixed.

---

## 7. تحليل تفصيلي إضافي — ربط بالكود الحي

### 7.1 مسار API (`packages/db/src/session.js`)

`applyPrincipal()` يقوم بالترتيب بـ:
1. `set_config('request.jwt.claim.sub', …)`
2. `set_config('request.jwt.claim.role', 'authenticated')`
3. `set_config('request.jwt.claims', JSON)`
4. `SET LOCAL ROLE fiberos_app`

**لا يوجد** استدعاء لـ `set_config('app.tenant_id', …)` ولا استدعاء لـ `fiberos_current_tenant_id()` لتخزين الناتج في GUC.

النتيجة: سياسة `ecl_tenant` التي تعتمد `current_setting('app.tenant_id', true)` لا ترى مستأجر API الموثوق تلقائيًا.

### 7.2 مسار Worker

`withWorkerTransaction` → `SET LOCAL ROLE fiberos_worker` فقط.  
استعلامات التقارير تمرّر `tenant_id` كمعامل SQL من صف الجدول، لكن **لا** تضبط GUC لـ ECL. أي `INSERT` لاحق في `enterprise_change_log` من trigger سيعتمد على GUC أو على `ecl_capture` من عمود الصف (الالتقاط من الصف أفضل من GUC — لكن RLS على القراءة ما زال GUC).

### 7.3 مصفوفة تهديد مختصرة

| تهديد | مسار | تخفيف مطلوب |
|-------|------|-------------|
| قراءة سجل مستأجر آخر | ضبط `app.tenant_id` يدويًا إن كان الدور يملك SET | منع SET من أدوار التطبيق أو تجاهل GUC لصالح `fiberos_current_tenant_id()` |
| سلسلة hash متشعبة | كتابتان متزامنتان | advisory lock موجود — أبقِه مع اختبار تزامن |
| إنكار تعديل actor | actor خارج hash | إدراج actor في canonical v1 |
| verify كاذب | E6 global prev | verify per-tenant |

### 7.4 مسار التصحيح الأمامي المقترح (بعد الاختبار غير الإنتاجي)

1. جلسة API: بعد `applyPrincipal`، اشتق tenant من العضوية واضبط سياقًا **لا** يقرأه العميل كسلطة.  
2. Migration أمامية (رقم جديد > 189): استبدال سياسة ECL لتستخدم نفس دالة المستأجر الموثوقة؛ إصلاح `ecl_verify_chain` per-tenant؛ توسيع hash.  
3. لا `ALTER` صامت لتاريخ 188 على قواعد سبق تطبيقها.

### 7.5 مرجع الاختبار

`sql/tests/m188_e1_e6_nonprod_tests.sql` — يعمل داخل معاملة وينتهي بـ `ROLLBACK`.
