# FiberOS Ultra — Reference → Capability Gap Matrix (2026-10-09)

Scope: the 16-reference reading list expanded to the 21 distinct titles actually
present, mapped to concrete capability gaps and to the code that now closes them.

Honesty boundary: copyrighted books are **not** reproduced. Mapping uses public
tables of contents, publisher pages and freely available standards (ITU-T,
FTTH Council Europe). Titles that could not be verified are marked
`UNVERIFIED` and no content is attributed to them.

| # | Reference (as listed) | Verified? | Concept carried into code | Gap before | Closed by |
|---|---|---|---|---|---|
| 1 | FTTH Handbook, Ed. 9 (FTTH Council Europe) | Yes | materials/standards, PON fault taxonomy, splitter/splice limits | partially present | `packages/engineering` (existing) + `packages/pon-standards-ext` |
| 2 | FTTx Networks — Technology Implementation and Operation (J. Farmer) | Yes | active equipment / GPON card framing, budget classes | partial | `packages/pon-standards-ext` |
| 3 | ITU Handbook — Optical fibres, cables and systems | Yes | attenuation classes, ODN budget A/B/C | present | `packages/engineering/odnPowerBudget` (existing) |
| 4 | FTTH reference (Arabic) | UNVERIFIED (generic) | — | n/a | — |
| 5 | Fibre installation & splicing (Arabic) | UNVERIFIED (generic) | splice-loss limits | present | `packages/engineering/otdrTracePolicy` (existing) |
| 6 | Cable-laying field notes (Arabic set) | UNVERIFIED (generic) | — | n/a | — |
| 7 | Fiber Optic (A. M. Tom) | UNVERIFIED | simplified optical systems | present | `packages/ftth-measurements` (existing) |
| 8 | Enterprise Multi-Tenancy: Architecture and Security (2026) | **NOT FOUND — likely fabricated** | isolation tiers, noisy-neighbour budget, tenant key scope | **missing** | `packages/tenant-isolation-model` |
| 9 | Building an Event-Driven Data Mesh (A. Bellemare, O'Reilly) | Yes (real title) | partition keys, ordering, idempotent consumption, replay, schema compat | **missing** | `packages/event-stream-fabric` |
| 9b | "Building Event-Driven Production Systems" | **NOT FOUND** | — | n/a | — |
| 10 | Designing Data-Intensive Applications (M. Kleppmann) | Yes | optimistic version CAS, interval exclusion, deadlock graph, isolation policy | **missing** | `packages/concurrency-control` |
| 11 | API Security in Action (N. Madden, Manning) | Yes | OWASP API Top 10, BOLA/BFLA, SSRF, token binding | partial | `packages/api-threat-model` |
| 12 | PostGIS in Action, 3rd Ed. (Obe & Hsu, Manning) | Yes | spatial indexing, corridor buffers, linear referencing | present | `packages/sovereign-gis` (existing) |
| 13 | AI-Powered Digital Twins (H. Nelson, Wiley) | Yes | 12-layer twin architecture, Zero-Trust twin governance | **missing** | `packages/digital-twin-layers` |
| 14 | Digital Twins: Core Principles and AI Integration (Tekinerdogan, MK) | Yes | model/state layers, simulation drift vs. reality | **missing** | `packages/digital-twin-layers` |
| 15 | LLM Engineer's Handbook (Iusztin & Labonne, Packt) | Yes | local retrieval + rank fusion, citation-bound answers | partial | `packages/sovereign-rag` |
| 16 | "Building Search Applications with GPT-4 and Beyond" | **NOT FOUND** | RAG/search pipeline | **missing** | `packages/sovereign-rag` |
| 17 | "Data Pipelines for Real-Time LLMs" | **NOT FOUND** | real-time LLM data pipeline | partial (outbox exists) | `packages/event-stream-fabric` |
| 18 | Mobile Speech and Advanced Natural Language Solutions (Springer) | Yes | multilingual IVR/contact-centre NLU | present | `packages/multilingual-contact-center` (existing, 84 locales) |
| 19 | Logistics and Supply Chain Management, 6th Ed. (M. Christopher, Pearson) | Yes | EOQ, safety stock, ROP, ABC/XYZ, demand forecast | **missing** | `packages/predictive-inventory` |
| 20 | Operations Management: Sustainability and Supply Chain Management (Heizer/Render, Pearson) | Yes | routing, first-time-right, zero re-visit | **missing** | `packages/field-route-optimization` |
| 21 | Financial Forecasting, Analysis and Modelling (Samonas, Wiley Finance) | Yes | EBITDA, revenue forecast, break-even, DCF, covenants | **missing** | `packages/financial-forecasting` |

## Net new capability packages added on this branch

1. `packages/financial-forecasting` — internal financial engine (EBITDA, forecasting, valuation, covenants).
2. `packages/field-route-optimization` — fleet routing + zero re-visit feasibility.
3. `packages/predictive-inventory` — inventory policy and demand classification.
4. `packages/event-stream-fabric` — event-driven data-mesh primitives.
5. `packages/concurrency-control` — strict concurrency and conflict control.
6. `packages/sovereign-rag` — fully local retrieval with citation-bound answers.
7. `packages/pon-standards-ext` — GPON → XG(S)-PON → 50G-PON standards and budgets.
8. `packages/tenant-isolation-model` — multi-tenant isolation tiers and budgets.
9. `packages/digital-twin-layers` — layered twin architecture and drift checks.
10. `packages/api-threat-model` — OWASP API Top 10 policy evaluation.

All ten are pure, dependency-free domain packages with `node:test` coverage.
