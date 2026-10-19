# FiberOS R14.1 — Product Scope and Capability Status

## Commercially accurate positioning

هذه الحزمة هي **FiberOS Core Release Candidate**: نواة تشغيلية وأمنية وقاعدة بيانات ومهاجرات وواجهات server-backed مثبتة، وليست تنفيذًا كاملًا لكل واجهات HTML المرجعية أو كل وعود العرض التسويقي.

> لا يجوز تسويق الحزمة على أنها النظام الكامل أو أن كل شاشة في HTML reference منفذة.

## Executable capability inventory

المصدر الرسمي هو [`config/html-feature-parity.json`](config/html-feature-parity.json)، والتصنيف محسوب من الأدلة التنفيذية والاختبارات لا من أسماء الشاشات.

> **تحديث 2026-10-15:** هذه الفقرة كانت تذكر 101 عنصرًا و58 غير منفَّذ، وهي أرقام قديمة. الجدول أدناه مطابق للسجل الرسمي بعد تنفيذ الميزات الإحدى عشرة.

| الحالة | العدد | المعنى |
|---|---:|---|
| REAL | 55 | capability لها كود فعلي واختبارات ناجحة على نفس الالتزام |
| INTEGRATION_REQUIRED | 4 | سطح تنفيذي موجود لكنه يحتاج مزودًا/جهازًا خارجيًا |
| ADVISORY | 23 | حساب أو قرار مساعد بلا سلطة تنفيذ ذاتية |
| VISION | 24 | مفهوم/خارطة طريق غير ممثل كقدرة إنتاجية |
| UNIMPLEMENTED | 0 | لا يوجد بند بلا كود واختبار |
| **الإجمالي** | **106** | مطابق للسجل الرسمي |

### الميزات الإحدى عشرة التي كانت UNIMPLEMENTED ونُفِّذت في 2026-10-15

`architecture` · `theory-guide` · `ar-scanner` · `energy-analytics` · `cross-project` · `reputation-index` · `business-weather` · `enterprise-tm` · `constitution` · `self-improve` · `load-test`

لكل واحدة: كود في `services/api/src/capabilities/<id>.cjs`، واختبار وحدة في `services/api/test/capabilities/<id>.test.cjs`، وسطح API معلن `GET /v1/capabilities/<id>` في `services/api/src/routes/capabilities.js`. المجموع 50 اختبار وحدة/API ناجحة، صفر فاشل.

**تحفّظ لازم:** تصنيف REAL هنا يعني «كود + اختبارات على نفس الالتزام». ولا يعني إثبات تشغيل على قاعدة إنتاج Neon أو نشر Vercel لذلك البند بعينه، ولا يشمل مصدر طاقة حقيقي، ولا أجهزة ميدانية، ولا تعريفات مؤشرات السمعة/الطقس من المالك. شروط القسم 12 من تقرير الفجوات تبقى سارية لكل بند على حدة.

## Release boundary

- **Included:** core API/runtime boundaries, security and authorization, RLS-oriented database schema, migrations, evidence contracts, GIS/operations surfaces represented as REAL, engineering calculations where explicitly marked advisory, i18n runtime, and release gates.
- **Not included as implemented product claims:** the 24 VISION capabilities. The former 58-item UNIMPLEMENTED bucket is now 0 for the eleven items delivered on 2026-10-15; the rest were already REAL/ADVISORY/INTEGRATION_REQUIRED.
- **Conditional:** the 3 INTEGRATION_REQUIRED capabilities remain blocked until buyer-owned providers/devices are configured and live probes pass.

## Acceptance rule

`npm run verify` proves repository integrity and tests. It does **not** promote the package to a complete commercial product. `npm run verify:production-readiness` additionally requires buyer-owned live runtime proofs. The production hold remains fail-closed.
