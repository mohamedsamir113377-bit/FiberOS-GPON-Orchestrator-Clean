# Multi-Path Reality Acquisition and Incident Command

Acquisition policy is configurable at tenant/company, site, service and asset scope.

Modes: DIRECT_READ_ONLY (buyer-authorized NMS/OLT/OSS/OTDR), HYBRID (read-only first, field fallback), FIELD_ONLY (no system access), OFFLINE_FIELD, and MANUAL_DECLARED advisory-only.

A field power-meter photo is geo/visual proof only. It never becomes numeric RX authority; an OTDR-screen photo is not a parsed OTDR trace. Runtime adapter verification, object storage verification, buyer KMS/HSM, and PostgreSQL/PostGIS/RLS admission remain explicit external proof boundaries.

Policy precedence: service > asset > site > tenant. Incident impact is based on explicit incident links and persisted events only; no silent proximity/topology inference.

Operational traceability: a tenant-scoped read-only trace endpoint can reconstruct the persisted Customer Conversation -> canonical Contact Center Event -> Incident Command link -> Evidence Vault link chain. The trace reports correlation/causation integrity explicitly and never creates incidents, evidence, provider connectivity, telephony state, or storage verification.

Contact-center handoff events use the canonical `fiberos.operational-event.v1` envelope and carry causation from the conversation-created event when applicable. Event-to-incident and event-to-evidence relationships are append-only, tenant-bound, idempotent, and require pre-existing records.
