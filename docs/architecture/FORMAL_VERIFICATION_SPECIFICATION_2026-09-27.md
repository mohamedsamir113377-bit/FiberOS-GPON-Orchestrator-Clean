# FiberOS R14.1 — Formal Verification Specification

## الغرض

تضيف حزمة `packages/formal-verification` طبقة تحقق حتمية قابلة لإعادة التنفيذ. هذه الطبقة لا تستخدم كلمة «برهان مطلق» لوصف ما لا يمكن لـJavaScript أو اختبار finite-state أن يثبته. كل نتيجة مرتبطة بمجال محدد أو مصدر ثابت، وكل تقرير يذكر حدوده.

## البراهين القابلة للتنفيذ

### آلة الحالات وDAG

`verifyStateGraph` يثبت على الرسم الانتقالي المعلن أن الحالات القابلة للوصول من الحالة الابتدائية لا تحتوي دورة غير نهائية، وأن كل حالة غير نهائية لها مسار منتهٍ إلى حالة نهائية. هذا يثبت **bounded liveness للعقد المعلن**. لا يثبت وحده غياب deadlock في PostgreSQL أو queue أو distributed lock؛ لذلك تبقى اختبارات runtime والتزامن مطلوبة.

### حياد الترجمة وعدم التداخل

`verifyLocalizationNonInterference` يثبت، على مجموعة اللغات المعلنة، أن تغيير payload العرض/الترجمة لا يغير ناتج evaluator الحتمي عندما يظل مدخل النواة ثابتًا. لا يسمح هذا الاختبار بتحويل النتيجة إلى ادعاء أن كل parser أو كل runtime extension في العالم غير قابل للتأثير؛ بل يثبت contract محددًا يمكن توسيعه.

### حدود Kernel Firewall

`verifyConstantTimeBoundary` يتحقق ساكنًا من استخدام HMAC-SHA256 و`crypto.timingSafeEqual` ومن غياب مقارنة نصية مباشرة للتوقيع. هذا يوفر **constant-time comparison boundary** على مستوى API. لا يدّعي تساوي دورات CPU تمامًا عبر المعالجات أو أن كل أجزاء الطلب متساوية الزمن؛ تلك تحتاج تحليلًا متخصصًا وقياسات hardware.

### الحسابات الضوئية والـinterval arithmetic

`verifyOpticalInterval` يختبر احتواء الحساب النقطي داخل interval مشتق من الحدود المعلنة. الحد `±0.001 dB` لا يصبح حقيقة عامة تلقائيًا؛ لا يثبت إلا عندما يصرح المصدر بهذا الحد وتنجح الحالات المحددة. دقة الجهاز، calibration، جودة OTDR، والبيانات الحية لها قبول منفصل.

## تشغيل الشهادة

```bash
npm test
npm run verify:formal
npm run verify
```

تنتج البوابة شهادة JSON حتمية تتضمن `domainVersion` و`totalChecks` و`proofBoundary`. أي فشل في invariant أو static contract يوقف البوابة.

## Classification

| النتيجة | معناها |
|---|---|
| `PASS` | كل invariants المعلنة ضمن المجال المحدد نجحت |
| `FAIL` | invariant أو contract لم ينجح؛ الإصدار لا يمر البوابة |
| `NOT_PROVEN` | لم يتم توفير مصدر أو مجال كافٍ؛ لا يجوز عرض النتيجة كحقيقة |

هذه المواصفة ترفع قابلية التدقيق الهندسي، لكنها لا تحول المنتج إلى نظام «مستحيل الاختراق» ولا تثبت قدرة ملايين العمليات أو خفض OPEX بنسبة ثابتة دون benchmark وبيانات عميل موثقة.


## Digital Twin/GIS verification layer

تُشغّل البوابة أيضًا عقود `digital-twin-gis`: تحقق DAG للطوبولوجيا، optical parity بحد معلن، spatial plausibility، ختم SHA-256 مرتبطًا بالمستأجر والتسلسل، ومحاكاة فشل unit-capacity. التفاصيل وحدود كل عقد موثقة في `DIGITAL_TWIN_GIS_VERIFICATION_SPECIFICATION_2026-09-27.md`.
