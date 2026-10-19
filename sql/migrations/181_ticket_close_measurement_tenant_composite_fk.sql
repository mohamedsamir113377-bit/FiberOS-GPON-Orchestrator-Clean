-- 181_ticket_close_measurement_tenant_composite_fk.sql
-- Replace the RLS-visible generic trigger for tickets.close_measurement_id with
-- a native tenant-bound FK. PostgreSQL FK enforcement sees the referenced row
-- independently of caller SELECT policies, while the composite key proves that
-- the measurement belongs to the same tenant as the ticket.
BEGIN;

DO $$
DECLARE
  v_tickets regclass := 'public.tickets'::regclass;
  v_measurements regclass := 'public.optical_measurements'::regclass;
  v_ticket_tenant_attnum smallint;
  v_close_measurement_attnum smallint;
  v_measurement_tenant_attnum smallint;
  v_measurement_id_attnum smallint;
  v_fk record;
  v_trigger_name text;
  v_unique_exists boolean;
  v_composite_fk_exists boolean;
  v_composite_fk_name text;
BEGIN
  SELECT attnum INTO v_ticket_tenant_attnum
    FROM pg_attribute
   WHERE attrelid = v_tickets AND attname = 'tenant_id'
     AND attnum > 0 AND NOT attisdropped;
  SELECT attnum INTO v_close_measurement_attnum
    FROM pg_attribute
   WHERE attrelid = v_tickets AND attname = 'close_measurement_id'
     AND attnum > 0 AND NOT attisdropped;
  SELECT attnum INTO v_measurement_tenant_attnum
    FROM pg_attribute
   WHERE attrelid = v_measurements AND attname = 'tenant_id'
     AND attnum > 0 AND NOT attisdropped;
  SELECT attnum INTO v_measurement_id_attnum
    FROM pg_attribute
   WHERE attrelid = v_measurements AND attname = 'id'
     AND attnum > 0 AND NOT attisdropped;

  IF v_ticket_tenant_attnum IS NULL
     OR v_close_measurement_attnum IS NULL
     OR v_measurement_tenant_attnum IS NULL
     OR v_measurement_id_attnum IS NULL THEN
    RAISE EXCEPTION 'TICKET_CLOSE_MEASUREMENT_TENANT_FK_SCHEMA_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = v_measurements
       AND c.contype IN ('p', 'u')
       AND c.conkey = ARRAY[v_measurement_tenant_attnum, v_measurement_id_attnum]::smallint[]
  ) INTO v_unique_exists;

  IF NOT v_unique_exists THEN
    ALTER TABLE public.optical_measurements
      ADD CONSTRAINT optical_measurements_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;

  -- Remove only the single-column FK for close_measurement_id -> measurements.id.
  -- Its generated migration-180 trigger is removed at the same time; all other
  -- tenant-FK guards remain enabled.
  FOR v_fk IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = v_tickets
       AND c.confrelid = v_measurements
       AND c.contype = 'f'
       AND c.conkey = ARRAY[v_close_measurement_attnum]::smallint[]
       AND c.confkey = ARRAY[v_measurement_id_attnum]::smallint[]
  LOOP
    v_trigger_name := 'trg_tenant_fk_' ||
      substr(md5('tickets:' || v_fk.conname), 1, 24);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.tickets', v_trigger_name);
    EXECUTE format('ALTER TABLE public.tickets DROP CONSTRAINT %I', v_fk.conname);
  END LOOP;

  SELECT c.conname INTO v_composite_fk_name
    FROM pg_constraint c
   WHERE c.conrelid = v_tickets
     AND c.confrelid = v_measurements
     AND c.contype = 'f'
     AND c.conkey = ARRAY[v_ticket_tenant_attnum, v_close_measurement_attnum]::smallint[]
     AND c.confkey = ARRAY[v_measurement_tenant_attnum, v_measurement_id_attnum]::smallint[]
   ORDER BY c.conname
   LIMIT 1;
  v_composite_fk_exists := v_composite_fk_name IS NOT NULL;

  IF NOT v_composite_fk_exists THEN
    v_composite_fk_name := 'tickets_tenant_close_measurement_fk';
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_tenant_close_measurement_fk
      FOREIGN KEY (tenant_id, close_measurement_id)
      REFERENCES public.optical_measurements (tenant_id, id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  -- Fails closed if pre-existing records have mismatched or missing tenant-bound
  -- references; it does not silently rewrite production records.
  EXECUTE format('ALTER TABLE public.tickets VALIDATE CONSTRAINT %I', v_composite_fk_name);
  EXECUTE format(
    'COMMENT ON CONSTRAINT %I ON public.tickets IS %L',
    v_composite_fk_name,
    'Native tenant-bound reference to optical_measurements; avoids relying on caller RLS visibility for integrity checks.'
  );
END;
$$;

COMMIT;
