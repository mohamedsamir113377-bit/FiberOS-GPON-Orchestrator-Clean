-- 124_ftth_audit_tenant_rls_semantics.sql
-- Close the tenant-isolation gap for FTTH command/audit tables.
-- Historical command decisions are never assigned to a tenant by inference:
-- unresolved rows block this migration until an operator supplies verified ownership.
BEGIN;

ALTER TABLE public.ftth_command_decisions
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ftth_command_decisions
    WHERE tenant_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'FTTH_COMMAND_DECISIONS_TENANT_BACKFILL_REQUIRED: resolve every historical row from an authoritative source before applying migration 124';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ftth_command_decisions'::regclass
      AND conname = 'ftth_command_decisions_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.ftth_command_decisions
      ADD CONSTRAINT ftth_command_decisions_tenant_id_fkey
      FOREIGN KEY (tenant_id)
      REFERENCES public.tenants(id)
      ON DELETE RESTRICT;
  END IF;
END;
$migration$;

ALTER TABLE public.ftth_command_decisions
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ftth_command_decisions_tenant_time
  ON public.ftth_command_decisions (tenant_id, decided_at DESC);

ALTER TABLE public.ftth_command_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ftth_command_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ftth_work_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ftth_work_state_transitions FORCE ROW LEVEL SECURITY;

-- Decisions have no command-request parent table in this schema. Their tenant
-- is therefore explicit and FK-checked; authenticated users may read only their
-- session tenant. No authenticated INSERT/UPDATE/DELETE path is declared until
-- a database-authoritative command-decision writer exists.
CREATE POLICY ftth_command_decisions_tenant_read
  ON public.ftth_command_decisions
  FOR SELECT TO authenticated
  USING (public.fiberos_enterprise_tenant_ok(tenant_id));

-- Work-state transitions are tenant-owned through the canonical parent work
-- package. They are exposed read-only; lifecycle writes require a future,
-- narrowly scoped database authority rather than direct table DML.
CREATE POLICY ftth_work_state_transitions_tenant_read
  ON public.ftth_work_state_transitions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ftth_work_packages AS wp
      WHERE wp.id = public.ftth_work_state_transitions.work_package_id
        AND public.fiberos_enterprise_tenant_ok(wp.tenant_id)
    )
  );

COMMENT ON COLUMN public.ftth_command_decisions.tenant_id IS
  'Required authoritative tenant scope for command-decision audit rows; historical rows must be explicitly resolved before migration 124 can apply.';
COMMENT ON POLICY ftth_command_decisions_tenant_read ON public.ftth_command_decisions IS
  'Tenant-scoped read-only access. No direct authenticated writes are permitted.';
COMMENT ON POLICY ftth_work_state_transitions_tenant_read ON public.ftth_work_state_transitions IS
  'Tenant is derived from the canonical ftth_work_packages parent; transition rows are read-only to authenticated users.';

COMMIT;
