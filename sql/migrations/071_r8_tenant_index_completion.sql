-- FiberOS R8.1 pre-DB performance hardening: complete tenant scoping indexes.
-- These indexes do not change authorization semantics; they prevent tenant-scoped
-- RLS queries from degrading into repeated full-table scans as data grows.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_contractor_qualifications_tenant_id ON contractor_qualifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contractor_work_authorizations_tenant_id ON contractor_work_authorizations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contractor_work_measurements_tenant_id ON contractor_work_measurements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_dashboard_contracts_tenant_id ON enterprise_dashboard_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_policies_tenant_id ON enterprise_policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ftth_customer_orders_tenant_id ON ftth_customer_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ftth_duct_segments_tenant_id ON ftth_duct_segments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ftth_programs_tenant_id ON ftth_programs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ftth_splices_tenant_id ON ftth_splices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ftth_work_package_tasks_tenant_id ON ftth_work_package_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_cycle_events_tenant_id ON payment_cycle_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rework_case_events_tenant_id ON rework_case_events(tenant_id);

COMMIT;
