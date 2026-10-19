# FiberOS R14.1 — Production Acceptance Runbook

هذا الملف يحول شروط الإطلاق إلى أدلة قابلة للتحقق. لا يجوز إنشاء attestation بنجاح يدويًا؛ يجب أن تكون كل الأدلة من البيئة المنشورة نفسها.

## 1. Runtime exact versions

```bash
node --version       # >= 24.21.0
npm --version        # >= 10.9.2
psql --version       # PostgreSQL 18.x
psql "$DATABASE_URL" -Atc "select postgis_full_version();"  # PostGIS >= 3.6
npm run verify:production-readiness
```

صورة التشغيل مثبتة أصلًا على `node:24.21.0-bookworm-slim` و`postgis/postgis:18-3.6`. يجب أن يطابق الخادم الفعلي هذين العقدين، لا نسخة الاختبار المحلية.

## 2. Required live integrations

لا تعتبر التكاملات جاهزة بوجود متغيرات فقط. أنشئ `FIBEROS_EXTERNAL_ADAPTERS_PROOF_FILE` من بيئة النشر بعد تشغيل probes فعلية، وبالحقول:

```json
{
  "oidcJwks": true,
  "objectStorage": true,
  "kmsOrSecretManager": true,
  "nmsOtdr": true,
  "webhooks": true,
  "messaging": true
}
```

- OIDC/JWKS: استخدم `scripts/buyer-acceptance/live-oidc-jwks.js` مع bearer حقيقي قصير العمر.
- Object Storage: ارفع ثم اقرأ ثم احذف كائنًا اختبارياً، وتحقق من encryption وtenant prefix.
- KMS/Secret Manager: اقرأ secret reference غير قابل للتسجيل، نفذ signing/envelope decrypt ثم راجع rotation.
- NMS/OTDR: نفذ read-only probe حقيقي، وتحقق من timeout، retry، provenance، وعدم قبول بيانات العميل كـattestation.
- Webhooks: أرسل event اختبارياً مع HMAC/nonce/timestamp وتحقق من replay rejection.
- Messaging: نفذ رسالة اختبارية إلى sandbox/provider test endpoint فقط وتحقق من outbox retry/idempotency.

## 3. TLS and secrets

- `PG_SSL=true` و`PG_SSL_REJECT_UNAUTHORIZED=true`.
- شهادة PKI حقيقية مع SAN مطابق لكل hostname؛ لا تستخدم snakeoil.
- أسرار قاعدة البيانات من Docker/Kubernetes/Secret Manager file، لا من inline environment.
- `REVERSE_PROXY_TLS=true` مع اختبار TLS 1.2/1.3، شهادات منتهية، وhostname خاطئ.
- راجع logs للتأكد من عدم ظهور كلمات المرور أو tokens أو connection strings.

## 4. Backup and restore

نفّذ على نسخة production-like:

1. `pg_dump`/snapshot مشفر.
2. restore إلى قاعدة منفصلة.
3. تطبيق integrity checks و`verify-migration-history`.
4. تشغيل RLS adversarial suite على النسخة المستعادة.
5. قياس RPO/RTO الفعلي.

أنشئ `FIBEROS_BACKUP_RESTORE_PROOF_FILE` فقط بعد نجاح الحقول `backupCreated`, `restoreVerified`, `integrityVerified`.

## 5. Load, stress, soak

نفّذ على production-like dataset:

- load: معدل الطلب المتوقع + 2x لمدة 30 دقيقة.
- stress: زيادة تدريجية حتى 5x أو أول SLO breach.
- soak: 24 ساعة على معدل ثابت مع worker/outbox/retry.
- تحقق من p95/p99، pool saturation، deadlocks، queue age، memory، CPU، وerror budget.

لا تقبل نتيجة بلا metrics محفوظة وalert firing/recovery evidence.

## 6. Migration and rollback

- استنسخ snapshot.
- شغّل `scripts/migrate.js` عبر `MIGRATOR_DATABASE_URL` فقط.
- تحقق من 111 migration وhash history.
- لا تستخدم rollback destructive؛ استخدم forward-fix migration موثقة.
- اختبر restart أثناء migration وretry بعد انقطاع الاتصال.

## 7. Admission

```bash
NODE_ENV=production npm run verify:production-readiness
```

النجاح لا يكفي وحده لرفع الحجز؛ يجب أن تكون attestation الموقعة buyer-owned، حديثة، مرتبطة بـdeployment ID، وكل proof files موجودة وقابلة للمراجعة.
