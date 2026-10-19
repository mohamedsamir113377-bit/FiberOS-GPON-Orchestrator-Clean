-- 159_enterprise_hierarchy_cycle_integrity.sql
-- Defense-in-depth for the Organization Kernel:
-- PostgreSQL must reject cyclic department-parent and position-manager graphs
-- at write time. Read-side cycle detection remains useful for legacy/corrupt
-- data, but new mutations must never be allowed to create a cycle.
BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_enterprise_department_cycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  cycle_found boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS NOT NULL AND NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'ENTERPRISE_DEPARTMENT_PARENT_CYCLE'
      USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE walk(id, parent_id, visited, has_cycle) AS (
    SELECT
      d.id,
      d.parent_id,
      ARRAY[d.id]::uuid[],
      false
    FROM public.enterprise_departments d
    WHERE d.id = NEW.parent_id
      AND d.tenant_id = NEW.tenant_id

    UNION ALL

    SELECT
      d.id,
      d.parent_id,
      w.visited || d.id,
      d.id = ANY(w.visited)
    FROM public.enterprise_departments d
    JOIN walk w
      ON d.id = w.parent_id
    WHERE d.tenant_id = NEW.tenant_id
      AND NOT w.has_cycle
  )
  SELECT EXISTS (
    SELECT 1
    FROM walk
    WHERE id = NEW.id
       OR has_cycle
  )
  INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'ENTERPRISE_DEPARTMENT_PARENT_CYCLE'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enterprise_department_cycle_guard
  ON public.enterprise_departments;

CREATE TRIGGER trg_enterprise_department_cycle_guard
  BEFORE INSERT OR UPDATE OF parent_id, tenant_id
  ON public.enterprise_departments
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_enterprise_department_cycle_guard();


CREATE OR REPLACE FUNCTION public.fiberos_enterprise_position_cycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  cycle_found boolean;
BEGIN
  IF NEW.manager_position_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS NOT NULL AND NEW.manager_position_id = NEW.id THEN
    RAISE EXCEPTION 'ENTERPRISE_POSITION_MANAGER_CYCLE'
      USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE walk(id, manager_position_id, visited, has_cycle) AS (
    SELECT
      p.id,
      p.manager_position_id,
      ARRAY[p.id]::uuid[],
      false
    FROM public.enterprise_positions p
    WHERE p.id = NEW.manager_position_id
      AND p.tenant_id = NEW.tenant_id

    UNION ALL

    SELECT
      p.id,
      p.manager_position_id,
      w.visited || p.id,
      p.id = ANY(w.visited)
    FROM public.enterprise_positions p
    JOIN walk w
      ON p.id = w.manager_position_id
    WHERE p.tenant_id = NEW.tenant_id
      AND NOT w.has_cycle
  )
  SELECT EXISTS (
    SELECT 1
    FROM walk
    WHERE id = NEW.id
       OR has_cycle
  )
  INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'ENTERPRISE_POSITION_MANAGER_CYCLE'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enterprise_position_cycle_guard
  ON public.enterprise_positions;

CREATE TRIGGER trg_enterprise_position_cycle_guard
  BEFORE INSERT OR UPDATE OF manager_position_id, tenant_id
  ON public.enterprise_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.fiberos_enterprise_position_cycle_guard();

COMMENT ON FUNCTION public.fiberos_enterprise_department_cycle_guard() IS
  'Rejects writes that create a cycle in the tenant-scoped enterprise department parent graph.';

COMMENT ON FUNCTION public.fiberos_enterprise_position_cycle_guard() IS
  'Rejects writes that create a cycle in the tenant-scoped enterprise position manager graph.';

REVOKE ALL ON FUNCTION public.fiberos_enterprise_department_cycle_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiberos_enterprise_position_cycle_guard()
  FROM PUBLIC, anon, authenticated;

COMMIT;
