-- Wave 16: Integration readiness foundation
-- No external provider connection is created by this migration.
-- This migration only provides operational documentation boundary.

create index if not exists idx_event_processing_attempts_tenant_status_updated
on event_processing_attempts(tenant_id, status, updated_at);
