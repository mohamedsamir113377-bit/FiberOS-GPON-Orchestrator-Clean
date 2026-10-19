-- 021_measurement_provenance.sql
-- Alpha 43: State-Authority Trust Boundary Closure — provenance labeling.
-- FiberOS migration — apply in order, after 020.
--
-- This migration does NOT close the measurement-provenance gap by itself.
-- It only stops the schema from implying more trust than the system
-- actually has: `source` records a claimed origin type, not proof of it.
-- `provenance_trust` makes that distinction explicit so downstream readers
-- (QC, reports, audits) don't mistake "source = nms_poll" for "cryptographically
-- confirmed to have come from the OLT poller".
--
-- Real closure of this gap requires a signed adapter callback from the NMS
-- poller (or a paired optical-power-meter session for field readings) that
-- can independently attest a reading. That is tracked as follow-up work,
-- not delivered here.

alter table optical_measurements
  add column if not exists provenance_trust text
  not null default 'CLIENT_DECLARED'
  check (provenance_trust in ('CLIENT_DECLARED', 'NMS_POLLED_UNVERIFIED', 'NMS_POLLED_ATTESTED'));

comment on column optical_measurements.provenance_trust is
  'CLIENT_DECLARED = self-reported number, no independent verification. '
  'NMS_POLLED_UNVERIFIED = client tagged this nms_poll, but it is not yet '
  'cryptographically tied to a real OLT poll record. '
  'NMS_POLLED_ATTESTED = reserved for a future signed adapter callback that '
  'proves the reading came from the OLT poller. This column documents a '
  'known trust gap; it does not close it.';

-- Speeds up the cross-ticket photo content-hash reuse check performed in
-- services/api/src/routes/fieldClose.js. Intentionally not a unique
-- constraint: legitimate re-submission/retry flows may need the same hash
-- to appear more than once for the SAME ticket (idempotent replay).
create index if not exists idx_evidence_content_hash on evidence (content_hash);
