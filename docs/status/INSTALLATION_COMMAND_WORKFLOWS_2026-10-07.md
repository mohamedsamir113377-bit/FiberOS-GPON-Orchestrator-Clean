# Installation Command Workflows — 2026-10-07

## Scope

This branch adds a real data-backed installation command surface with three distinct workflows:

1. **NEW_INSTALLATION** — customer intake, call-center verification, appointment scheduling, nearest-technician dispatch, technician acceptance, field evidence, optical reading, customer feedback, and completion.
2. **MIGRATION** — the same operational chain, plus a visible work-order issue date and migration completion deadline.
3. **ROUTER_INSTALLATION** — the same operational chain, but dispatch is blocked until call-center verification; router serial/model/MAC and label-scan/video evidence are recorded.

## Customer intake

The intake records:

- service / landline number;
- customer/company name;
- internet provider name;
- two follow-up mobile numbers;
- identity type and identity number;
- detailed address: region, street, building, floor, apartment;
- cabinet and box identifiers;
- customer site coordinates;
- optional SLA duration/deadline;
- migration work-order date/deadline when applicable.

Identity numbers and captured identity images are encrypted before database persistence when the FIBEROS_PII_KEY secret is configured. The repository does not expose a plaintext identity-number column.

## Dispatch and customer tracking

The server selects an active technician in the same tenant with a current location and uses PostGIS distance ordering. No technician location is invented when no live position exists.

A WhatsApp notification record can be queued with a tracking path. **Provider delivery is not claimed** unless a real messaging provider is configured and returns evidence. The database status therefore remains UNVERIFIED by default.

## Field evidence

The technician can record:

- drop/fiber installation video evidence;
- router installation video;
- router label scan;
- optical power reading;
- site photo;
- customer acceptance.

Evidence is bound to the job, tenant, actor, timestamp, optional GPS, and SHA-256 content hash.

Browser-side video capture currently calculates and submits the evidence hash. Permanent binary video storage requires a configured evidence/object-storage reference; the UI does not pretend that a local browser recording is already a durable server object.

## Completion gates

New installation and migration require:

- drop-cable video evidence;
- optical power evidence;
- customer acceptance.

Router installation additionally requires:

- router label scan;
- router installation video;
- optical power evidence;
- customer acceptance.

## Security boundary

Migration 125 enables FORCE RLS on all installation workflow tables and applies the existing tenant predicate contract.

This is source-level implementation evidence. Live PostgreSQL 18/PostGIS 3.6, RLS exploitation, identity provider, WhatsApp provider, object storage, and production GPS/telemetry still require real deployment evidence.

## No synthetic operational claims

The workflow never fabricates:

- customer coordinates;
- technician locations;
- technician availability;
- WhatsApp delivery;
- field completion;
- optical readings;
- video persistence.

Those values must come from the browser/device, database, or configured external provider.

## Migration

125_installation_command_workflows.sql
126_installation_evidence_integrity_and_acceptance.sql
127_installation_lifecycle_db_authority.sql
128_public_tracking_rls_bridge.sql

Migration 127 makes the lifecycle transition graph database-enforced and gives the SECURITY DEFINER router guard a SELECT-only owner policy under FORCE RLS. Migration 128 adds a narrowly token-bound `fiberos_app` RLS bridge for public technician/name/position visibility without granting general tenant reads. The production migration registry and checksum ledger are reconciled through migration 001–128.
