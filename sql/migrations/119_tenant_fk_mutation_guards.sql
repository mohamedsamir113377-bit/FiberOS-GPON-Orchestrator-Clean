-- 119_tenant_fk_mutation_guards.sql
-- Defense-in-depth: BEFORE INSERT/UPDATE triggers that reject cross-tenant
-- foreign-key values even when RLS is bypassed (session_replication_role /
-- row_security=off). Addresses FAIL_CROSS_TENANT_MUTATION_ACCEPTED findings
-- from scripts/buyer-acceptance/adversarial-tenant-fk-mutation-audit.js.

BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_guard_fk_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  parent_col   text := TG_ARGV[1];
  child_col    text := TG_ARGV[2];
  ref_id       uuid;
  ref_tenant   uuid;
  sql          text;
BEGIN
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT ($1).%I', child_col) INTO ref_id USING NEW;
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;

  sql := format(
    'SELECT tenant_id FROM public.%I WHERE %I = $1 LIMIT 1',
    parent_table, parent_col
  );
  EXECUTE sql INTO ref_tenant USING ref_id;

  IF ref_tenant IS NULL THEN
    RETURN NEW;
  END IF;

  IF ref_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_%_%', upper(TG_TABLE_NAME), upper(child_col)
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fiberos_guard_fk_tenant_match() IS
  'Generic cross-tenant FK guard. TG_ARGV: parent_table, parent_pk_col, child_fk_col.';


DROP TRIGGER IF EXISTS trg_alarm_signals_asset_id_tenant_fk ON public.alarm_signals;
CREATE TRIGGER trg_alarm_signals_asset_id_tenant_fk
  BEFORE INSERT OR UPDATE OF asset_id, tenant_id ON public.alarm_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets', 'id', 'asset_id');

DROP TRIGGER IF EXISTS trg_contractor_qualifications_contractor_id_tenant_fk ON public.contractor_qualifications;
CREATE TRIGGER trg_contractor_qualifications_contractor_id_tenant_fk
  BEFORE INSERT OR UPDATE OF contractor_id, tenant_id ON public.contractor_qualifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('contractor_entities', 'id', 'contractor_id');

DROP TRIGGER IF EXISTS trg_contractor_work_authorizations_contractor_id_tenant_fk ON public.contractor_work_authorizations;
CREATE TRIGGER trg_contractor_work_authorizations_contractor_id_tenant_fk
  BEFORE INSERT OR UPDATE OF contractor_id, tenant_id ON public.contractor_work_authorizations
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('contractor_entities', 'id', 'contractor_id');

DROP TRIGGER IF EXISTS trg_contractor_work_authorizations_work_package_id_tenant_fk ON public.contractor_work_authorizations;
CREATE TRIGGER trg_contractor_work_authorizations_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.contractor_work_authorizations
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_contractor_work_measurements_contractor_id_tenant_fk ON public.contractor_work_measurements;
CREATE TRIGGER trg_contractor_work_measurements_contractor_id_tenant_fk
  BEFORE INSERT OR UPDATE OF contractor_id, tenant_id ON public.contractor_work_measurements
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('contractor_entities', 'id', 'contractor_id');

DROP TRIGGER IF EXISTS trg_contractor_work_measurements_work_package_id_tenant_fk ON public.contractor_work_measurements;
CREATE TRIGGER trg_contractor_work_measurements_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.contractor_work_measurements
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_enterprise_departments_parent_id_tenant_fk ON public.enterprise_departments;
CREATE TRIGGER trg_enterprise_departments_parent_id_tenant_fk
  BEFORE INSERT OR UPDATE OF parent_id, tenant_id ON public.enterprise_departments
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('enterprise_departments', 'id', 'parent_id');

DROP TRIGGER IF EXISTS trg_enterprise_positions_department_id_tenant_fk ON public.enterprise_positions;
CREATE TRIGGER trg_enterprise_positions_department_id_tenant_fk
  BEFORE INSERT OR UPDATE OF department_id, tenant_id ON public.enterprise_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('enterprise_departments', 'id', 'department_id');

DROP TRIGGER IF EXISTS trg_enterprise_scope_grants_position_id_tenant_fk ON public.enterprise_scope_grants;
CREATE TRIGGER trg_enterprise_scope_grants_position_id_tenant_fk
  BEFORE INSERT OR UPDATE OF position_id, tenant_id ON public.enterprise_scope_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('enterprise_positions', 'id', 'position_id');

DROP TRIGGER IF EXISTS trg_evidence_chain_certificates_ticket_id_tenant_fk ON public.evidence_chain_certificates;
CREATE TRIGGER trg_evidence_chain_certificates_ticket_id_tenant_fk
  BEFORE INSERT OR UPDATE OF ticket_id, tenant_id ON public.evidence_chain_certificates
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('tickets', 'id', 'ticket_id');

DROP TRIGGER IF EXISTS trg_fiberos_web_ai_requests_model_id_tenant_fk ON public.fiberos_web_ai_requests;
CREATE TRIGGER trg_fiberos_web_ai_requests_model_id_tenant_fk
  BEFORE INSERT OR UPDATE OF model_id, tenant_id ON public.fiberos_web_ai_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('fiberos_web_ai_models', 'id', 'model_id');

DROP TRIGGER IF EXISTS trg_ftth_activation_events_order_id_tenant_fk ON public.ftth_activation_events;
CREATE TRIGGER trg_ftth_activation_events_order_id_tenant_fk
  BEFORE INSERT OR UPDATE OF order_id, tenant_id ON public.ftth_activation_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_customer_orders', 'id', 'order_id');

DROP TRIGGER IF EXISTS trg_ftth_cable_segments_work_package_id_tenant_fk ON public.ftth_cable_segments;
CREATE TRIGGER trg_ftth_cable_segments_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.ftth_cable_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_ftth_cable_segments_material_item_id_tenant_fk ON public.ftth_cable_segments;
CREATE TRIGGER trg_ftth_cable_segments_material_item_id_tenant_fk
  BEFORE INSERT OR UPDATE OF material_item_id, tenant_id ON public.ftth_cable_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('inventory_items', 'id', 'material_item_id');

DROP TRIGGER IF EXISTS trg_ftth_cable_segments_end_asset_id_tenant_fk ON public.ftth_cable_segments;
CREATE TRIGGER trg_ftth_cable_segments_end_asset_id_tenant_fk
  BEFORE INSERT OR UPDATE OF end_asset_id, tenant_id ON public.ftth_cable_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets', 'id', 'end_asset_id');

DROP TRIGGER IF EXISTS trg_ftth_cable_segments_start_asset_id_tenant_fk ON public.ftth_cable_segments;
CREATE TRIGGER trg_ftth_cable_segments_start_asset_id_tenant_fk
  BEFORE INSERT OR UPDATE OF start_asset_id, tenant_id ON public.ftth_cable_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets', 'id', 'start_asset_id');

DROP TRIGGER IF EXISTS trg_ftth_construction_evidence_work_package_id_tenant_fk ON public.ftth_construction_evidence;
CREATE TRIGGER trg_ftth_construction_evidence_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.ftth_construction_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_ftth_customer_orders_customer_account_id_tenant_fk ON public.ftth_customer_orders;
CREATE TRIGGER trg_ftth_customer_orders_customer_account_id_tenant_fk
  BEFORE INSERT OR UPDATE OF customer_account_id, tenant_id ON public.ftth_customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('customer_accounts', 'id', 'customer_account_id');

DROP TRIGGER IF EXISTS trg_ftth_customer_orders_work_package_id_tenant_fk ON public.ftth_customer_orders;
CREATE TRIGGER trg_ftth_customer_orders_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.ftth_customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_ftth_duct_segments_work_package_id_tenant_fk ON public.ftth_duct_segments;
CREATE TRIGGER trg_ftth_duct_segments_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.ftth_duct_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_ftth_odn_connections_work_package_id_tenant_fk ON public.ftth_odn_connections;
CREATE TRIGGER trg_ftth_odn_connections_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.ftth_odn_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_ftth_odn_connections_from_asset_id_tenant_fk ON public.ftth_odn_connections;
CREATE TRIGGER trg_ftth_odn_connections_from_asset_id_tenant_fk
  BEFORE INSERT OR UPDATE OF from_asset_id, tenant_id ON public.ftth_odn_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets', 'id', 'from_asset_id');

DROP TRIGGER IF EXISTS trg_ftth_odn_connections_to_asset_id_tenant_fk ON public.ftth_odn_connections;
CREATE TRIGGER trg_ftth_odn_connections_to_asset_id_tenant_fk
  BEFORE INSERT OR UPDATE OF to_asset_id, tenant_id ON public.ftth_odn_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets', 'id', 'to_asset_id');

DROP TRIGGER IF EXISTS trg_ftth_odn_connections_from_port_id_tenant_fk ON public.ftth_odn_connections;
CREATE TRIGGER trg_ftth_odn_connections_from_port_id_tenant_fk
  BEFORE INSERT OR UPDATE OF from_port_id, tenant_id ON public.ftth_odn_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_ports', 'id', 'from_port_id');

DROP TRIGGER IF EXISTS trg_ftth_odn_connections_to_port_id_tenant_fk ON public.ftth_odn_connections;
CREATE TRIGGER trg_ftth_odn_connections_to_port_id_tenant_fk
  BEFORE INSERT OR UPDATE OF to_port_id, tenant_id ON public.ftth_odn_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_ports', 'id', 'to_port_id');

DROP TRIGGER IF EXISTS trg_ftth_programs_owner_department_id_tenant_fk ON public.ftth_programs;
CREATE TRIGGER trg_ftth_programs_owner_department_id_tenant_fk
  BEFORE INSERT OR UPDATE OF owner_department_id, tenant_id ON public.ftth_programs
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('enterprise_departments', 'id', 'owner_department_id');

DROP TRIGGER IF EXISTS trg_ftth_quality_gates_work_package_id_tenant_fk ON public.ftth_quality_gates;
CREATE TRIGGER trg_ftth_quality_gates_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.ftth_quality_gates
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_ftth_splices_cable_a_id_tenant_fk ON public.ftth_splices;
CREATE TRIGGER trg_ftth_splices_cable_a_id_tenant_fk
  BEFORE INSERT OR UPDATE OF cable_a_id, tenant_id ON public.ftth_splices
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_cable_segments', 'id', 'cable_a_id');

DROP TRIGGER IF EXISTS trg_ftth_splices_cable_b_id_tenant_fk ON public.ftth_splices;
CREATE TRIGGER trg_ftth_splices_cable_b_id_tenant_fk
  BEFORE INSERT OR UPDATE OF cable_b_id, tenant_id ON public.ftth_splices
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_cable_segments', 'id', 'cable_b_id');

DROP TRIGGER IF EXISTS trg_ftth_splices_closure_asset_id_tenant_fk ON public.ftth_splices;
CREATE TRIGGER trg_ftth_splices_closure_asset_id_tenant_fk
  BEFORE INSERT OR UPDATE OF closure_asset_id, tenant_id ON public.ftth_splices
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets', 'id', 'closure_asset_id');

DROP TRIGGER IF EXISTS trg_ftth_work_events_work_package_id_tenant_fk ON public.ftth_work_events;
CREATE TRIGGER trg_ftth_work_events_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.ftth_work_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_ftth_work_package_tasks_work_package_id_tenant_fk ON public.ftth_work_package_tasks;
CREATE TRIGGER trg_ftth_work_package_tasks_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.ftth_work_package_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_inventory_reservations_item_id_tenant_fk ON public.inventory_reservations;
CREATE TRIGGER trg_inventory_reservations_item_id_tenant_fk
  BEFORE INSERT OR UPDATE OF item_id, tenant_id ON public.inventory_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('inventory_items', 'id', 'item_id');

DROP TRIGGER IF EXISTS trg_inventory_transactions_item_id_tenant_fk ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_transactions_item_id_tenant_fk
  BEFORE INSERT OR UPDATE OF item_id, tenant_id ON public.inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('inventory_items', 'id', 'item_id');

DROP TRIGGER IF EXISTS trg_invoices_service_id_tenant_fk ON public.invoices;
CREATE TRIGGER trg_invoices_service_id_tenant_fk
  BEFORE INSERT OR UPDATE OF service_id, tenant_id ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('services', 'id', 'service_id');

DROP TRIGGER IF EXISTS trg_invoices_ticket_id_tenant_fk ON public.invoices;
CREATE TRIGGER trg_invoices_ticket_id_tenant_fk
  BEFORE INSERT OR UPDATE OF ticket_id, tenant_id ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('tickets', 'id', 'ticket_id');

DROP TRIGGER IF EXISTS trg_material_chain_events_work_package_id_tenant_fk ON public.material_chain_events;
CREATE TRIGGER trg_material_chain_events_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.material_chain_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

DROP TRIGGER IF EXISTS trg_material_chain_events_material_id_tenant_fk ON public.material_chain_events;
CREATE TRIGGER trg_material_chain_events_material_id_tenant_fk
  BEFORE INSERT OR UPDATE OF material_id, tenant_id ON public.material_chain_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('inventory_items', 'id', 'material_id');

DROP TRIGGER IF EXISTS trg_material_chain_events_inventory_transaction_id_tenant_fk ON public.material_chain_events;
CREATE TRIGGER trg_material_chain_events_inventory_transaction_id_tenant_fk
  BEFORE INSERT OR UPDATE OF inventory_transaction_id, tenant_id ON public.material_chain_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('inventory_transactions', 'id', 'inventory_transaction_id');

DROP TRIGGER IF EXISTS trg_network_assets_parent_asset_id_tenant_fk ON public.network_assets;
CREATE TRIGGER trg_network_assets_parent_asset_id_tenant_fk
  BEFORE INSERT OR UPDATE OF parent_asset_id, tenant_id ON public.network_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('network_assets', 'id', 'parent_asset_id');

DROP TRIGGER IF EXISTS trg_payment_cycle_events_payment_cycle_id_tenant_fk ON public.payment_cycle_events;
CREATE TRIGGER trg_payment_cycle_events_payment_cycle_id_tenant_fk
  BEFORE INSERT OR UPDATE OF payment_cycle_id, tenant_id ON public.payment_cycle_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('payment_cycles', 'id', 'payment_cycle_id');

DROP TRIGGER IF EXISTS trg_rework_case_events_rework_case_id_tenant_fk ON public.rework_case_events;
CREATE TRIGGER trg_rework_case_events_rework_case_id_tenant_fk
  BEFORE INSERT OR UPDATE OF rework_case_id, tenant_id ON public.rework_case_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('rework_cases', 'id', 'rework_case_id');

DROP TRIGGER IF EXISTS trg_technician_positions_technician_id_tenant_fk ON public.technician_positions;
CREATE TRIGGER trg_technician_positions_technician_id_tenant_fk
  BEFORE INSERT OR UPDATE OF technician_id, tenant_id ON public.technician_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('technicians', 'id', 'technician_id');

DROP TRIGGER IF EXISTS trg_tickets_approved_by_tenant_fk ON public.tickets;
CREATE TRIGGER trg_tickets_approved_by_tenant_fk
  BEFORE INSERT OR UPDATE OF approved_by, tenant_id ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('technicians', 'id', 'approved_by');

DROP TRIGGER IF EXISTS trg_warehouse_transfers_work_package_id_tenant_fk ON public.warehouse_transfers;
CREATE TRIGGER trg_warehouse_transfers_work_package_id_tenant_fk
  BEFORE INSERT OR UPDATE OF work_package_id, tenant_id ON public.warehouse_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match('ftth_work_packages', 'id', 'work_package_id');

COMMIT;
