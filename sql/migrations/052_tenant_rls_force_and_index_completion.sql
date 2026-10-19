-- FiberOS migration 052: tenant RLS FORCE + tenant index completion
-- Security hardening: all migration-defined tenant-scoped tables are forced under RLS.
-- Runtime validation remains required before production use.

alter table user_preferences enable row level security;
alter table user_preferences force row level security;
create index if not exists idx_user_preferences_tenant_id on user_preferences(tenant_id);

alter table truth_facts enable row level security;
alter table truth_facts force row level security;
create index if not exists idx_truth_facts_tenant_id on truth_facts(tenant_id);

alter table data_conflicts enable row level security;
alter table data_conflicts force row level security;
create index if not exists idx_data_conflicts_tenant_id on data_conflicts(tenant_id);

alter table decision_certificates enable row level security;
alter table decision_certificates force row level security;
create index if not exists idx_decision_certificates_tenant_id on decision_certificates(tenant_id);

alter table decision_executions enable row level security;
alter table decision_executions force row level security;
create index if not exists idx_decision_executions_tenant_id on decision_executions(tenant_id);

alter table decision_rollbacks enable row level security;
alter table decision_rollbacks force row level security;
create index if not exists idx_decision_rollbacks_tenant_id on decision_rollbacks(tenant_id);

alter table model_predictions enable row level security;
alter table model_predictions force row level security;
create index if not exists idx_model_predictions_tenant_id on model_predictions(tenant_id);

alter table security_events enable row level security;
alter table security_events force row level security;
create index if not exists idx_security_events_tenant_id on security_events(tenant_id);

alter table sync_operations enable row level security;
alter table sync_operations force row level security;
create index if not exists idx_sync_operations_tenant_id on sync_operations(tenant_id);

alter table fiber_cables enable row level security;
alter table fiber_cables force row level security;
create index if not exists idx_fiber_cables_tenant_id on fiber_cables(tenant_id);

alter table fiber_cores enable row level security;
alter table fiber_cores force row level security;
create index if not exists idx_fiber_cores_tenant_id on fiber_cores(tenant_id);

alter table fiber_core_links enable row level security;
alter table fiber_core_links force row level security;
create index if not exists idx_fiber_core_links_tenant_id on fiber_core_links(tenant_id);

alter table physical_topology_edges enable row level security;
alter table physical_topology_edges force row level security;
create index if not exists idx_physical_topology_edges_tenant_id on physical_topology_edges(tenant_id);

alter table engineering_calibrations enable row level security;
alter table engineering_calibrations force row level security;
create index if not exists idx_engineering_calibrations_tenant_id on engineering_calibrations(tenant_id);

alter table engineering_models enable row level security;
alter table engineering_models force row level security;
create index if not exists idx_engineering_models_tenant_id on engineering_models(tenant_id);

alter table engineering_parameters enable row level security;
alter table engineering_parameters force row level security;
create index if not exists idx_engineering_parameters_tenant_id on engineering_parameters(tenant_id);

alter table field_close_idempotency enable row level security;
alter table field_close_idempotency force row level security;
create index if not exists idx_field_close_idempotency_tenant_id on field_close_idempotency(tenant_id);

alter table inventory_items enable row level security;
alter table inventory_items force row level security;
create index if not exists idx_inventory_items_tenant_id on inventory_items(tenant_id);

alter table inventory_transactions enable row level security;
alter table inventory_transactions force row level security;
create index if not exists idx_inventory_transactions_tenant_id on inventory_transactions(tenant_id);

alter table customer_accounts enable row level security;
alter table customer_accounts force row level security;
create index if not exists idx_customer_accounts_tenant_id on customer_accounts(tenant_id);

alter table invoices enable row level security;
alter table invoices force row level security;
create index if not exists idx_invoices_tenant_id on invoices(tenant_id);

alter table routing_requests enable row level security;
alter table routing_requests force row level security;
create index if not exists idx_routing_requests_tenant_id on routing_requests(tenant_id);

alter table call_sessions enable row level security;
alter table call_sessions force row level security;
create index if not exists idx_call_sessions_tenant_id on call_sessions(tenant_id);

alter table call_events enable row level security;
alter table call_events force row level security;
create index if not exists idx_call_events_tenant_id on call_events(tenant_id);

alter table incidents enable row level security;
alter table incidents force row level security;
create index if not exists idx_incidents_tenant_id on incidents(tenant_id);

alter table incident_events enable row level security;
alter table incident_events force row level security;
create index if not exists idx_incident_events_tenant_id on incident_events(tenant_id);

alter table dispatch_requests enable row level security;
alter table dispatch_requests force row level security;
create index if not exists idx_dispatch_requests_tenant_id on dispatch_requests(tenant_id);

alter table telco_webhook_providers enable row level security;
alter table telco_webhook_providers force row level security;
create index if not exists idx_telco_webhook_providers_tenant_id on telco_webhook_providers(tenant_id);

alter table contact_center_agent_presence enable row level security;
alter table contact_center_agent_presence force row level security;
create index if not exists idx_contact_center_agent_presence_tenant_id on contact_center_agent_presence(tenant_id);

alter table event_outbox_contract enable row level security;
alter table event_outbox_contract force row level security;
create index if not exists idx_event_outbox_contract_tenant_id on event_outbox_contract(tenant_id);

alter table event_processing_attempts enable row level security;
alter table event_processing_attempts force row level security;
create index if not exists idx_event_processing_attempts_tenant_id on event_processing_attempts(tenant_id);

alter table call_queue_assignments enable row level security;
alter table call_queue_assignments force row level security;
create index if not exists idx_call_queue_assignments_tenant_id on call_queue_assignments(tenant_id);

