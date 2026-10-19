-- 178_close_cross_tenant_fk_gaps.sql
-- Exhaustive tenant-FK audit (adversarial-tenant-fk-mutation-audit) accepts only
-- BLOCKED_TENANT_ENFORCEMENT / equivalent failures. The following FKs still allow
-- cross-tenant mutations under origin session_replication_role. Attach the
-- fail-closed fiberos_guard_fk_tenant_match guard from migration 170.
BEGIN;

-- commercial_measurement_reconciliation → measurements / invoices
DROP TRIGGER IF EXISTS trg_commercial_recon_measurement_tenant ON public.commercial_measurement_reconciliation;
CREATE TRIGGER trg_commercial_recon_measurement_tenant
  BEFORE INSERT OR UPDATE OF measurement_id, tenant_id
  ON public.commercial_measurement_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('contractor_work_measurements', 'id', 'measurement_id');

DROP TRIGGER IF EXISTS trg_commercial_recon_invoice_tenant ON public.commercial_measurement_reconciliation;
CREATE TRIGGER trg_commercial_recon_invoice_tenant
  BEFORE INSERT OR UPDATE OF invoice_id, tenant_id
  ON public.commercial_measurement_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('invoices', 'id', 'invoice_id');

-- fault_jobs → technicians
DROP TRIGGER IF EXISTS trg_fault_jobs_technician_tenant ON public.fault_jobs;
CREATE TRIGGER trg_fault_jobs_technician_tenant
  BEFORE INSERT OR UPDATE OF technician_id, tenant_id
  ON public.fault_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('technicians', 'id', 'technician_id');

-- installation_jobs → customer_accounts / services / technicians
DROP TRIGGER IF EXISTS trg_installation_jobs_customer_tenant ON public.installation_jobs;
CREATE TRIGGER trg_installation_jobs_customer_tenant
  BEFORE INSERT OR UPDATE OF customer_account_id, tenant_id
  ON public.installation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('customer_accounts', 'id', 'customer_account_id');

DROP TRIGGER IF EXISTS trg_installation_jobs_service_tenant ON public.installation_jobs;
CREATE TRIGGER trg_installation_jobs_service_tenant
  BEFORE INSERT OR UPDATE OF service_id, tenant_id
  ON public.installation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('services', 'id', 'service_id');

DROP TRIGGER IF EXISTS trg_installation_jobs_technician_tenant ON public.installation_jobs;
CREATE TRIGGER trg_installation_jobs_technician_tenant
  BEFORE INSERT OR UPDATE OF technician_id, tenant_id
  ON public.installation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('technicians', 'id', 'technician_id');

-- network_asset_semantics → network_assets
DROP TRIGGER IF EXISTS trg_network_asset_semantics_asset_tenant ON public.network_asset_semantics;
CREATE TRIGGER trg_network_asset_semantics_asset_tenant
  BEFORE INSERT OR UPDATE OF asset_id, tenant_id
  ON public.network_asset_semantics
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets', 'id', 'asset_id');

-- network_service_path_versions → evidence / services
DROP TRIGGER IF EXISTS trg_nspv_evidence_tenant ON public.network_service_path_versions;
CREATE TRIGGER trg_nspv_evidence_tenant
  BEFORE INSERT OR UPDATE OF evidence_id, tenant_id
  ON public.network_service_path_versions
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('evidence', 'id', 'evidence_id');

DROP TRIGGER IF EXISTS trg_nspv_service_tenant ON public.network_service_path_versions;
CREATE TRIGGER trg_nspv_service_tenant
  BEFORE INSERT OR UPDATE OF service_id, tenant_id
  ON public.network_service_path_versions
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('services', 'id', 'service_id');

-- portal_order_work_package_links → ftth_work_packages / portal_service_orders
DROP TRIGGER IF EXISTS trg_portal_owp_links_wp_tenant ON public.portal_order_work_package_links;
CREATE TRIGGER trg_portal_owp_links_wp_tenant
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id
  ON public.portal_order_work_package_links
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_portal_owp_links_order_tenant ON public.portal_order_work_package_links;
CREATE TRIGGER trg_portal_owp_links_order_tenant
  BEFORE INSERT OR UPDATE OF service_order_id, tenant_id
  ON public.portal_order_work_package_links
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('portal_service_orders', 'id', 'service_order_id');

-- portal_service_orders → services
DROP TRIGGER IF EXISTS trg_portal_service_orders_service_tenant ON public.portal_service_orders;
CREATE TRIGGER trg_portal_service_orders_service_tenant
  BEFORE INSERT OR UPDATE OF service_id, tenant_id
  ON public.portal_service_orders
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('services', 'id', 'service_id');

COMMIT;
