-- FiberOS Alpha50-prep — outbox retry scheduling.
-- No delivery provider is implied by this migration. It only makes retry timing
-- authoritative and prevents an unavailable provider from causing a hot loop.

alter table outbox_events
  add column if not exists next_attempt_at timestamptz;

update outbox_events
set next_attempt_at = coalesce(next_attempt_at, created_at)
where publish_status = 'pending';

create index if not exists idx_outbox_ready
  on outbox_events(publish_status, next_attempt_at, created_at)
  where publish_status = 'pending';

comment on column outbox_events.next_attempt_at is
  'Earliest timestamp at which a pending event may be claimed. Provider delivery policy remains external to the database.';
