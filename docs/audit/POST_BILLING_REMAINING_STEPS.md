# ما تبقّى بعد رفع حد الدفع — قائمة تنفيذية

**الفرع فقط:** `audit/pre-ci-static-clean-2026-10-16`  
**HOLD:** لا دمج إلى `main`، لا tag إصدار، لا ترحيل إنتاجي حتى خضرة البوابات وموافقة صريحة.

## 0) رفع حد الدفع (GitHub Actions)

1. ادخل: GitHub → صورة الحساب → **Settings** → **Billing** → **Plans and usage** (أو المنظمة إن كان المستودع تحت org).
2. راقب: **Actions minutes** / **Included minutes** / **Spending limit**.
3. إن وُجد **Spending limit = $0** أو توقف عند الحد: ارفع **Actions spending limit** أو أضف وسيلة دفع وحد إنفاق > 0.
4. للمستودعات الخاصة: الدقائق المدفوعة تُحسب بعد نفاذ الحصة المجانية (حسب خطة الحساب/المنظمة).
5. بعد التعديل انتظر دقائق، ثم شغّل workflow **`ci-runner-probe`** على فرع المراجعة.
6. **قبول:** وظيفة Probe تظهر `steps > 0` و`runner_name` غير فارغ وconclusion = success.

مرجع مساعدة: GitHub Docs → *Managing your spending limit for GitHub Actions*.

## 1) على جهاز التطوير (بعد الدفع)

```bash
git fetch origin
git checkout audit/pre-ci-static-clean-2026-10-16
git pull
npm ci
npm ls net-snmp --all    # يجب 3.29.2
npx @cyclonedx/cyclonedx-npm@4.2.1 --output-file SBOM.cdx.json --validate
# تأكد أن SBOM يحتوي net-snmp وأن version=3.29.2
git add SBOM.cdx.json package-lock.json packages/adapters/package.json
git commit -m "chore(sbom): regenerate CycloneDX with net-snmp 3.29.2"
git push origin audit/pre-ci-static-clean-2026-10-16
```

## 2) اختبارات عقد 188 (غير إنتاجي)

- استخدم DB قابلة للحذف (Docker PostgreSQL 18 + PostGIS إن لزم).
- طبّق الترحيلات حتى 188 على تلك القاعدة فقط.
- شغّل: `sql/tests/m188_e1_e6_nonprod_tests.sql` (يُنهى بـ ROLLBACK).
- سجّل NOTICE/EXCEPTION لكل من E1–E6.

## 3) بوابات الإصدار على SHA واحد

بعد Probe أخضر على نفس الـSHA:

1. `release-admission`
2. `truth-check` (إن وُجد على الفرع)
3. `website-build`
4. `visual-regression`
5. كل jobs التابعة (verify, postgres-rls, containers, source-hygiene)

**قبول:** كلها success على **نفس** `github.sha` مع logs محفوظة.

## 4) PR → main

فقط بعد (3). مراجعة بشرية للـdiff. لا force-push على main.

## 5) خارج النطاق حتى إشعار آخر

- ترحيلات Neon production
- tag إصدار تجاري
- إعلان READY للمشتري
