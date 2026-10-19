-- 166_time_slot_installation_link.sql
-- Link field visit slots to installation_jobs without weakening EXCLUDE constraint.
BEGIN;

ALTER TABLE field_visit_time_slots
  ADD COLUMN IF NOT EXISTS installation_job_id uuid REFERENCES installation_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_field_visit_slots_install_job
  ON field_visit_time_slots (tenant_id, installation_job_id)
  WHERE installation_job_id IS NOT NULL;

-- Optional: one active HELD/CONFIRMED slot per installation job
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_visit_slot_active_install
  ON field_visit_time_slots (tenant_id, installation_job_id)
  WHERE installation_job_id IS NOT NULL AND status IN ('HELD', 'CONFIRMED');

COMMIT;
