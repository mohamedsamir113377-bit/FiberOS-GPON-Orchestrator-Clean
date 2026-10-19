-- FiberOS — Geometric plausibility pre-check (Feature E)
-- Targets EXISTING geometry on ftth_cable_segments / ftth_duct_segments when present.
-- Fail-closed: if the relation is missing, the migration raises (no silent skip of a security/quality gate).
-- Thresholds are parameters, not universal physics constants.
-- Pure JS counterpart: packages/domain/src/geometricPlausibility.js

BEGIN;

-- Helper: assess length (metres, geography-aware when possible) + vertex count
CREATE OR REPLACE FUNCTION fiberos_assess_path_plausibility(
  geom geometry,
  max_straight_m double precision DEFAULT 5000,
  min_vertices_long integer DEFAULT 3,
  min_length_m double precision DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  len_m double precision;
  verts integer;
  reasons text[] := ARRAY[]::text[];
  plausible boolean := true;
BEGIN
  IF geom IS NULL THEN
    RETURN jsonb_build_object('plausible', false, 'reasons', ARRAY['NULL_GEOMETRY']);
  END IF;

  -- Prefer geography length when SRID is 4326; else planar length in CRS units
  IF ST_SRID(geom) = 4326 THEN
    len_m := ST_Length(geom::geography);
  ELSE
    len_m := ST_Length(geom);
  END IF;

  verts := ST_NPoints(geom);

  IF len_m IS NULL OR verts IS NULL THEN
    RETURN jsonb_build_object('plausible', false, 'reasons', ARRAY['INVALID_METRICS']);
  END IF;

  IF len_m <= min_length_m THEN
    plausible := false;
    reasons := array_append(reasons, 'LENGTH_TOO_SHORT_OR_DEGENERATE');
  END IF;

  IF len_m > max_straight_m AND verts < min_vertices_long THEN
    plausible := false;
    reasons := array_append(reasons, 'LONG_PATH_WITH_INSUFFICIENT_VERTICES');
  END IF;

  IF verts < 2 THEN
    plausible := false;
    reasons := array_append(reasons, 'INSUFFICIENT_VERTICES_FOR_LINESTRING');
  END IF;

  IF plausible THEN
    reasons := array_append(reasons, 'PASSED_PLAUSIBILITY_GATES');
  END IF;

  RETURN jsonb_build_object(
    'plausible', plausible,
    'reasons', to_jsonb(reasons),
    'length_m', len_m,
    'vertex_count', verts,
    'note', 'PRECHECK_ONLY'
  );
END;
$$;

COMMENT ON FUNCTION fiberos_assess_path_plausibility IS
  'Advisory geometric plausibility. Does not replace survey truth. Thresholds are parameters.';

-- Optional enforcement trigger function (not auto-attached; attach only after buyer accepts thresholds)
CREATE OR REPLACE FUNCTION fiberos_enforce_cable_segment_plausibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NEW.geometry IS NULL THEN
    RETURN NEW;
  END IF;
  result := fiberos_assess_path_plausibility(NEW.geometry);
  IF (result->>'plausible')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'GEOMETRIC_PLAUSIBILITY_FAILED: %', result
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Attach only if table exists (explicit, no silent skip of the gate definition)
DO $$
BEGIN
  IF to_regclass('public.ftth_cable_segments') IS NOT NULL THEN
    -- Trigger is created but left DISABLED by default so buyers opt in after reviewing thresholds.
    DROP TRIGGER IF EXISTS trg_cable_segment_plausibility ON public.ftth_cable_segments;
    CREATE TRIGGER trg_cable_segment_plausibility
      BEFORE INSERT OR UPDATE OF geometry ON public.ftth_cable_segments
      FOR EACH ROW
      EXECUTE FUNCTION fiberos_enforce_cable_segment_plausibility();
    ALTER TABLE public.ftth_cable_segments DISABLE TRIGGER trg_cable_segment_plausibility;
    COMMENT ON TRIGGER trg_cable_segment_plausibility ON public.ftth_cable_segments IS
      'DISABLED by default. Enable after threshold review: ALTER TABLE ... ENABLE TRIGGER trg_cable_segment_plausibility';
  ELSE
    RAISE NOTICE 'ftth_cable_segments not present — function created, trigger not attached';
  END IF;
END $$;

COMMIT;
