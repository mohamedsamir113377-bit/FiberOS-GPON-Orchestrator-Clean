# FiberOS Native Intelligence Architecture v1

**Status:** Architecture proposal committed for review; not an implementation certification.  
**Baseline:** `main` at `7b80770c1efb021339c761eb785594ecd4b8d732`; production migration source chain is `001–186`.  
**Scope:** Intelligence designed into FiberOS features from requirements through operation and evidence.  
**Safety boundary:** This specification authorizes no production deployment, Neon change, migration, secret rotation, or merge of another pull request.

## 1. Foundational decision

FiberOS shall own the operational boundary of its intelligence: inference, retrieval, model artefacts, prompt/templates, policy enforcement, evaluation data, observability, and release decisions must be controlled by FiberOS-operated environments. Production runtime must not depend on an external AI SaaS API or an externally hosted agent.

This does not claim that a model must be trained from random initialisation. A model whose weights and licence have been reviewed may run inside a FiberOS-controlled environment. It becomes an approved FiberOS runtime model only after its exact artefact, provenance, licence, serving image, configuration, and evaluation results are recorded and admitted.

Intelligence is designed into each feature from requirements through its data model, workflow, tests, runtime and monitoring. It is not attached at the end as an unbounded chatbot.

## 2. Normative principles

**MUST**, **MUST NOT**, **SHOULD**, and **MAY** express requirements for subsequent implementation.

1. **No external inference dependency.** Production inference requests, embeddings, reranking, speech transcription, summarisation, moderation and agent/tool execution MUST NOT call public AI endpoints or external AI-provider APIs.
2. **No external runtime agent.** A third-party hosted agent MUST NOT hold FiberOS credentials, read operational data, choose privileged actions, or become a runtime dependency.
3. **Default-deny egress.** Network policy MUST deny outbound access by default from model-serving and intelligence services. Only explicitly approved internal destinations may be allowed. DNS names or private IPs alone do not prove that an endpoint runs a local model.
4. **Private hosting is not sufficient proof.** An internal proxy could forward content externally. A production self-hosted attestation MUST bind the approved serving workload/image, model-artefact digest, deployment identity and egress policy. The serving workload MUST have no route to public inference providers.
5. **Deterministic policy is authoritative.** The model MAY interpret, classify, explain, rank and propose. Deterministic code and database policies remain authoritative for identity, tenant isolation, scope, validation, approvals and execution.
6. **Advisory is not authority.** Model output is untrusted data. It MUST NOT itself authorise a ticket closure, topology/network write, final dispatch assignment, authoritative audit write, policy change, production release or release-hold removal.
7. **Provenance follows claims.** Material operational claims SHOULD preserve source reference, observation time, freshness, tenant/scope and verification state. Generated text MUST remain distinguishable from source facts.
8. **Fail closed, degrade honestly.** Missing model, invalid attestation, policy conflict, stale required evidence, or unavailable authorisation MUST disable the affected operation or return a clearly degraded state. It MUST NOT fabricate success or silently switch to a public model.
9. **No live self-modification.** The model MUST NOT rewrite its own production instructions, weights, policy, source code, allowlists or deployment configuration in place. Improvements are proposed changes subject to reproducible evaluation, review, approval and release gates.
10. **Least privilege at every data boundary.** Retrieval, tools, event subscriptions, logs, exports and cached results MUST enforce the caller's current tenant and resource scope. A prompt is not a security boundary.
11. **Replaceable inference runtime.** Domain rules and authorisation MUST not depend on a particular model or vendor API. Model/runtime replacement occurs behind a versioned internal contract.
12. **Evidence before capability claims.** Capability registries MUST distinguish source implementation, test evidence, a running self-hosted integration, and buyer/production acceptance.

## 3. Three governed planes

### 3.1 Product intelligence

Supports operational explanation, anomaly triage, incident context, multilingual assistance, meeting notes, document understanding and decision support. Each feature declares purpose, authorised inputs, output schema, grounding rules, risk tier, latency/resource budget and abstention conditions.

### 3.2 Engineering intelligence

Provides a FiberOS-controlled workspace for repository understanding, requirement decomposition, test proposals, failure analysis and change recommendations. It is a development capability, not production authority. Work MUST occur in an isolated worktree/branch with the base commit recorded; changed files and test results must be reviewable. It MUST NOT push directly to `main`, merge its own changes, deploy, or mutate production data. No hosted agent may be a required runtime dependency.

### 3.3 Governance and evidence

Tracks model/artifact inventory, licences, digests, attestations, policy versions, evaluations, approved capabilities, audit events, cost/latency/error measures and rollback references. Cryptographic integrity proves which bytes were measured; it does not prove that an answer is correct.

## 4. Target logical architecture

Start as a modular system with explicit contracts. Do not split every module into microservices until measured isolation, scaling or failure-containment requirements justify it.

- **Identity and policy boundary:** verified principal, tenant, organisational/geographic scope, purpose, data classification, current membership, action permission and revocation epoch.
- **Domain/truth layer:** existing PostgreSQL/Neon-backed records remain the source of truth for persistent operational data. Derived facts, hypotheses, summaries and model outputs are separately typed and never overwrite source evidence automatically.
- **Retrieval boundary:** a server-side query broker invokes allowlisted domain queries after authorisation and returns only fields/rows the principal may read. Model/user text MUST NOT become unrestricted SQL or filesystem paths.
- **Inference boundary:** internal model serving behind a private versioned contract with bounded input/output, deadlines, concurrency quotas, version pinning, health/readiness and timeout/degraded states.
- **Action boundary:** narrow typed tools, authorisation at execution time, idempotency keys where applicable, precondition checks, approval tiers, audit and post-action verification from the authoritative subsystem.
- **Event boundary:** persist a state change and its outbox event atomically where they share a transaction. Delivery is retryable and consumers are idempotent; a cache or broker is not durable truth.
- **Evidence boundary:** tamper-evident audit design, versioned model/evaluation evidence, and release provenance bound to the exact source/model/runtime artefacts.
- **Network boundary:** private routing, explicit destination allowlists, deny-by-default egress, workload identity, TLS as appropriate and observable denied connections. URL validation alone is not the egress control.

## 5. Inference request/result contract

Each request must be attributable to a service identity and, when user-initiated, to a verified user/tenant context. The internal contract SHOULD carry request/correlation IDs; feature and purpose; policy version and scope decision reference; approved model ID, digest and serving build; minimised, bounded input with provenance references; output schema/version; deadline and risk tier; and an explicit outcome such as complete, abstained, rejected, timed out, unavailable or degraded.

Bearer tokens, cookies, passwords, API keys, private keys and unnecessary personal data MUST be rejected before context construction, not merely redacted from a final answer. Model output must pass schema and safety validation before any consumer uses it.

## 6. Memory, learning and improvement

FiberOS memory is persistent, typed, source-attributed domain data—not unverified model recollection. A memory write records source, effective time, verification state, tenant, retention class and conflict policy. Conflicting claims remain conflicts until a defined resolver establishes precedence; generated summaries do not become authoritative facts.

Feedback MAY contribute to improvement only through an approved privacy-reviewed pipeline. It MUST NOT silently train or update the live model. Fine-tuning or retrieval-index refresh requires a dataset snapshot, licence/consent basis, data-minimisation review, contamination checks, evaluation baseline, signed artefact digest and rollback path. Tenant data MUST NOT cross tenant boundaries.

## 7. Risk tiers and authority

| Tier | Examples | Required control |
| --- | --- | --- |
| T0 — read-only assistance | Explanation or summary of authorised material | Server-side retrieval policy, provenance, limits and honest uncertainty |
| T1 — proposed change | Draft incident summary, suggested task or assignment | Structured proposal; human review before authoritative state changes |
| T2 — bounded low-risk action | Explicitly approved, reversible workflow action | Tool allowlist, current authorisation, preconditions, idempotency, audit and post-action verification |
| T3 — high-impact action | Network/topology mutation, privilege change, production migration/deploy, financial/legal commitment | No model-only execution; separate authenticated authority and independent approval as required |

A meeting host, department head or model does not acquire unrelated privileges through context or role labels. A confidence score is not an approval token.

## 8. Threat model and required abuse cases

The implementation test suite must cover: prompt injection in messages/attachments/transcripts/retrieved documents/vendor fields; cross-tenant and out-of-scope retrieval through indirect references, summaries, counts, embeddings and exports; revoked membership while streams or signed links remain active; endpoint misconfiguration, conflicting variables, public DNS, DNS rebinding, redirects, internal proxy forwarding and public egress; model/tool output containing forbidden actions, SQL, shell commands, URLs, secret-shaped fields or invalid schemas; duplicated, reordered, delayed and replayed requests; stale/contradictory evidence; model overload, timeout, corrupt artefact, inadequate hardware and partial recovery; poisoned feedback or unauthorised model updates; and sensitive data in logs, traces, crash reports or support bundles.

Every case needs an expected denial/degraded result and must fail if an unverified operation is reported as successful.

## 9. Model supply chain and operations

Before admission, record and verify upstream project/source, immutable model revision, SHA-256 digests, licence/use restrictions, weights provenance, tokenizer/runtime versions, serving image digest, limitations, evaluation profile and approved deployment target. Store approved artefacts in FiberOS-controlled storage with access control and integrity verification.

The model-serving process MUST NOT receive credentials for direct database writes, cloud control, repository writes, shell access or production deployment. CPU/GPU/memory, request size, queue depth, concurrency and runtime must be bounded so model exhaustion cannot take down the API, database, telephony or other critical services.

Monitor latency percentiles, queue depth, timeouts, errors/abstentions, resource saturation, denied egress, model/version drift, retrieval failures and policy rejections. Do not log full prompts by default. Diagnostic capture requires a documented purpose and retention policy.

## 10. Standards alignment

Maintain a requirement-to-control-to-test matrix against applicable revisions of:

- NIST SP 800-207, Zero Trust Architecture;
- NIST SP 800-218, Secure Software Development Framework;
- NIST AI RMF 1.0 and Generative AI Profile (NIST AI 600-1);
- OWASP Application Security Verification Standard and OWASP Top 10 for LLM Applications;
- OpenTelemetry semantic conventions for traces, metrics and logs;
- applicable PostgreSQL row-security and privilege guidance;
- WCAG 2.2 AA for delivered user interfaces.

Alignment does not constitute certification. A requirement is complete only when the applicable version, enforcement point, test/evidence artefact, result and residual risk are recorded.

## 11. Implementation sequence and release gates

**Phase 0 — Baseline integrity.** Confirm exact `main` head, provenance generator, CI status, production database identity and the open RLS/security review. No production changes. Unresolved production database identity and the release hold take precedence over feature work.

**Phase 1 — Contracts and threat model.** Approve request/result schemas, risk tiers, authority model, model inventory, egress policy, data classes, retention, audit and failure semantics.

**Phase 2 — Self-hosted inference proof.** In isolated non-production, prove model digest and serving image; deny public egress at network layer; reject unapproved destinations; and demonstrate that unavailable local inference never falls back to an external service.

**Phase 3 — Grounded read-only vertical slice.** Implement one bounded operational-assistance path that retrieves only authorised facts, preserves provenance, abstains on stale/contradictory evidence and passes adversarial tenant/scope tests.

**Phase 4 — Governed actions and events.** Add typed tools, approval checks, transactional outbox, idempotency/replay tests, revocation, action receipts and post-action verification. High-impact actions remain outside model authority.

**Phase 5 — Feature integration.** Every chat, contact-centre, meeting, search/filter, GIS and operations feature declares its AI contract before implementation and is admitted independently. Any non-AI external telephony/media provider must be declared and verified separately.

**Phase 6 — Evaluation and resilience.** Pin a non-production build and run quality, prompt-injection, tenant-isolation, egress, load, fault-injection, restore, rollback, accessibility and cost tests. Set SLO/RTO/RPO after representative workload baselines exist.

**Release gate:** no production admission until exact-commit source CI is green; model/evaluation evidence is verified; public AI egress denial is demonstrated; production database identity and migration state are resolved; authorization passes adversarial runtime tests; and a human owner accepts residual risks.

## 12. Immediate repository constraints

- Do not merge or rewrite the area-supervisor RLS change solely because a different branch passes tests; assess its exact head and retain the separate production hold.
- Do not apply a new Neon production migration as part of this architecture step.
- Keep the existing AI service advisory-only until typed action authority is separately reviewed.
- Do not infer self-hosting from a configured URL or private address alone.
- This document does not implement model serving, enforce network egress by itself, train a model or certify production. It defines the required architecture and acceptance evidence for subsequent implementation.

## 13. Definition of done

This architecture is ready to guide implementation when every normative rule maps to (a) a component/owner, (b) an enforcement point, (c) a negative test, (d) observable evidence and (e) a release gate. The first implementation PR must add executable checks rather than leave these commitments documentation-only.
