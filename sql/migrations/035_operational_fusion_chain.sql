-- Operational Fusion Chain foundation
-- Read-model only. No autonomous actions.
create index if not exists idx_call_sessions_tenant_customer on call_sessions(tenant_id, customer_ref);
create index if not exists idx_tickets_tenant_service on tickets(tenant_id, service_id);
create index if not exists idx_incidents_tenant_asset on incidents(tenant_id, primary_asset_id);
