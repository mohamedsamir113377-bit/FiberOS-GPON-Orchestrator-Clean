# FiberOS R14.1 — Hierarchical Permission Remediation

## نطاق التنفيذ

تم تنفيذ المقترح الأمني المتعلق بحدود الفني والمشرف، وليس مجرد توثيقه:

1. **Immutable permission context** في `packages/security/src/permissionContext.js`؛ يبنى من principal موثق وحقائق DB فقط، ويُجمّد عميقًا لمنع تعديل tenant/technician/subordinates أثناء الطلب.
2. **DB-derived technician identity** عبر `user_preferences` و`technicians.user_id`، مع تحميل قائمة `technician_subordinates` من قاعدة البيانات.
3. **Ticket/evidence scope**: الفني لا يقرأ أو يعدّل إلا تذكرة الفني المرتبطة به؛ المشرف يقتصر على subordinate materialization؛ الإدارة تبقى tenant-scoped.
4. **Supervisor dispatch boundary**: نتائج dispatch للمشرف تُرشّح فقط إلى subordinate IDs، ويُعاد فحص المرشح قبل تسجيل dispatch request.
5. **Geo/reality override**: لا يُقبل override إلا مع `approved=true` و`secondFactorVerified=true` وسبب تقني لا يقل عن 20 حرفًا. أي override يكتب إلى `audit_log` عبر `fiberos_audit_append` ثم إلى `hash_ledger`؛ فشل أي سجل يمنع العملية.
6. **Migration 112**: إضافة `org_unit_id`، جدول `technician_subordinates`، تحقق tenant-consistency، `FORCE ROW LEVEL SECURITY`، وسياسات قراءة scope للفني/المشرف، مع منع DML المباشر من أدوار العملاء.

## الاختبارات

- اختبارات السياق والـoverride والـroute contracts: **8/8 PASS**.
- مجموعة المشروع الكاملة بعد الدمج: **183/183 PASS**.
- `npm run verify`: **PASS**.
  - Architecture boundary: PASS
  - Architecture map: PASS، 41 packages و14 مالك حافة غير فارغ
  - JS syntax: PASS
  - Release integrity: PASS بعد تحديث RLS inventory إلى 89 جدولًا و112 migration
  - Capability parity: PASS، 101 capability
  - Manifest parity: PASS، 1041 ملفًا
  - i18n quality: PASS مع 17 تحذير fallback معلن و30 untranslated catalog entries غير مفعلة كـverified

## حدود مهمة

- لم يُدّعَ اختبار OIDC/Redis/KMS/Object Storage/NMS الفعلي هنا؛ هذه تبقى بوابات بنية تحتية منفصلة.
- migration 112 يجب تطبيقها على staging/production rehearsal قبل تفعيل routes الجديدة؛ النسخة القديمة من قاعدة البيانات ستفشل closed بسبب جدول `technician_subordinates` المفقود.
- لا يجوز إرسال `supervisorOverride` من الواجهة كدليل صلاحية؛ الحقول مجرد طلب، والتحقق الحقيقي من principal/context وDB audit.
- وجود override لا يجعل geo/reality evidence موثوقة؛ يسجل استثناءً مدققًا فقط.

## قرار الإصدار

هذه المعالجة ترفع **Core Release Candidate** أمنيًا في مسارات التذاكر والأدلة والإسناد، لكنها لا تغيّر تصنيف الميزات غير المنفذة في `html-feature-parity.json` ولا تحول المنتج الكامل إلى Production Approved دون قبول البنية الخارجية.


## Formal verification integration

أضيفت حزمة `packages/formal-verification` إلى بوابة الإصدار. الشهادة الحالية اجتازت **259 تحققًا محدود المجال** تشمل خصائص الحسابات الضوئية، Weibull، decision boundaries، liveness لرسم حالات منتهٍ، عدم تداخل payload الترجمة مع evaluator الحتمي، عقد HMAC/timing-safe، واحتواء الحساب النقطي داخل interval معلن. كما ارتفع إجمالي اختبارات المشروع إلى **188/188 PASS**.

هذه النتائج لا تُستخدم لإطلاق ادعاء «استحالة الاختراق» أو «تساوي دورات CPU» أو «ضمان ملايين العمليات». حدود البرهان موثقة في `docs/architecture/FORMAL_VERIFICATION_SPECIFICATION_2026-09-27.md`، بينما قيمة المنتج التجارية والحدود غير المثبتة موثقة في `docs/commercial/ARCHITECTURE_AND_VALUE_PROPOSITION_2026-09-27.md`.


## Digital Twin/GIS integration

تمت إضافة `packages/digital-twin-gis/src/twinVerification.js` وربطه بواجهة الحزمة وبوابة formal. العقود الجديدة تتحقق من DAG للطوبولوجيا، optical parity بحد معلن، geometric plausibility، مطابقة evidence fingerprint مع geo/optical evidence، ختم حالة مرتبطًا بالمستأجر والتسلسل، ومحاكاة failure paths حتمية. اختبارات الجولة الجديدة: **11/11 PASS**، وإجمالي المشروع: **194/194 PASS**.

هذه الطبقة لا تستبدل PostGIS أو أجهزة OTDR أو OCR/GPS adapters الحية؛ تفاصيل حدودها موثقة في `docs/architecture/DIGITAL_TWIN_GIS_VERIFICATION_SPECIFICATION_2026-09-27.md`.
