# FiberOS R14.1 — تقرير مراجعة ومعالجة الملاحظات

**المصدر:** التقرير المرفق `pasted_content.txt` بتاريخ 2026-09-27.

## الحكم

التقرير المرفق صحيح في جوهره. تم تنفيذ الإصلاحات القابلة للتحقق داخل المستودع، مع إبقاء ما يحتاج بيئة مشتري أو مزودًا خارجيًا مفتوحًا وfail-closed.

## الإصلاحات المنفذة

### 1. Node engines — مغلق

تم توحيد `engines.node` إلى `>=24.21.0` في كل `packages/*/package.json` و`services/*/package.json`، وليس الجذر فقط. بذلك لا تبقى حزم تعلن Node 18 أو 22 بينما الجذر يطلب 24.

### 2. Architecture Map — مغلق

كان مولد الخريطة يستخدم regex لا يلتقط صيغة `require('...')` بصورة صحيحة، لذلك خرجت الحواف فارغة. تم إصلاح parser ليقرأ:

- `require('...')`
- `from '...'`
- المسارات النسبية متعددة المستويات
- حزم `@fiberos/*`

وأضيفت بوابة `verify:architecture-map` إلى `npm run verify`، وتتحقق من وجود الحافة المهمة `engineering → compute-kernel` ومن عدم وجود أهداف غير معروفة.

### 3. الوثائق والتغليف — مغلق

تم تنظيم الوثائق إلى:

- `docs/commercial/`
- `docs/status/`
- `docs/architecture/`
- `docs/runbooks/`
- `docs/audit/history/`

وأصبح الجذر مقتصرًا على نقاط الدخول الأساسية ووثائق التشغيل الرئيسية. تم تحديث README وبوابة `verify-commercial-release` والروابط الداخلية.

### 4. i18n production boundary — مغلق برمجيًا

لم يتم تزوير ترجمة اللغات الـ114. أضيفت إلى `verify:production-readiness` بوابة `i18nProductionLocales`، وتفرض افتراضيًا أن تكون `ar,en`:

- `status=verified`
- `verifiedCoverage=100`

أما اللغات غير verified فتبقى غير مفعلة إنتاجيًا، مع بقاء بياناتها موصوفة كـmachine-draft أو untranslated.

### 5. تغطية الاختبارات — تحسن مستهدف

أضيفت اختبارات contract فعلية إلى:

- `packages/adapters/test/adapterContracts.test.js`
- `packages/enterprise-ftth/test/workflowContracts.test.js`

وتغطي fail-closed للـNull adapter، validation/freeze للـregistry، انتقالات workflow، mandatory gates، وactivation prerequisites.

### 6. compute-kernel import — تم التحقق والتوثيق

`require('@fiberos/compute-kernel')` استيراد workspace مقصود، لأنه يحافظ على package contract بدل ربط engineering بمسار source داخلي. تم توثيق القرار داخل الملف، وأثبتت Architecture Map الحافة المقابلة.

## ما بقي مقصودًا وغير مغلق

- 58 capability ما زالت `UNIMPLEMENTED`.
- 24 capability ما زالت `VISION`.
- 3 capability تحتاج تكاملًا خارجيًا.
- 30 لغة untranslated و82 machine-draft لا يجوز تحويلها إلى verified دون ترجمة ومراجعة بشرية حقيقية.
- تغطية شاملة لكل adapter/vendor وend-to-end production integrations تحتاج endpoints وcredentials وdevices مملوكة للمشتري.
- load/stress/soak وOIDC/KMS/Object Storage/NMS/OTDR/Webhooks لا يمكن إثباتها من source distribution وحدها.

## مقترحات المرحلة التالية

1. اعتماد `ar,en` فقط في أول release تجاري، وإدارة اللغات الأخرى عبر queue ترجمة ومراجعة بشرية.
2. إضافة contract test إلزامي لكل adapter جديد قبل إدخاله إلى registry.
3. إضافة coverage thresholds مستقلة لـ`adapters`, `domain`, `enterprise-ftth` في CI، مع عدم احتساب ملفات العقود/الـstubs كتنفيذ.
4. منع أي capability من الانتقال إلى `REAL` إلا بمرجع اختبار executable وserver surface وruntime proof.
5. إجراء dependency graph review دوريًا بعد كل workspace إضافة.
6. إبقاء `PRODUCTION_HOLD=true` حتى اكتمال buyer-owned live attestation.

## معيار القبول بعد المعالجة

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm run verify:commercial
npm run verify:production-readiness
```

النجاح المحلي يثبت سلامة المستودع والعقود فقط؛ ولا يحول الحزمة إلى نظام FTTH كامل أو Production Approved دون قبول البيئة الخارجية.
