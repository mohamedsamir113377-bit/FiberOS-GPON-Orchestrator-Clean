# FiberOS R14.1 — Digital Twin & GIS Verification Specification

## نطاق التنفيذ

تم دمج طبقة تحقق فوق المكونات الموجودة فعليًا في `digital-twin-gis` و`engineering/twin.js` و`networkResilience.js` و`geometricPlausibility.js` و`realityGate.js`. الهدف هو جعل التوأم الرقمي قابلًا للفحص الحتمي وختم حالته، لا الادعاء بأن snapshot JavaScript أصبح بديلًا عن PostGIS أو أجهزة OTDR.

## العقود المنفذة

### Deterministic topology

`verifyTopologyDag` يتحقق من العقد والحواف، يرفض الحواف المعلقة، ويكشف الدورات في الرسم المعلن. التحديثات الحية الذرية في قاعدة البيانات تبقى مسؤولية transaction/locking وruntime acceptance.

### Optical parity

`validateOpticalParity` يقارن قيمة متوقعة بقياس حي ضمن tolerance يحدده مالك البيانات. القيمة الافتراضية في الاختبارات هي `0.001 dB` كـdeclared engineering bound، وليست ضمان معايرة عالميًا. أي drift خارج الحد يعيد `BLOCKED`.

### Spatial plausibility and reality evidence

`validateSpatialAsset` يعيد استخدام precheck الجغرافي الموجود، بينما `validateRealityEvidence` لا يقبل التوأم إلا عند تطابق fingerprint ومرور geo وoptical evidence. OCR أو GPS وحدهما لا يتحولان إلى حقيقة موثوقة ما لم يصل evidence adapter معتمد ومربوطًا بقاعدة البيانات.

### Twin seal and signed evidence

`sealTwinState` يبني canonical deterministic representation مرتبطة بـtenant وsequence وprevious hash، ثم ينتج SHA-256 state digest. عند تمرير مفتاح توقيع ومعرّف key وخوارزمية مدعومة (Ed25519 أو RSA-SHA256 أو ECDSA-SHA256)، يوقّع أيضًا التمثيل canonical مع معرّف الخوارزمية والمفتاح ونطاق البروتوكول. يستطيع `verifyTwinSeal` فرض وجود التوقيع والتحقق منه بمفتاح يحله المتحقق عبر key ID موثوق. حفاظًا على التوافق، يمكن للختم غير الموقّع أن ينجح فقط عندما `requireSignature=false`؛ وهذا يثبت كشف التغيير ولا يثبت المصدر.

في الوضع الصارم، تتطلب `validateRealityEvidence` أغلفة موقعة منفصلة النوع لأدلة الجغرافيا والبصريات والمنشأ، وتحل المفاتيح عبر callback موثوق يملكه المتحقق `resolvePublicKey(keyId, evidenceType)` فقط، كما تشترط ربط كل payload موقّع ببصمة اللقطة المطلوبة. لا يُعتمد مفتاح يرسله منتج الدليل ولا قيمة منطقية مثل `signatureVerified: true` كإثبات. الحزمة لا تنشئ المفاتيح أو تخزّنها ولا تدّعي تكامل HSM/KMS؛ يجب أن تحفظ بيئة الإنتاج مفاتيح التوقيع داخل HSM/KMS، وأن تدير خدمة الثقة تدوير المفاتيح وإبطالها وسياسات الشهادات/IdP. إدخال الختم في `hash_ledger` الإنتاجي يظل بحاجة إلى مسار DB authority الموجود، ولا يُستنتج من hash محلي.

### Disaster and impact simulation

`simulateFailure` يحسب baseline/post-failure unit-capacity paths بشكل حتمي ويعيد النتيجة مع required path threshold. `digital-twin-gis` و`engineering/twin.js` يوفران impact closures للعملاء والخدمات. لا تُستخدم النتيجة لتحديد SLA مالي نهائي إلا بعد تطبيق عقد SLA ومصادر الاشتراك والتأثير الفعلية.

## بوابة التشغيل

```bash
npm test
npm run verify:formal
npm run verify
```

بوابة formal تشغّل أيضًا حالات Digital Twin صغيرة، وتفشل إذا لم ينجح topology أو optical parity أو spatial plausibility أو seal verification أو failure simulation.

## حدود الدليل

| ادعاء | الحالة |
|---|---|
| DAG finite topology proof | مثبت على الرسم المقدم فقط |
| tenant isolation في GIS | يعتمد على RLS/session وruntime DB؛ لا يثبت من pure function وحدها |
| optical measurement truth | يحتاج OTDR/vendor adapter ومعايرة حقيقية |
| OCR anti-spoofing | يحتاج adapter حيًا وسلسلة أدلة موقعة |
| ملايين العمليات دون overload | يحتاج load/stress/soak benchmark |
| SLA compensation | يحتاج contract وsubscriber impact data وauthority DB |

الصياغة التجارية الصحيحة هي: **deterministic, evidence-bound digital-twin verification layer**، وليس «توأم رقمي مطابق للواقع في كل الظروف».
