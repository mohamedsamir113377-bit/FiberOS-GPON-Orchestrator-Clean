-- Wave 11: Operations fabric foundation
-- This migration intentionally does not create synthetic events.
-- It prepares indexing for snapshot-based operational reads.

create index if not exists idx_incidents_tenant_state_updated
on incidents(tenant_id,state,updated_at desc);

create index if not exists idx_tickets_tenant_status_updated
on tickets(tenant_id,status,updated_at desc);

create index if not exists idx_call_sessions_tenant_updated
on call_sessions(tenant_id,started_at desc);
