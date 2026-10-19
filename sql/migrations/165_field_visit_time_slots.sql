-- 165_field_visit_time_slots.sql
-- Strict field-visit occupancy: no overlapping ACTIVE slots per technician.
-- Uses tstzrange + EXCLUDE (GiST) — standard PostgreSQL concurrency pattern.
-- Idempotency key unique per tenant for safe client retries.
BEGIN;

-- btree_gist is created in sql/bootstrap/02_extension_bootstrap.sql (cluster-admin phase).
-- The migrator role is intentionally non-superuser and cannot CREATE EXTENSION.

CREATE TABLE IF NOT EXISTS field_visit_time_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  slot_type text NOT NULL CHECK (slot_type IN (
    'INSTALLATION','FAULT_REPAIR','SURVEY','MAINTENANCE','CALIBRATION','OTHER'
  )),
  status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','CONFIRMED','CANCELLED','COMPLETED')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at),
  CHECK ((EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60.0) >= 15),
  CHECK ((EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60.0) <= 480),
  work_order_ref text,
  idempotency_key text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

-- Prevent overlapping HELD/CONFIRMED slots for the same technician.
-- CANCELLED/COMPLETED do not participate (partial index via WHERE).
ALTER TABLE field_visit_time_slots
  DROP CONSTRAINT IF EXISTS field_visit_time_slots_no_overlap;
ALTER TABLE field_visit_time_slots
  ADD CONSTRAINT field_visit_time_slots_no_overlap
  EXCLUDE USING gist (
    technician_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('HELD', 'CONFIRMED'));

CREATE INDEX IF NOT EXISTS idx_field_visit_slots_tenant_tech_time
  ON field_visit_time_slots (tenant_id, technician_id, starts_at);

ALTER TABLE field_visit_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_visit_time_slots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_visit_time_slots_tenant ON field_visit_time_slots;
CREATE POLICY field_visit_time_slots_tenant ON field_visit_time_slots
  USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid()));

COMMIT;
