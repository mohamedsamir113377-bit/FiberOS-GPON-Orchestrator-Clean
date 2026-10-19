-- Wave 14: Secure event runtime boundary foundation
-- No broker, publisher, or live consumer is claimed by this migration.

alter table event_processing_attempts
  add column if not exists validated_at timestamptz,
  add column if not exists idempotency_key text;

create unique index if not exists idx_event_processing_attempts_idempotency
on event_processing_attempts(tenant_id,idempotency_key)
where idempotency_key is not null;
