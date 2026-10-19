-- Wave 19: Call queue -> agent assignment foundation
-- Real, server-authoritative assignment of queued call_sessions to available
-- contact-center agents. No synthetic telephony success is implied: this only
-- decides WHO on the roster should take a queued session next; the actual
-- telephony provider must still confirm connection via its own webhook.
BEGIN;

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS required_skill text;

ALTER TABLE call_sessions DROP CONSTRAINT IF EXISTS call_sessions_status_check;
ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_status_check
  CHECK (status IN ('ringing','connected','ivr','queued','assigned','in_progress','completed','failed','abandoned'));

CREATE INDEX IF NOT EXISTS idx_call_sessions_queue_fifo
  ON call_sessions(tenant_id, started_at ASC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_call_sessions_assigned_agent
  ON call_sessions(tenant_id, assigned_agent_id)
  WHERE status IN ('assigned','in_progress');

-- One open (non-terminal) assignment per agent at a time. This is the
-- concurrency guarantee the assignment engine relies on: it is enforced by
-- the database, not just by application logic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_sessions_one_active_per_agent
  ON call_sessions(tenant_id, assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL AND status IN ('assigned','in_progress');

CREATE TABLE IF NOT EXISTS call_queue_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  matched_skill text,
  wait_seconds numeric,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text CHECK (release_reason IN ('completed','abandoned','agent_dropped', NULL))
);
CREATE INDEX IF NOT EXISTS idx_cc_assignments_tenant_time ON call_queue_assignments(tenant_id, assigned_at DESC);

ALTER TABLE call_queue_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_queue_assignments_scope ON call_queue_assignments;
CREATE POLICY call_queue_assignments_scope ON call_queue_assignments FOR ALL USING (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','exec','sysadmin'])
) WITH CHECK (
  tenant_id = fiberos_current_tenant_id()
  AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','sysadmin'])
);

-- Agents need a queryable skills column to match against required_skill.
-- technicians.skills already exists (text[] per Alpha dispatch code) — no
-- change needed there, this migration only adds the queue-side plumbing.

COMMIT;
