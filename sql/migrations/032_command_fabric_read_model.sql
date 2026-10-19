-- Command Fabric Wave4: no fake data, read model indexes only
create index if not exists idx_incidents_tenant_state on incidents(tenant_id,state);
create index if not exists idx_tickets_tenant_status on tickets(tenant_id,status);
create index if not exists idx_call_sessions_tenant_status on call_sessions(tenant_id,status);
