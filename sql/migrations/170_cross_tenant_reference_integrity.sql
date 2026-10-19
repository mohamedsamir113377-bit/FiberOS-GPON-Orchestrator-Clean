-- 170_cross_tenant_reference_integrity.sql
-- Close cross-tenant reference gaps in the FTTH/GIS tables introduced in 162-168.
-- Keep prior migrations immutable; fail closed if existing rows violate the new tenant references.
BEGIN;

-- The legacy generic trigger guard used by migration 119 treated a parent row
-- hidden by RLS (or missing) as "no mismatch". That is fail-open: a same-tenant
-- reference must be visible to pass, otherwise reject it. Existing FK constraints
-- remain the final existence check for IDs that do not exist at all.
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
    RAISE EXCEPTION 'TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE_%_%',
      upper(TG_TABLE_NAME), upper(child_col)
      USING ERRCODE = '42501';
  END IF;

  IF ref_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_%_%', upper(TG_TABLE_NAME), upper(child_col)
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fiberos_guard_fk_tenant_match() IS
  'Fail-closed cross-tenant FK guard. A referenced row must be visible and have the same tenant_id; TG_ARGV: parent_table, parent_pk_col, child_fk_col.';

-- Parent composite keys. A globally unique id does not by itself provide a
-- composite (tenant_id,id) target for tenant-aware foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_test_tools_tenant_id
  ON public.field_test_tools (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_tool_calibrations_tenant_id
  ON public.field_tool_calibrations (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cable_plant_segments_tenant_id
  ON public.cable_plant_segments (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_optical_splitter_assets_tenant_id
  ON public.optical_splitter_assets (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_technicians_tenant_id
  ON public.technicians (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_installation_jobs_tenant_id
  ON public.installation_jobs (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gis_dig_proposals_tenant_id
  ON public.gis_dig_proposals (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ftth_cable_segments_tenant_id
  ON public.ftth_cable_segments (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ftth_duct_segments_tenant_id
  ON public.ftth_duct_segments (tenant_id, id);

-- Calibration records must reference a tool belonging to the same tenant.
ALTER TABLE public.field_tool_calibrations
  DROP CONSTRAINT IF EXISTS field_tool_calibrations_tool_id_fkey;
ALTER TABLE public.field_tool_calibrations
  ADD CONSTRAINT field_tool_calibrations_tool_tenant_fkey
  FOREIGN KEY (tenant_id, tool_id)
  REFERENCES public.field_test_tools (tenant_id, id)
  ON DELETE CASCADE;

-- OTDR acquisitions may not borrow a tool or calibration from another tenant.
ALTER TABLE public.otdr_trace_acquisitions
  DROP CONSTRAINT IF EXISTS otdr_trace_acquisitions_tool_id_fkey;
ALTER TABLE public.otdr_trace_acquisitions
  ADD CONSTRAINT otdr_trace_acquisitions_tool_tenant_fkey
  FOREIGN KEY (tenant_id, tool_id)
  REFERENCES public.field_test_tools (tenant_id, id)
  ON DELETE SET NULL (tool_id);

ALTER TABLE public.otdr_trace_acquisitions
  DROP CONSTRAINT IF EXISTS otdr_trace_acquisitions_calibration_id_fkey;
ALTER TABLE public.otdr_trace_acquisitions
  ADD CONSTRAINT otdr_trace_acquisitions_calibration_tenant_fkey
  FOREIGN KEY (tenant_id, calibration_id)
  REFERENCES public.field_tool_calibrations (tenant_id, id)
  ON DELETE SET NULL (calibration_id);

-- Constraint evaluations and splitter trees remain inside one tenant.
ALTER TABLE public.install_constraint_evaluations
  DROP CONSTRAINT IF EXISTS install_constraint_evaluations_segment_id_fkey;
ALTER TABLE public.install_constraint_evaluations
  ADD CONSTRAINT install_constraint_evaluations_segment_tenant_fkey
  FOREIGN KEY (tenant_id, segment_id)
  REFERENCES public.cable_plant_segments (tenant_id, id)
  ON DELETE SET NULL (segment_id);

ALTER TABLE public.optical_splitter_assets
  DROP CONSTRAINT IF EXISTS optical_splitter_assets_parent_splitter_id_fkey;
ALTER TABLE public.optical_splitter_assets
  ADD CONSTRAINT optical_splitter_assets_parent_tenant_fkey
  FOREIGN KEY (tenant_id, parent_splitter_id)
  REFERENCES public.optical_splitter_assets (tenant_id, id)
  ON DELETE SET NULL (parent_splitter_id);

-- Scheduling rows cannot reserve another tenant's technician or job.
ALTER TABLE public.field_visit_time_slots
  DROP CONSTRAINT IF EXISTS field_visit_time_slots_technician_id_fkey;
ALTER TABLE public.field_visit_time_slots
  ADD CONSTRAINT field_visit_time_slots_technician_tenant_fkey
  FOREIGN KEY (tenant_id, technician_id)
  REFERENCES public.technicians (tenant_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.field_visit_time_slots
  DROP CONSTRAINT IF EXISTS field_visit_time_slots_installation_job_id_fkey;
ALTER TABLE public.field_visit_time_slots
  ADD CONSTRAINT field_visit_time_slots_installation_job_tenant_fkey
  FOREIGN KEY (tenant_id, installation_job_id)
  REFERENCES public.installation_jobs (tenant_id, id)
  ON DELETE SET NULL (installation_job_id);

-- A conflict record may only reference a proposed dig in the same tenant.
ALTER TABLE public.gis_corridor_conflict_events
  DROP CONSTRAINT IF EXISTS gis_corridor_conflict_events_dig_proposal_id_fkey;
ALTER TABLE public.gis_corridor_conflict_events
  ADD CONSTRAINT gis_corridor_conflict_events_dig_proposal_tenant_fkey
  FOREIGN KEY (tenant_id, dig_proposal_id)
  REFERENCES public.gis_dig_proposals (tenant_id, id)
  ON DELETE SET NULL (dig_proposal_id);

-- GIS segment ids are polymorphic (cable vs duct), so a conventional single FK
-- cannot safely target both tables. Add typed shadow FKs maintained by a trigger.
-- The original segment_id remains the public/API field and both representations
-- are required to agree before any row can be stored.
ALTER TABLE public.gis_snap_events
  ADD COLUMN IF NOT EXISTS fiber_cable_segment_id uuid,
  ADD COLUMN IF NOT EXISTS duct_segment_id uuid;
ALTER TABLE public.gis_corridor_conflict_events
  ADD COLUMN IF NOT EXISTS fiber_cable_segment_id uuid,
  ADD COLUMN IF NOT EXISTS duct_segment_id uuid;
ALTER TABLE public.gis_linear_measure_events
  ADD COLUMN IF NOT EXISTS fiber_cable_segment_id uuid,
  ADD COLUMN IF NOT EXISTS duct_segment_id uuid;

CREATE OR REPLACE FUNCTION public.fiberos_set_gis_segment_tenant_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.fiber_cable_segment_id := NULL;
  NEW.duct_segment_id := NULL;

  IF NEW.segment_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.layer = 'FIBER_CABLE' THEN
    NEW.fiber_cable_segment_id := NEW.segment_id;
  ELSIF NEW.layer = 'DUCT' THEN
    NEW.duct_segment_id := NEW.segment_id;
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_GIS_SEGMENT_LAYER'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_set_gis_segment_tenant_references() FROM PUBLIC;

-- Lock the affected tables and disable RLS only inside this transaction while
-- deriving the shadow columns for existing rows. The transaction restores and
-- forces RLS before commit; the AccessExclusive DDL locks prevent concurrent
-- writes from observing the temporary state.
ALTER TABLE public.gis_snap_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_corridor_conflict_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_linear_measure_events DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_gis_snap_segment_tenant_references ON public.gis_snap_events;
CREATE TRIGGER trg_gis_snap_segment_tenant_references
  BEFORE INSERT OR UPDATE OF tenant_id, layer, segment_id, fiber_cable_segment_id, duct_segment_id
  ON public.gis_snap_events
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_set_gis_segment_tenant_references();

DROP TRIGGER IF EXISTS trg_gis_corridor_segment_tenant_references ON public.gis_corridor_conflict_events;
CREATE TRIGGER trg_gis_corridor_segment_tenant_references
  BEFORE INSERT OR UPDATE OF tenant_id, layer, segment_id, fiber_cable_segment_id, duct_segment_id
  ON public.gis_corridor_conflict_events
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_set_gis_segment_tenant_references();

DROP TRIGGER IF EXISTS trg_gis_linear_measure_segment_tenant_references ON public.gis_linear_measure_events;
CREATE TRIGGER trg_gis_linear_measure_segment_tenant_references
  BEFORE INSERT OR UPDATE OF tenant_id, layer, segment_id, fiber_cable_segment_id, duct_segment_id
  ON public.gis_linear_measure_events
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_set_gis_segment_tenant_references();

-- Force the trigger to populate typed references for rows that existed before 170.
UPDATE public.gis_snap_events SET segment_id = segment_id;
UPDATE public.gis_corridor_conflict_events SET segment_id = segment_id;
UPDATE public.gis_linear_measure_events SET segment_id = segment_id;

ALTER TABLE public.gis_snap_events
  ADD CONSTRAINT gis_snap_segment_reference_shape_check CHECK (
    (segment_id IS NULL AND fiber_cable_segment_id IS NULL AND duct_segment_id IS NULL)
    OR (segment_id IS NOT NULL AND layer = 'FIBER_CABLE' AND fiber_cable_segment_id = segment_id AND duct_segment_id IS NULL)
    OR (segment_id IS NOT NULL AND layer = 'DUCT' AND duct_segment_id = segment_id AND fiber_cable_segment_id IS NULL)
  );
ALTER TABLE public.gis_corridor_conflict_events
  ADD CONSTRAINT gis_corridor_segment_reference_shape_check CHECK (
    (segment_id IS NULL AND fiber_cable_segment_id IS NULL AND duct_segment_id IS NULL)
    OR (segment_id IS NOT NULL AND layer = 'FIBER_CABLE' AND fiber_cable_segment_id = segment_id AND duct_segment_id IS NULL)
    OR (segment_id IS NOT NULL AND layer = 'DUCT' AND duct_segment_id = segment_id AND fiber_cable_segment_id IS NULL)
  );
ALTER TABLE public.gis_linear_measure_events
  ADD CONSTRAINT gis_linear_measure_segment_reference_shape_check CHECK (
    (segment_id IS NOT NULL AND layer = 'FIBER_CABLE' AND fiber_cable_segment_id = segment_id AND duct_segment_id IS NULL)
    OR (segment_id IS NOT NULL AND layer = 'DUCT' AND duct_segment_id = segment_id AND fiber_cable_segment_id IS NULL)
  );

ALTER TABLE public.gis_snap_events
  ADD CONSTRAINT gis_snap_cable_segment_tenant_fkey
  FOREIGN KEY (tenant_id, fiber_cable_segment_id)
  REFERENCES public.ftth_cable_segments (tenant_id, id)
  ON DELETE RESTRICT;
ALTER TABLE public.gis_snap_events
  ADD CONSTRAINT gis_snap_duct_segment_tenant_fkey
  FOREIGN KEY (tenant_id, duct_segment_id)
  REFERENCES public.ftth_duct_segments (tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE public.gis_corridor_conflict_events
  ADD CONSTRAINT gis_corridor_cable_segment_tenant_fkey
  FOREIGN KEY (tenant_id, fiber_cable_segment_id)
  REFERENCES public.ftth_cable_segments (tenant_id, id)
  ON DELETE RESTRICT;
ALTER TABLE public.gis_corridor_conflict_events
  ADD CONSTRAINT gis_corridor_duct_segment_tenant_fkey
  FOREIGN KEY (tenant_id, duct_segment_id)
  REFERENCES public.ftth_duct_segments (tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE public.gis_linear_measure_events
  ADD CONSTRAINT gis_linear_measure_cable_segment_tenant_fkey
  FOREIGN KEY (tenant_id, fiber_cable_segment_id)
  REFERENCES public.ftth_cable_segments (tenant_id, id)
  ON DELETE RESTRICT;
ALTER TABLE public.gis_linear_measure_events
  ADD CONSTRAINT gis_linear_measure_duct_segment_tenant_fkey
  FOREIGN KEY (tenant_id, duct_segment_id)
  REFERENCES public.ftth_duct_segments (tenant_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_gis_snap_tenant_cable_segment
  ON public.gis_snap_events (tenant_id, fiber_cable_segment_id)
  WHERE fiber_cable_segment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gis_snap_tenant_duct_segment
  ON public.gis_snap_events (tenant_id, duct_segment_id)
  WHERE duct_segment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gis_corridor_tenant_cable_segment
  ON public.gis_corridor_conflict_events (tenant_id, fiber_cable_segment_id)
  WHERE fiber_cable_segment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gis_corridor_tenant_duct_segment
  ON public.gis_corridor_conflict_events (tenant_id, duct_segment_id)
  WHERE duct_segment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gis_linear_measure_tenant_cable_segment
  ON public.gis_linear_measure_events (tenant_id, fiber_cable_segment_id)
  WHERE fiber_cable_segment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gis_linear_measure_tenant_duct_segment
  ON public.gis_linear_measure_events (tenant_id, duct_segment_id)
  WHERE duct_segment_id IS NOT NULL;

ALTER TABLE public.gis_snap_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_snap_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gis_corridor_conflict_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_corridor_conflict_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gis_linear_measure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_linear_measure_events FORCE ROW LEVEL SECURITY;

COMMIT;
