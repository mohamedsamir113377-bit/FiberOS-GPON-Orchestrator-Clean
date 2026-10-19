-- 144_department_kpi_truth_primitives.sql
-- Closes the remaining schema-backed KPI prerequisites without inventing
-- historical facts or market values.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. First-Time-Fix observability
-- Existing tickets cannot be retroactively classified from unavailable
-- historical status transitions. reopen_tracking_observed stays false until
-- this database trigger actually observes a status transition.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS reopen_tracking_observed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tickets_reopen_tracking
  ON public.tickets(tenant_id, reopen_tracking_observed, reopened_at);

CREATE OR REPLACE FUNCTION public.fiberos_track_ticket_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.reopen_tracking_observed := true;

    IF OLD.status IN ('completed','cancelled','rejected','faulty')
       AND NEW.status NOT IN ('completed','cancelled','rejected','faulty')
    THEN
      NEW.reopened_at := COALESCE(OLD.reopened_at, now());
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL
ON FUNCTION public.fiberos_track_ticket_reopen()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_track_ticket_reopen
ON public.tickets;

CREATE TRIGGER trg_track_ticket_reopen
BEFORE UPDATE OF status
ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_track_ticket_reopen();

COMMENT ON COLUMN public.tickets.reopen_tracking_observed IS
  'True only after this migration has observed a ticket status transition; false rows are excluded from First-Time-Fix denominator.';

COMMENT ON COLUMN public.tickets.reopened_at IS
  'First observed transition from a terminal status back to an active/non-terminal status. Historical unobserved reopen events are never inferred.';

-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_id_tenant
  ON public.tickets(id, tenant_id);

-- 2. Exact material-reel conservation ledger
-- Millimetres are used as the conservation unit to avoid floating-point
-- inventory drift. A balance is the sum of immutable delta entries per reel.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_reel_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  reel_id text NOT NULL,
  sku text NOT NULL,
  warehouse_id uuid NOT NULL,
  bin_id uuid,
  ticket_id uuid,
  delta_millimeters bigint NOT NULL CHECK (delta_millimeters <> 0),
  reason text NOT NULL,
  reference_type text,
  reference_id text,
  idempotency_key text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (warehouse_id, tenant_id)
    REFERENCES public.warehouses(id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (bin_id, warehouse_id, tenant_id)
    REFERENCES public.warehouse_bins(id, warehouse_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (ticket_id, tenant_id)
    REFERENCES public.tickets(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_material_reel_ledger_balance
  ON public.material_reel_ledger(tenant_id, reel_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_material_reel_ledger_sku
  ON public.material_reel_ledger(tenant_id, sku, warehouse_id, created_at DESC);

ALTER TABLE public.material_reel_ledger
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.material_reel_ledger
  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_reel_ledger_select
ON public.material_reel_ledger;

CREATE POLICY material_reel_ledger_select
ON public.material_reel_ledger
FOR SELECT TO authenticated
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS material_reel_ledger_insert
ON public.material_reel_ledger;

CREATE POLICY material_reel_ledger_insert
ON public.material_reel_ledger
FOR INSERT TO authenticated
WITH CHECK (
  fiberos_enterprise_tenant_ok(tenant_id)
  AND fiberos_has_any_role(
    ARRAY['warehouse','ops_manager','area_supervisor','sysadmin']
  )
);

CREATE TRIGGER trg_material_reel_ledger_immutable
BEFORE UPDATE OR DELETE
ON public.material_reel_ledger
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_reject_history_mutation();

-- Runtime application reads use fiberos_app under withPrincipal().
GRANT SELECT ON public.material_reel_ledger TO fiberos_app;

DROP POLICY IF EXISTS material_reel_ledger_app_read
ON public.material_reel_ledger;

CREATE POLICY material_reel_ledger_app_read
ON public.material_reel_ledger
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.material_reel_ledger
FROM fiberos_app;

COMMENT ON TABLE public.material_reel_ledger IS
  'Append-only millimetre conservation ledger for physical reels. KPI balance is derived only from persisted entries; no remaining length is inferred from nominal stock.';


-- Application-role read boundary for the KPI endpoint. These grants expose only
-- tenant-scoped read paths; all KPI mutation remains outside this endpoint.
GRANT SELECT
ON public.tickets,
   public.technician_positions,
   public.technician_role_assignments,
   public.invoices,
   public.network_ports,
   public.network_optical_assurance_assessments,
   public.optical_measurements
TO fiberos_app;

DROP POLICY IF EXISTS tickets_app_kpi_read ON public.tickets;
CREATE POLICY tickets_app_kpi_read
ON public.tickets
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS technician_positions_app_kpi_read ON public.technician_positions;
CREATE POLICY technician_positions_app_kpi_read
ON public.technician_positions
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS technician_role_assignments_app_kpi_read ON public.technician_role_assignments;
CREATE POLICY technician_role_assignments_app_kpi_read
ON public.technician_role_assignments
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS invoices_app_kpi_read ON public.invoices;
CREATE POLICY invoices_app_kpi_read
ON public.invoices
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS network_ports_app_kpi_read ON public.network_ports;
CREATE POLICY network_ports_app_kpi_read
ON public.network_ports
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS optical_assurance_app_kpi_read ON public.network_optical_assurance_assessments;
CREATE POLICY optical_assurance_app_kpi_read
ON public.network_optical_assurance_assessments
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS optical_measurements_app_kpi_read ON public.optical_measurements;
CREATE POLICY optical_measurements_app_kpi_read
ON public.optical_measurements
FOR SELECT TO fiberos_app
USING (fiberos_enterprise_tenant_ok(tenant_id));

COMMIT;
