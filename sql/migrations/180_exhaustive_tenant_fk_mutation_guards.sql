-- 180_exhaustive_tenant_fk_mutation_guards.sql
-- Close tenant-bearing foreign-key edges that the live adversarial audit found
-- without an explicit tenant comparison. Existing migrations remain immutable.
-- A native composite FK containing child.tenant_id -> parent.tenant_id is already
-- tenant-bound and is intentionally retained as the database-enforced proof.
BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_guard_composite_fk_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  pair_count integer;
  i integer;
  child_col text;
  parent_col text;
  where_clause text := '';
  null_clause text := '';
  has_null boolean;
  ref_tenant uuid;
  sql text;
BEGIN
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;

  IF TG_NARGS < 3 OR mod(TG_NARGS - 1, 2) <> 0 THEN
    RAISE EXCEPTION 'TENANT_FK_GUARD_CONFIGURATION_INVALID_%', upper(TG_TABLE_NAME)
      USING ERRCODE = '22023';
  END IF;
  pair_count := (TG_NARGS - 1) / 2;

  FOR i IN 0..pair_count - 1 LOOP
    child_col := TG_ARGV[1 + i * 2];
    parent_col := TG_ARGV[2 + i * 2];
    IF i > 0 THEN
      where_clause := where_clause || ' AND ';
      null_clause := null_clause || ' OR ';
    END IF;
    where_clause := where_clause || format('%I = ($1).%I', parent_col, child_col);
    null_clause := null_clause || format('($1).%I IS NULL', child_col);
  END LOOP;

  -- Match PostgreSQL MATCH SIMPLE semantics: any NULL FK component leaves
  -- existence/nullability enforcement to the declared FK constraint.
  EXECUTE 'SELECT ' || null_clause INTO has_null USING NEW;
  IF has_null THEN
    RETURN NEW;
  END IF;

  sql := format('SELECT tenant_id FROM public.%I WHERE %s LIMIT 1', parent_table, where_clause);
  EXECUTE sql INTO ref_tenant USING NEW;

  IF ref_tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE_%_%',
      upper(TG_TABLE_NAME), upper(parent_table)
      USING ERRCODE = '42501';
  END IF;

  IF ref_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH_%_%', upper(TG_TABLE_NAME), upper(parent_table)
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_guard_composite_fk_tenant_match() FROM PUBLIC, anon, authenticated, fiberos_app;
COMMENT ON FUNCTION public.fiberos_guard_composite_fk_tenant_match() IS
  'Fail-closed tenant comparison for composite FKs without a native tenant_id pair. TG_ARGV: parent_table, then child_col,parent_col pairs.';

-- Discover the relationships from PostgreSQL's actual FK catalog, not a
-- hand-maintained list. Every affected FK receives a targetable trigger so the
-- runtime audit can isolate and exercise one relationship at a time.
DO $$
DECLARE
  fk record;
  trigger_name text;
  trigger_args text;
  i integer;
BEGIN
  FOR fk IN
    SELECT
      con.oid,
      con.conname,
      child.relname AS child_table,
      parent.relname AS parent_table,
      ARRAY(
        SELECT ca.attname::text
        FROM unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord)
        JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = ck.attnum
        ORDER BY ck.ord
      ) AS child_cols,
      ARRAY(
        SELECT pa.attname::text
        FROM unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord)
        JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = pk.attnum
        ORDER BY pk.ord
      ) AS parent_cols,
      EXISTS (
        SELECT 1
        FROM unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord)
        JOIN unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) USING (ord)
        JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = ck.attnum
        JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = pk.attnum
        WHERE ca.attname = 'tenant_id' AND pa.attname = 'tenant_id'
      ) AS has_native_tenant_pair
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE con.contype = 'f'
      AND child_ns.nspname = 'public'
      AND parent_ns.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = con.conrelid AND a.attname = 'tenant_id'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = con.confrelid AND a.attname = 'tenant_id'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
    ORDER BY child.relname, con.conname
  LOOP
    -- Native composite FK already carries the tenant key and must remain the
    -- authoritative guard for this edge; do not replace it with a trigger.
    IF fk.has_native_tenant_pair THEN
      CONTINUE;
    END IF;

    IF cardinality(fk.child_cols) <> cardinality(fk.parent_cols)
       OR cardinality(fk.child_cols) < 1 THEN
      RAISE EXCEPTION 'TENANT_FK_CATALOG_MISMATCH_%', fk.conname
        USING ERRCODE = 'XX000';
    END IF;

    trigger_name := 'trg_tenant_fk_' || substr(md5(fk.child_table || ':' || fk.conname), 1, 24);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, fk.child_table);

    IF cardinality(fk.child_cols) = 1 THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_fk_tenant_match(%L, %L, %L)',
        trigger_name, fk.child_table, fk.parent_table, fk.parent_cols[1], fk.child_cols[1]
      );
    ELSE
      trigger_args := format('%L', fk.parent_table);
      FOR i IN 1..cardinality(fk.child_cols) LOOP
        trigger_args := trigger_args || format(', %L, %L', fk.child_cols[i], fk.parent_cols[i]);
      END LOOP;
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_composite_fk_tenant_match(%s)',
        trigger_name, fk.child_table, trigger_args
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
