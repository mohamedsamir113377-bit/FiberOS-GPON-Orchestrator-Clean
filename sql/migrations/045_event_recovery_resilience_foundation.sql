-- Wave 15: Event recovery resilience foundation
-- No external queue or broker assumed.
create index if not exists idx_event_processing_attempts_recovery
on event_processing_attempts (tenant_id, status, created_at);
