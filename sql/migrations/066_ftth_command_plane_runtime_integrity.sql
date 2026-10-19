BEGIN;

CREATE TABLE IF NOT EXISTS ftth_command_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_request_id uuid NOT NULL,
  decision_type text NOT NULL CHECK (decision_type IN ('APPROVE','REJECT','EXECUTE','CANCEL')),
  actor_id uuid NOT NULL,
  actor_scope text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text,
  evidence_id uuid,
  execution_reference text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_ftth_command_decisions_request ON ftth_command_decisions(command_request_id);
CREATE INDEX IF NOT EXISTS idx_ftth_command_decisions_actor ON ftth_command_decisions(actor_id);

CREATE TABLE IF NOT EXISTS ftth_work_state_transitions (
  transition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_package_id uuid NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source text NOT NULL,
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  policy_version text NOT NULL,
  transition_hash text NOT NULL,
  UNIQUE(work_package_id, transition_hash)
);

CREATE INDEX IF NOT EXISTS idx_ftth_work_state_transitions_wp ON ftth_work_state_transitions(work_package_id, occurred_at);

ALTER TABLE ftth_command_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_command_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_work_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_work_state_transitions FORCE ROW LEVEL SECURITY;

COMMIT;
