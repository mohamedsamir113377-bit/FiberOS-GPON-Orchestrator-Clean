# FiberOS R14.1 — تقرير معالجة فجوات الجاهزية الإنتاجية

**التاريخ:** 2026-09-27

## الحكم

تمت معالجة الفجوات البرمجية وبيئة الاختبار القابلة للتنفيذ. أصبحت الحزمة **Core Release Candidate** على مستوى runtime contract، وليست النظام الكامل المعروض في HTML reference. لا يمكن إصدار `Production Approved` قبل تشغيل probes التكاملات الخارجية في بيئة المشتري بأسرار ومزودات حقيقية.

## ما تم إغلاقه فعليًا

| البند | الإثبات |
|---|---|
| Node | Node 24.21.0، والاختبارات الحالية 219/220 PASS، صفر فشل واختبار واحد skipped |
| npm | npm 11.19.0، أعلى من الحد 10.9.2 |
| PostgreSQL | PostgreSQL 18.6 فعليًا على cluster مستقل/5433 |
| PostGIS | PostGIS 3.6.4 فعليًا، `postgis_full_version()` ناجح |
| migrations | 114/114 في قاعدة اختبار جديدة عبر `fiberos_migrator` و`fiberos_owner` |
| RLS/authority | adversarial suite ناجح على PostgreSQL 18/PostGIS 3.6.4 |
| backup/restore | تجربة سابقة ناجحة لقاعدة كانت تحتوي 111 migration؛ لم تُعَد تجربة الاستعادة بعد migrations 113-114، لذلك لا تُعد دليل قبول حاليًا |
| TLS DB | PostgreSQL SSL مفعّل، والاتصال الإنتاجي يطلب التحقق؛ شهادة الساندبوكس snakeoil وليست PKI إنتاجية |
| manifest | parity ناجح للحزمة الحالية؛ راجع بيان الإصدار وسجل الإقفال الحالي للعدد الدقيق |
| dependency audit | `npm audit --audit-level=high`: صفر ثغرات عالية أو حرجة في الفحص الحالي |
| telemetry/supply chain | أزيل auto-instrumentations bundle الواسع؛ بقي تتبع HTTP وPostgreSQL صريحًا فقط، وجرى تحديث SBOM |

## الإصلاحات البرمجية المضافة

1. `scripts/production-readiness-gate.js`
   - يتحقق من Node/npm وPostgreSQL/PostGIS الفعليين.
   - يرفض inline database credentials في الإنتاج.
   - يفرض TLS و`rejectUnauthorized`.
   - يفرض OIDC/JWKS live probe input.
   - يفرض proof files للنسخ الاحتياطي، health/alerts، والتكاملات الخارجية.
   - يرفض Redis rate limiting ما لم يكن backend shared حقيقيًا مثبتًا، ويشترط ملف `FIBEROS_REDIS_HA_PROOF_FILE` بحقوق `managedHighAvailability=true` و`automaticFailoverConfigured=true` و`failoverTested=true` وتاريخ `failoverTestedAt` ضمن آخر 180 يومًا؛ نجاح PING وحده لا يكفي. المثال المرفق قيمه `false` عمدًا.
   - Redis failure يؤدي عمدًا إلى HTTP 503 للمسارات المحددة بالمحدد، بما فيها health عبر edge limiter؛ يلزم endpoint مُدار عالي التوافر مع مراقبة وfailover مجرّب قبل الإنتاج.
2. `scripts/health-check.js`
   - يختبر API وAI وGIS اختياريًا.
   - timeout bounded.
   - يفشل إذا فشلت أي خدمة معلنة.
3. `docs/runbooks/PRODUCTION_ACCEPTANCE_RUNBOOK_2026-09-27.md`
   - خطوات OIDC/JWKS، object storage، KMS/secret manager، NMS/OTDR، webhooks، messaging، TLS، backup/restore، load/stress/soak، وmigration rehearsal.
4. `config/external-adapters-proof.example.json`
   - نموذج proof fail-closed لا يحتوي أسرارًا.
5. `package.json`
   - إضافة `npm run verify:production-readiness`.

## ما لا يمكن إثباته من الساندبوكس

هذه ليست عيوبًا مخفية في الكود، بل أدلة تتطلب ملكية وتشغيلًا خارجيًا:

- OIDC/JWKS للمشتري مع bearer حقيقي.
- Object Storage حقيقي مع encryption وtenant prefix.
- KMS/HSM أو Secret Manager حقيقي مع rotation.
- NMS/OTDR vendor endpoint حقيقي.
- webhook provider حقيقي مع replay/rotation.
- email/SMS provider أو sandbox حقيقي.
- reverse proxy بشهادة PKI إنتاجية.
- load/stress/24h soak على dataset وحركة مرور production-like.
- alert routing وon-call وRPO/RTO في منصة النشر.
- مزود Redis عالي التوافر واختبار failover فعلي مملوك للعميل؛ لم تُجرَ تجربة failover على مزود خارجي في الساندبوكس.
- Redis في مسار الطلبات اعتماد تشغيلي مهم: عند تعطله ترجع الطلبات المحددة بما فيها `/health` حالة 503 عمدًا؛ لا يمر فحص الجاهزية مع backend=REDIS دون `FIBEROS_REDIS_HA_PROOF_FILE` حديث (180 يومًا كحد أقصى). البوابة تتحقق من حقول attestation وتاريخها، لكنها لا تتصل بلوحة مزود Redis ولا تنفذ failover بنفسها؛ يجب أن يكون الإثبات ناتجًا عن اختبار حقيقي مملوك للعميل.

بوابة الجاهزية **تفشل عمدًا** إذا غابت هذه الأدلة؛ لم يتم إنشاء attestation مزورة.

## أوامر القبول النهائي في بيئة المشتري

```bash
export PATH=/opt/node-v24.21.0/bin:$PATH
node --version
psql --version
npm ci --omit=dev --engine-strict
npm run verify
npm run verify:production-readiness
```

يجب أن تكون proof files ناتجة عن probes حقيقية، وأن تكون attestation buyer-owned وحديثة ومرتبطة بـdeployment ID. لا يُسمح برفع `PRODUCTION_HOLD=false` بمجرد نجاح الاختبارات المحلية.

## النتيجة النهائية

- **الكود والمخطط والـruntime contract:** تمت معالجتها والتحقق منها.
- **قاعدة البيانات المطابقة للعقد:** تمت معالجتها والتحقق منها فعليًا.
- **التكاملات الخارجية وبيئة الإنتاج المملوكة للمشتري:** أصبحت لها بوابات تنفيذية fail-closed، لكنها لا تُغلق دون endpoints وأسرار وتشغيل فعلي من المشتري.


## Addendum — 2026-09-28

The Redis HA statements above describe the 2026-09-27 implementation and remain historical. The current gate no longer accepts those operator-written booleans alone: it requires an Ed25519-signed `fiberos.redis-ha-proof.v1` payload, verifies it against a separately supplied public key and pinned key ID, and performs a live `ROLE` probe against the configured Redis endpoint. The probe requires a primary with at least one connected replica. The example proof is intentionally invalid and cannot satisfy production admission. This change still does not cause the sandbox to execute a provider failover; actual provider failover evidence and production trust-key custody remain operator-owned external prerequisites.
