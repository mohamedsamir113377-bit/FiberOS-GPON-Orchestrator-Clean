# FiberOS R14.1 — المواصفات الهندسية والفنية والمميزات

**نوع الوثيقة:** مواصفة تسليم هندسية وتقنية قابلة للتدقيق
**المصدر:** شجرة المصدر، migrations، عقود المسارات، اختبارات المشروع، وملفات التحقق التنفيذية
**ربط المصدر:** فرع التسليم النهائي؛ الـexact commit لا يُثبت داخل وثيقة مشتقة لتجنب self-reference، ويُحسم بالـSALES_PACKAGE_MANIFEST عند release freeze.
**الإصدار:** `1.0.0-rc.1+commercial.2026-09-25`
**الحالة:** Commercial Release Candidate — ليست شهادة تشغيل إنتاجي عامة
**سلسلة migrations:** `001–196`
**Node baseline:** `24.21.0`

> هذه الوثيقة تفرّق صراحة بين ما هو موجود في المصدر، وما هو مثبت باختبارات أو بوابات ثابتة، وما يحتاج بيئة المشتري أو تكاملًا خارجيًا. لا تُحوّل أي مميزة مصنفة `SPEC_ONLY` أو `SIMULATED` إلى ادعاء جاهزية إنتاجية.

---

## 1. التعريف والنطاق

FiberOS هو توزيع مصدر متعدد الخدمات لمنصة عمليات شبكات واتصالات ميدانية، مع تركيز FTTH اختياري ووضع افتراضي محايد للمشترين المتعددين. يجمع النظام بين:

- واجهات تشغيل ميدانية وواجهات قيادة/عمليات.
- API HTTP موحد تحت `/v1`.
- PostgreSQL/PostGIS كحد تخزين وموثوقية للبيانات التشغيلية.
- خدمات API وGIS وAI وWorker.
- حزم نطاقية للهندسة البصرية، GIS، التذاكر، المخزون، التوزيع، مركز الاتصال، المؤسسة، الأدلة، الأمن، والتحقق الرسمي.
- عزل tenant عبر PostgreSQL RLS/FORCE RLS مع طبقات تفويض تطبيقية.
- مسار migrations إنتاجي مرتب وموقّع بالـSHA-256.
- اختبارات، فحوص release integrity، فحوص قدرات، فحوص domain neutrality، فحوص manifest، وبوابات GitHub Actions.

### خارج النطاق أو غير المثبت تلقائيًا

لا يدّعي المصدر وحده توفير أو إثبات ما يلي دون إعداد وتشغيل وقبول من المشتري:

- PostgreSQL/PostGIS حي في بيئة المشتري.
- OIDC/JWKS حقيقي، شهادات TLS، وIngress إنتاجي.
- Redis عالي التوافر أو rate limiting موزع.
- NMS/OSS/BSS فعلي أو أجهزة ZTE فعلية.
- Object storage، KMS/HSM، النسخ الاحتياطي والاستعادة.
- uptime أو SLA أو تحمل DDoS حجمي على طبقات L3/L4.
- شهادة إنتاج عامة أو اعتماد أمني مستقل.

---

## 2. الهوية والإصدارات والمتطلبات

| العنصر | المواصفة |
|---|---|
| اسم التوزيع | FiberOS R14.1 — Sales Core |
| الإصدار | `1.0.0-rc.1+commercial.2026-09-25` |
| نوع الإصدار | Commercial Release Candidate |
| Node.js | `24.21.0`، ومثبت في `.nvmrc`، مع `engine-strict=true` |
| قاعدة البيانات | PostgreSQL `18.6+` |
| GIS database | PostGIS `3.6.x` |
| مدير الحزم | npm مع `package-lock.json` و`npm ci` |
| runtime container | `node:24.21.0-bookworm-slim` مثبت بالـdigest |
| migrations | متصلة من `001` إلى `127` |
| الواجهات الثابتة | Netlify أو استضافة static مكافئة |
| المصادقة الإنتاجية | OIDC Authorization Code + PKCE مع JWKS |
| حماية إعادة التشغيل | Redis `SET NX EX` عند تفعيل الحد الموزع، والفشل مغلق عند فقد Redis |
| الترخيص/الحقوق | تتحكم بها الاتفاقية التجارية الموقعة، وليس وجود المصدر وحده |

### المتطلبات الدنيا للتشغيل الكامل

1. Node.js `24.21.0`.
2. PostgreSQL 18.6 أو أحدث مع PostGIS 3.6.x.
3. قناة OIDC حقيقية تنشر JWKS.
4. HTTPS/TLS وIngress تحت إدارة المشتري.
5. مخزن أسرار محمي؛ لا توضع كلمات المرور أو مفاتيح TLS في المستودع.
6. Redis عند تفعيل حماية replay الموزعة أو أي تشغيل متعدد النسخ يحتاج حالة مشتركة.
7. بيانات وتكاملات المشتري: NMS، object storage، KMS/HSM، البريد/الرسائل، وخدمات الخرائط عند تفعيلها.

---

## 3. المعمارية المنطقية

### 3.1 طبقات النظام

1. **Interfaces / Apps** — `apps/*`: صفحات field وoperations وتستهلك عقود API ولا تستورد internals للخدمات.
2. **Services** — `services/*`: النقل HTTP، orchestration، worker jobs، وحدود التكامل.
3. **Domain packages** — `packages/domain`, `core`, `enterprise-kernel` وغيرها: حالة الأعمال والسياسات وحدود الحقيقة.
4. **Scientific/engineering packages** — حسابات حتمية عديمة الآثار، مثل optical budgets، path solving، reliability، statistics، GIS/math.
5. **Infrastructure/adapters** — database، security، observability، SNMP/NMS، وsouthbound contracts.
6. **Compute kernel** — `worker_threads` لتنفيذ دفعات حسابية حتمية مع الحفاظ على ترتيب النتائج وتمرير أخطاء العامل.

### 3.2 الخدمات التنفيذية

| الخدمة | نقطة التشغيل | الدور |
|---|---|---|
| API | `services/api/src/server.js` | HTTP API، تفويض المسارات، orchestration، authority delegation إلى PostgreSQL |
| Worker | `services/worker/src/worker.js` | معالجة الخلفية وoutbox والمهام غير المتزامنة |
| AI | `services/ai/src/server.js` | حد AI/advise؛ لا يجعل ناتج AI حقيقة أو قرارًا نهائيًا دون evidence/policy |
| GIS | `services/gis/src/server.js` | قراءة طبقات GIS، nearby assets، intersections، وPostGIS boundaries |
| Field web | `apps/field-web/` | واجهة الفني/الميدان والـbuyer/demo surfaces |
| Ops web | `apps/ops-web/` | واجهة العمليات والقيادة ومركز التحكم |

### 3.3 الحزم الرئيسية

المستودع يضم **45 حزمة** ضمن خريطة المعمارية الحالية، من أبرزها:

- `@fiberos/core`, `@fiberos/domain`, `@fiberos/enterprise-kernel`.
- `@fiberos/db`, `@fiberos/security`, `@fiberos/security-firewall`.
- `@fiberos/engineering`, `@fiberos/compute-kernel`, `@fiberos/ftth-measurements`.
- `@fiberos/digital-twin-gis`, `@fiberos/sovereign-gis`.
- `@fiberos/dispatch`, `@fiberos/sync`, `@fiberos/field-closure`.
- `@fiberos/observability`, `@fiberos/audit`, `@fiberos/truth-evidence`.
- `@fiberos/ai-boundary`, `@fiberos/model-governance`, `@fiberos/sovereign-ai-context`.
- `@fiberos/contact-center-intelligence`, `@fiberos/sovereign-contact-center`, `@fiberos/call-routing`.
- `@fiberos/interface-contracts`, `@fiberos/southbound-contract`, `@fiberos/adapters`.
- `@fiberos/formal-verification`, `@fiberos/scientific-validity`, `@fiberos/assurance`.
- `@fiberos/performance-capacity`, `@fiberos/operations-trace`, `@fiberos/gis-reconciliation`, `@fiberos/secrets-data-leakage`, `@fiberos/state-machine-concurrency`.

الاعتماديات التشغيلية الخارجية الأساسية محدودة ومثبتة في lockfile، وتشمل `pg 8.16.3`، `redis 6.2.1`، `net-snmp`، `sor-reader`، وOpenTelemetry HTTP/PG/Node SDK بإصدارات مثبتة في service manifests.

---

## 4. واجهات الويب

يبني `node scripts/build-netlify-site.js` الموقع إلى `.netlify/site`، وتشمل الأسطح:

| المسار | السطح |
|---|---|
| `/` | Buyer Nexus |
| `/ops/` | Operations Console |
| `/enterprise-command.html` | Enterprise Command |
| `/field/` | Field Technician |
| `/i18n/` | أصول localization المصدرية |

الـstatic site يضم CSP وHSTS وCOOP وCORP، ولا يضع أسرارًا أو JWTs أو كلمات مرور. المتغير العام الاختياري `FIBEROS_API_BASE` عنوان URL فقط، ولا يجوز استخدامه لحفظ credentials.

### التدويل

- كتالوج أساسي وبيانات locales تحت `i18n/`.
- 114 locale في فحص الجودة.
- 101 مفتاح ترجمة.
- 2 locale موثقان، و112 machine-draft، و0 untranslated حسب فحص الإصدار الحالي (2026-10-16).
- صفحات static لا تكرر كل الكتالوجات؛ تستخدم source/manifest والكتالوج العربي الموثق عند الحاجة.

---

## 5. API HTTP — المجموعات والوظائف

كل المسارات المحمية تمر بحد admission middleware، ثم تستكمل الصلاحيات الدقيقة في handler وPostgreSQL/RLS. المسارات التالية مستخرجة من عقد `services/api/src/server.js` وسياسات التفويض.

### 5.1 الصحة والـmetadata

- `GET /health`
- `GET /v1/meta`
- `GET /v1/lifecycle/self-test`
- `GET /v1/adapters`
- `GET /v1/integration/readiness`
- `GET /v1/security/hardening/readiness`
- `GET /v1/assurance/capabilities`

### 5.2 التذاكر والإغلاق والأدلة

- `POST /v1/tickets/transition`
- `POST /v1/tickets/lifecycle/step`
- `POST /v1/tickets/close-field`
- `GET /v1/customer/tickets`
- `POST /v1/evidence/submit`
- `GET /v1/operations/evidence-chain/{ticketId}`
- `POST /v1/operations/evidence-chain/{ticketId}/certify`
- `POST /v1/sync/batch`

المسار النهائي للحالة لا يثق في `fromStatus` المرسل من العميل، وتُسند صلاحية الانتقال والقفل والحالة الحالية إلى authority في PostgreSQL عند المسارات الحساسة.

### 5.3 الذكاء التشغيلي وAI

- `POST /v1/intelligence/graph`
- `POST /v1/intelligence/engineering`
- `POST /v1/contact-center/intelligence`
- `POST /v1/ai/advise`
- `GET /v1/contact-center/runtime/status`
- `GET /v1/operations/realtime/snapshot`
- `GET /v1/operations/sla-command`
- `GET /v1/command/fabric/overview`
- `GET /v1/command/rooms/overview`
- `GET /v1/events/processing/health`
- `POST /v1/events/runtime/validate`
- `GET /v1/events/runtime/recovery`

ناتج AI advisory وغير سلطوي: لا يجوز اعتباره حقيقة، isolation تلقائيًا، dispatch تلقائيًا، أو remediation تلقائيًا من دون evidence وpolicy gates.

### 5.4 الهندسة البصرية والقياسات

- `POST /v1/optics/power-budget`
- `POST /v1/optics/measurements`
- `POST /v1/optics/validate`
- `POST /v1/engineering/optical-budget`
- `POST /v1/engineering/correlated-optical-margin`
- `POST /v1/engineering/residual`
- `POST /v1/engineering/reliability`
- `POST /v1/engineering/weibull-mle`
- `POST /v1/engineering/proportional-hazard`
- `POST /v1/engineering/diagnosis`
- `POST /v1/engineering/gaussian-fusion`
- `POST /v1/engineering/correlated-gaussian-fusion`
- `POST /v1/engineering/blast-radius`
- `POST /v1/engineering/shortest-path`
- `POST /v1/engineering/max-flow`
- `POST /v1/engineering/edge-disjoint-paths`
- `POST /v1/engineering/expected-utility`
- `POST /v1/engineering/risk-adjusted-utility`
- `POST /v1/engineering/cvar-loss`
- `POST /v1/engineering/uncertainty-budget`
- `POST /v1/engineering/mahalanobis`
- `POST /v1/engineering/drift`
- `POST /v1/engineering/validate-calibration`

الحسابات deterministic في طبقات engineering، لكن صلاحية القياس الواقعي تتطلب معايرة جهاز، fixtures، vendor resolver، وبيانات ميدانية.

### 5.5 GIS وdigital twin وrouting

- `GET /v1/gis/features`
- `GET /v1/gis/fleet`
- `GET /v1/gis/network-twin`
- `POST /v1/gis/twin/impact`
- `GET /v1/gis/twin/capacity/{assetId}`
- `POST /v1/gis/nearest-technicians`
- `POST /v1/gis/positions`
- `GET /v1/gis/fusion/layers`
- `POST /v1/gis/nearby-assets`
- `POST /v1/gis/intersections`
- `POST /v1/routing/plan`

GIS يعتمد على بيانات PostGIS وعلاقات physical topology الموجودة؛ لا ينشئ مواقع أو شبكات أو telemetry غير موجودة.

### 5.6 مركز الاتصال والاتصالات

- `POST /v1/call-center/sessions`
- `POST /v1/call-center/sessions/{id}/ivr`
- `POST /v1/call-center/ivr/inbound`
- `GET /v1/call-center/metrics`
- `POST /v1/call-center/dispositions`
- `GET /v1/call-center/queue/status`
- `POST /v1/call-center/queue/assign`
- `POST /v1/call-center/queue/release`
- `POST /v1/contact-center/agents/presence`
- `GET /v1/contact-center/customer-360/{reference}`

### 5.7 المخزون والمستودعات والـdispatch

- `GET /v1/warehouses/overview`
- `GET /v1/warehouses/{warehouseId}/stock`
- `POST /v1/warehouses/transfers`
- `POST /v1/warehouses/reservations`
- `POST /v1/warehouses/reservations/{id}/release`
- `POST /v1/inventory/adjust`
- `POST /v1/dispatch/rank`
- `GET /v1/operations/case-context/{reference}`
- `POST /v1/ops/rework-cases`
- `POST /v1/ops/rework-cases/{caseId}/close`

### 5.8 الفوترة والرسائل والأزمات

- `POST /v1/billing/invoices`
- `POST /v1/billing/payment-cycle`
- `POST /v1/billing/payment-cycle/{cycleId}/transition`
- `POST /v1/messaging/enqueue`
- `GET /v1/crisis/command-state`
- `POST /v1/crisis/incidents`
- `GET /v1/crisis/incidents/{incidentId}/impact`

---

## 6. نموذج التفويض والأدوار

الأدوار الظاهرة في عقد التفويض تشمل:

`technician`, `team_lead`, `dispatcher`, `call_center`, `ops_manager`, `area_supervisor`, `exec`, `sysadmin`, `qc`, `warehouse`, `cfo`.

### قاعدة التفويض

- `packages/security/src/authorization.js` هو نموذج السياسة القابل لإعادة الاستخدام.
- `services/api/src/authorizationMiddleware.js` يفرض admission على المسارات المحمية.
- التفويض الدقيق ليس مجرد role check؛ يشمل المورد، الفعل، الملكية، tenant، lifecycle، وقواعد DB authority.
- claims مثل `org_id` و`nation_iso` و`employee_id` و`role_key` ليست حدود عزل tenant.
- الحد الفعلي لعزل tenant يعتمد على `tenant_id` المشتق من session/preferences وسياسات RLS.
- المسارات العامة المحدودة هي `/health` و`/v1/meta` و`/v1/lifecycle/self-test` وinbound IVR المحدد؛ بقية `/v1` تعامل كمحمية وفق policy.

---

## 7. قاعدة البيانات وطبقة الحقيقة

### 7.1 بنية database

- migrations إنتاجية متسلسلة `001–196`.
- PostgreSQL 18.6+ مع PostGIS 3.6.x.
- أدوار منفصلة للمالك/المهاجر والتطبيق والworker.
- يجب تشغيل `sql/bootstrap/00_production_roles.sql` قبل migration.
- يجب أن يبقى `MIGRATOR_DATABASE_URL` خارج حاويات التطبيق.
- بعد migration تُطبق `sql/bootstrap/20_runtime_role_grants.sql`.
- runtime roles لا تحصل على امتيازات migration.

### 7.2 المجالات التخزينية الرئيسية

- tenants وuser preferences والهوية التنظيمية.
- technicians، hierarchy، subordinate scope، positions.
- tickets، lifecycle، field closure، assignments.
- evidence، optical measurements، source provenance.
- network assets، network ports، physical topology، optical/FTTH links.
- FTTH programs، work packages، tasks، work events، quality gates.
- FTTH customer orders وactivation events.
- ducts، cable segments، splices، ODN connections، construction evidence.
- inventory items، transactions، reservations، warehouses، bins، transfers.
- customer accounts، invoices، payment cycles، payment events.
- call sessions، call events، dispositions، queue assignments.
- incidents، incident events، crisis/impact state.
- dispatch requests، routing requests، outbox/events، processing attempts.
- audit log، hash ledger، decision certificates، truth facts، conflicts، model outcomes.
- contractor entities، qualifications، work authorizations، material chain.
- enterprise departments، positions، policies، decisions، scopes، dashboard contracts.
- readiness/audit/proof revocation وسجلات deployment.
- GIS layer registry، asset DNA، contact-center nodes، web AI models/requests.

### 7.3 العزل والنزاهة

- تفعيل `ROW LEVEL SECURITY` و`FORCE ROW LEVEL SECURITY` عبر طبقات متعددة.
- سياسات tenant-aware على الجداول التشغيلية والحساسة.
- composite tenant foreign keys لإغلاق cross-tenant references في المجالات الحرجة.
- authority functions في PostgreSQL لبعض انتقالات lifecycle، incidents، evidence، hash ledger، rework، وwebhooks.
- append-only hash ledger مع signing boundary؛ custody للمفتاح خارج التطبيق/المستودع.
- audit trail لا يُعاد تسميته أو تقديمه كدليل إنتاجي إذا كان تاريخيًا أو ناقصًا.

### 7.4 migration acceptance

ينبغي على المشتري الاحتفاظ بأدلة:

1. checksum لكل migrations `001–196`.
2. نجاح bootstrap roles/grants.
3. cross-tenant negative tests.
4. RLS وFORCE RLS في PostgreSQL الفعلي.
5. انتقالات ticket/incident وfield close تحت DB authority.
6. مفاتيح ledger وKMS/HSM عند استخدامها.

---

## 8. الأمن والمرونة

### 8.1 Application firewall

`packages/security-firewall` يسبق handlers في API/AI/GIS ويطبق:

- رفض path traversal وnull bytes.
- allow-list للـHTTP methods وحظر TRACE/TRACK/CONNECT.
- رفض scanner probe paths مثل `.env` و`.git` و`wp-admin`.
- حدود body size وcontent type.
- فرض HTTPS في production ضمن trusted proxy CIDR.
- `SECURITY_ALLOWED_HOSTS` اختياري.
- `SECURITY_FIREWALL_DENY_CIDRS` اختياري.
- التكامل مع CORS، security headers، rate limits، Redis replay، وRLS.

### 8.2 الهوية والجلسات

- OIDC Authorization Code + PKCE.
- التحقق من JWKS/RS256.
- المتصفح يحصل على HttpOnly session cookie وCSRF token، لا bearer JWT دائم في static app.
- provider tokens وclient secrets تبقى server-side.
- قبول buyer IdP وissuer وJWKS يجب أن يُعاد في بيئة المشتري.

### 8.3 Replay وidempotency

- المسارات mutating المحمية يمكن أن تتطلب `X-Idempotency-Key`.
- production replay backend المقصود Redis باستخدام atomic `SET NX EX`.
- حجز replay لا يُحذف بعد الاستجابة؛ يحتفظ به حتى TTL لمنع الإعادة الفورية.
- فقد Redis في هذا الحد يفشل مغلقًا عند تفعيل boundary.

### 8.4 rate limiting وDDoS

- rate limiter الحالي `PROCESS_LOCAL`؛ ليس موزعًا بين replicas.
- توجد حدود concurrent لكل source IP وحد process-wide عبر `SECURITY_DDOS_MAX_CONCURRENT_PER_IP` و`SECURITY_DDOS_MAX_GLOBAL_CONCURRENT`.
- الحماية الحجمية L3/L4 خارج نطاق التطبيق وتحتاج CDN/cloud WAF/provider Shield.
- إعداد reverse proxy المرفق يوفر حدود HTTP، لكنه لا يمتص multi-Gbps flood وحده.

### 8.5 الأسرار

لا توجد credentials حية في المصدر. تشغيل TLS يحتاج ملفات operator-provided:

- `deploy/secrets/pg_owner_password.txt`
- `deploy/secrets/server.crt`
- `deploy/secrets/server.key` بصلاحيات `0600` عند الحاجة.

غياب شهادات TLS في override يؤدي إلى fail-closed.

---

## 9. التكاملات والـadapters

| التكامل | الحالة التقنية |
|---|---|
| PostgreSQL/PostGIS | حد persistence أساسي؛ يحتاج تشغيل المشتري |
| OIDC/JWKS | boundary منفذ؛ يحتاج issuer/JWKS حقيقي |
| Redis | replay/حالة مشتركة عند التفعيل؛ HA acceptance مطلوب |
| ZTE SNMP | read-only adapter opt-in عبر `NMS_VENDOR=zte`؛ يحتاج أجهزة وcredentials |
| OTDR SOR | SR-4731 parser boundary مع CRC؛ structural fallback لا يولد قياسًا |
| Routing provider | endpoint attestation ومسار خارجي مقيد؛ ليس دليل ETA عام |
| Object storage | boundary يحتاج إعدادًا واختبارًا خارجيًا |
| KMS/HSM | مطلوب عند ربط signing/certificates بمفتاح إنتاجي |
| OpenTelemetry | API HTTP وPostgreSQL instrumentation محدد في service dependencies |

### حدود صريحة

- NMS mock اختباري فقط.
- OTDR vendor parsing مصنف `SPEC_ONLY` حتى يتوفر corpus حقيقي وfixtures.
- AI diagnosis مصنف `SPEC_ONLY`، ولا توجد مخرجات authoritative دون evidence/policy.
- offline field sync أصبح `SOURCE_IMPLEMENTED` بطابور AES-256-GCM/IndexedDB وحالة conflict/reconnect deterministic؛ field/device/runtime verification يبقى حدًا منفصلًا.
- geometric pre-check trigger معطل حتى يفعّله المشتري صراحة.

---

## 10. المميزات الوظيفية

### مميزات أساسية مثبتة في المصدر

- ticket lifecycle وانتقالات حالة مع locking وcompare-and-update.
- field close مع فحوص evidence وtenant وrole وNMS provenance.
- structured field evidence وسلسلة evidence قابلة للcanonicalization وSHA-256.
- tenant-aware inventory وحركة المواد والحجوزات والتحويلات.
- call-center sessions، dispositions، presence، queue assignment/release، وcustomer 360.
- incidents وcrisis command state وimpact views.
- dispatch ranking وrouting requests.
- financial snapshot، invoices، payment cycle authority.
- network topology، traversal، path، asset impact، customer impact.
- optical health timeline مع trend من القياسات المرصودة فقط.
- PON/port capacity: used/reserved/provisioned/free/headroom/over-capacity مشتقة من network ports/assets، لا من أرقام يدوية فقط.
- GIS features، nearby assets، intersections، fleet، positions، fusion layers.
- enterprise scope/organization/decisions/policies.
- audit/hash ledger وdecision certificates مع حدود signing.
- multi-buyer/domain-neutral mode يمنع المصطلحات القطاعية في أسطح البيع عند تفعيله.

### امتدادات عالية القيمة

1. Structured Visual Evidence + Quality Gate.
2. Asset Installed-Base Condition Ledger.
3. Skills & Certification Eligibility Matrix.
4. Bounded Offline Decision Support Pack.
5. Explainable Dispatch Suggestion Layer.
6. Customer Self-Service Constraint Booking.
7. Labor + Parts Cost Attribution to Risk/Brief.
8. Alarm correlation وroot-cause candidate graph من observations/topology.
9. Optical health timeline دون forecasting.
10. Field evidence chain certification.
11. PON/port capacity intelligence.
12. ZTE read-only optical power adapter.
13. OTDR SOR ingestion boundary.
14. technician positions وPostgreSQL `pg_notify` realtime foundation.
15. operations dashboard summary tenant-scoped.

> المميزات أعلاه ليست متساوية في درجة الإثبات؛ التصنيف الرسمي في `config/capability-registry.json` ونتائج الاختبارات هو المرجع.

---

## 11. تصنيف القدرة ودرجة الإثبات

| التصنيف | معناه |
|---|---|
| `IMPLEMENTED` | السلوك موجود في المصدر؛ لا يعني وحده قبول إنتاج المشتري |
| `UNIT_TESTED` | توجد اختبارات deterministic/unit؛ لا تعادل تكاملًا حيًا |
| `SIMULATED` | محاكاة أو mock؛ لا تثبت تكامل vendor/production |
| `SOURCE_IMPLEMENTED` | تنفيذ مصدر مكتمل على مستوى العقد/الوحدة؛ لا يعادل runtime أو buyer acceptance |
| `SPEC_ONLY` | حد أو عقد تصميم؛ ليس ميزة تشغيلية مثبتة |

التصنيفات الحساسة الحالية:

- `ticket.lifecycle`: IMPLEMENTED؛ اختبارات authority موجودة، وDB/runtime acceptance مطلوب.
- `field.reality-gate`: UNIT_TESTED؛ server/RLS verification مطلوب.
- `optical.source-provenance`: IMPLEMENTED؛ اختبارات هندسة/إثبات optical موجودة، بينما physical/vendor proof منفصل.
- `optical.engineering-math`: UNIT_TESTED؛ المعايرة وOTDR/vendor fixtures خارج الحد.
- `olt.nms.read-only`: SIMULATED؛ endpoint حقيقي مطلوب.
- `otdr.vendor-parsing`: SPEC_ONLY؛ corpus وfixtures vendor حقيقية مطلوبة.
- `ai.diagnosis`: SPEC_ONLY؛ لا توجد مخرجات authoritative دون evidence/policy.
- `decision.certificates`: UNIT_TESTED؛ persistent signing/KMS مطلوب.
- `tenant.rls`: IMPLEMENTED؛ cross-tenant attack/live DB acceptance مطلوب.
- `immutable.audit`: IMPLEMENTED؛ live privilege/append-only verification وkey custody مطلوبان.
- `offline.field-sync`: SOURCE_IMPLEMENTED؛ exact device/browser runtime وkey lifecycle وfield verification ما زالت منفصلة.
- `network.reality-kernel`: SOURCE_IMPLEMENTED؛ hosted PostgreSQL/PostGIS/RLS proof ما زال مطلوبًا.
- `network.master-statement-kernels`: SOURCE_IMPLEMENTED؛ full five-kernel runtime proof ما زال مطلوبًا.
- `operations.reality-trace`: SOURCE_IMPLEMENTED؛ explicit-link-only trace مع bounded traversal.
- `gis.reconciliation`: SOURCE_IMPLEMENTED؛ planned/field/as-built reconciliation مع tenant-aware identity.
- `contact.call-incident-correlation`: SOURCE_IMPLEMENTED؛ read-only/advisory graph مع ambiguity preservation.
- `optical.assurance-provenance`: SOURCE_IMPLEMENTED؛ instrument/calibration provenance gate.
- `offline.operation-envelope`: SOURCE_IMPLEMENTED؛ server-authority metadata/idempotency/expiry boundary.
- `operations.recovery-control`: SOURCE_IMPLEMENTED؛ explicit reauthorization وanti-skip verification.

---

## 12. التشغيل والنشر

### 12.1 تحقق محلي

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run verify
npm run verify:commercial
npm run website:test
```

بوابات مركزة:

```bash
npm run verify:architecture
npm run verify:release
npm run verify:migration-sequence
npm run verify:production-console
npm run verify:root-cause
npm run verify:formal
npm run verify:capabilities
npm run verify:domain
npm run verify:i18n:quality
npm run verify:runtime-evidence
npm run verify:manifest
npm run visual:check
```

### 12.2 ترتيب قاعدة البيانات

```bash
# كمسؤول قاعدة بيانات مضبوط
psql "$ADMIN_DATABASE_URL" -f sql/bootstrap/00_production_roles.sql

# داخل بيئة المهاجر فقط
export NODE_ENV=production
export MIGRATOR_DATABASE_URL='...'
npm run migrate

# بعد اكتمال migrations
psql "$ADMIN_DATABASE_URL" -f sql/bootstrap/20_runtime_role_grants.sql
```

لا تمرر `MIGRATOR_DATABASE_URL` إلى API أو worker containers.

### 12.3 الحاويات

`docker/Dockerfile.runtime` يدعم `SERVICE=api|gis|worker|ai`، ويقوم بـ:

- build stage مع `npm ci --omit=dev --ignore-scripts`.
- runtime stage منفصل لا يحتوي SQL/migration/maintenance trees.
- تشغيل non-root تحت مستخدم `node`.
- entrypoint ثابت `fiberos-entrypoint` بصلاحية `0555`.
- image base مثبت بالdigest.

### 12.4 static hosting

- Build command: `node scripts/build-netlify-site.js`.
- Publish directory: `.netlify/site`.
- Node: `24.21.0`.
- السطح الثابت لا يثبت readiness للـAPI أو DB أو IdP.

---

## 13. الجودة والتحقق الحالي

البوابات الحالية المثبتة في المستودع وCI تشمل:

- Release integrity: PASS.
- Migration sequence/SHA ledger: source declares chain `001–196`; exact-head static checksum and provenance validation pass, while live runtime migration application remains pending.
- Production-console boundary: PASS.
- Architecture boundary/map: source map aligned to 43 packages; final static verification remains required.
- JavaScript syntax: PASS.
- Root-cause contracts: PASS.
- Formal verification: PASS_CORE، 259 checks في سجل الإصدار.
- Capability parity: PASS, 105 buyer-facing parity entries in the reference matrix; capability-registry status remains separately governed.
- Domain neutrality: PASS، multi-buyer.
- i18n quality: PASS، 114 locales / 101 keys.
- Manifest parity: PASS، مع manifest SHA-256 canonical.
- Commercial release consistency: PASS.
- Historical GitHub workflow evidence exists for predecessor/reference commits; exact current handoff-head workflow status is intentionally not claimed until final run.
- Historical dependency scans recorded 0 high-severity vulnerabilities in the cited reference run; exact-head dependency verification remains a final execution step.
- Historical visual-regression evidence exists; exact-head visual execution remains pending.
- Lighthouse budget gate is wired into the website workflow; exact-head performance execution remains pending.

### تفسير نتائج الاختبار

الاختبار المحلي يعتمد Node.js `24.21.0` و`npm ci` من lockfile. أي skip مرتبط بخدمة اختيارية مثل Redis لا يُعرض كنجاح لتكامل لم يُشغّل. وجود green static/CI checks لا يثبت تشغيل بنية المشتري الخارجية.

---

## 14. حدود الجاهزية والإفصاح التجاري

هذه حزمة مصدر قوية وواسعة، لكنها **Release Candidate** وليست SaaS مستضافة ولا عقد SLA بذاته. قبل بيعها على أنها جاهزة لتشغيل عميل، يلزم عقديًا وتقنيًا:

1. تنفيذ migration chain في بيئة المشتري.
2. قبول cross-tenant/RLS وnegative tests.
3. ربط OIDC/JWKS وTLS/Ingress.
4. ضبط secrets وbackup/restore.
5. تشغيل Redis HA والـreplay tests عند الحاجة.
6. اختبار NMS/ZTE وfixtures OTDR الحقيقية.
7. اختبار object storage وKMS/HSM.
8. تشغيل load/performance وdisaster recovery.
9. قبول ميداني للـfield workflows والبيانات الواقعية.
10. تدقيق IP/licenses/provenance والاتفاقية التجارية.

### ادعاءات ممنوعة أو غير مدعومة

- “مضمون إنتاجيًا لكل عميل”.
- “لا توجد أي ثغرات في كل بيئة”.
- “يدعم كل أجهزة OTDR/NMS”.
- “AI يتخذ القرار أو يصلح الشبكة تلقائيًا”.
- “rate limiting موزع” دون Redis/configuration.
- “DDoS protection” على مستوى multi-Gbps داخل التطبيق.
- “offline sync مكتمل” قبل field verification.

---

## 15. فهرس الملفات المرجعية

- `README.md` — نقاط الدخول وحدود الحقيقة.
- `FINAL_VERIFICATION_STATUS.md` — حالة التحقق الحالية.
- `BUYER_QUICKSTART.md` — متطلبات المشتري ومسار البدء.
- `SECURITY.md` — نموذج الأمن وحدود الإنتاج.
- `NETLIFY_DEPLOYMENT.md` — static deployment.
- `docs/ARCHITECTURE_MAP.md` — طبقات المعمارية وقواعد الصيانة.
- `docs/architecture/AUTHORIZATION_BOUNDARY.md` — حدود التفويض.
- `docs/status/DEEP_FIELD_OPERATIONS_INTELLIGENCE_2026-10-03.md` — المميزات الميدانية العميقة.
- `docs/status/FIELD_OPERATIONS_INTEGRATION_2026-10-03.md` — ZTE/OTDR/positions/dashboard.
- `config/capability-registry.json` — تصنيف القدرات وحدود الإثبات.
- `sql/migrations/PRODUCTION_MIGRATIONS.txt` — migration inventory.
- `sql/migrations/PRODUCTION_MIGRATIONS.sha256` — checksums.
- `SALES_PACKAGE_MANIFEST.json` — inventory وSHA-256 لكل ملف.
- `.github/workflows/` — release admission، website، visual، manifest checks.

---

## الخلاصة التنفيذية

FiberOS R14.1 هو **source distribution متعدد الخدمات** ذو قاعدة تقنية واسعة: API، field/operations web، PostGIS، RLS، evidence/audit، optical engineering، GIS/digital twin، contact center، inventory، billing، dispatch، AI boundary، وrelease assurance. القيمة الأساسية ليست مجرد واجهة؛ بل في حدود الحقيقة، tenant isolation، migrations المرتبة، DB authority، security firewall، deterministic engineering، وعقود التحقق.

في الوقت نفسه، المنتج الحالي يجب بيعه بصدق باعتباره **Commercial Release Candidate** يحتاج buyer-owned deployment acceptance. أقوى طريق لرفع قيمته هو تشغيله على بنية حقيقية، توثيق pilot مدفوع، ربط NMS/OIDC/Redis/KMS، وإضافة evidence إنتاجي قابل لإعادة التحقق دون تحويل نتائج المصدر إلى شهادات عامة.
