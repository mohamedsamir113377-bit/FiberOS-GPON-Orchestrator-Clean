-- 017_enterprise_truth_decision.sql
-- Enterprise Truth / Decision plane. Additive and append-oriented.
-- Requires: 001_extensions.sql, 011_tenants_locale.sql, existing auth helpers.

create table if not exists truth_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  subject_type text not null,
  subject_id text not null,
  attribute text,
  value jsonb,
  unit text,
  source text not null,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  state text not null check (state in ('KNOWN','UNKNOWN','CONFLICTED','STALE','UNVERIFIED','CAPABILITY_UNAVAILABLE')),
  provenance jsonb not null default '{}'::jsonb,
  supersedes_fact_id uuid references truth_facts(id),
  content_hash char(64) not null,
  created_by uuid,
  unique(tenant_id, content_hash)
);
create index if not exists idx_truth_facts_subject on truth_facts(tenant_id, subject_type, subject_id, attribute, observed_at desc);
create index if not exists idx_truth_facts_source on truth_facts(tenant_id, source, observed_at desc);

create table if not exists data_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  conflict_key text not null,
  severity text not null check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  fact_ids uuid[] not null,
  sources text[] not null,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','WAIVED')),
  rationale text,
  resolution_evidence_ids uuid[],
  resolver_id uuid,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_conflicts_open on data_conflicts(tenant_id,status,severity,detected_at desc);

create table if not exists decision_certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  subject_type text not null,
  subject_id text not null,
  question text not null,
  recommended_action text not null,
  evidence_refs jsonb not null,
  alternatives jsonb not null default '[]'::jsonb,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  risk_score numeric(5,4) not null check (risk_score >= 0 and risk_score <= 1),
  policy_basis text not null,
  classification text not null check (classification in ('AUTONOMOUS','ASSISTED','APPROVAL_REQUIRED','FORBIDDEN')),
  approval_status text not null default 'NOT_REQUIRED' check (approval_status in ('NOT_REQUIRED','PENDING','APPROVED','REJECTED')),
  rollback_plan jsonb,
  uncertainty jsonb,
  integrity_hash char(64) not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  verified_at timestamptz,
  unique(tenant_id, integrity_hash)
);
create index if not exists idx_decisions_subject on decision_certificates(tenant_id,subject_type,subject_id,created_at desc);

create table if not exists decision_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  decision_id uuid not null references decision_certificates(id) on delete restrict,
  command_id uuid not null unique,
  actor_id uuid,
  status text not null check (status in ('PROPOSED','AUTHORIZED','EXECUTING','EXECUTED','VERIFICATION_REQUIRED','VERIFIED','FAILED','ROLLED_BACK','COMPENSATED')),
  command_hash char(64) not null,
  invariants jsonb not null,
  rollback_plan jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  verification_evidence_ids uuid[],
  error_code text,
  error_detail text
);

create table if not exists decision_rollbacks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  execution_id uuid not null references decision_executions(id) on delete restrict,
  status text not null check (status in ('REQUESTED','EXECUTING','COMPLETED','FAILED','COMPENSATED')),
  reason text not null,
  evidence_ids uuid[] not null default '{}',
  actor_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists model_predictions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  model_key text not null,
  model_version text not null,
  subject_type text not null,
  subject_id text not null,
  prediction jsonb not null,
  confidence numeric(5,4) check (confidence is null or (confidence between 0 and 1)),
  input_fact_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists model_outcomes (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references model_predictions(id) on delete restrict,
  actual_outcome jsonb not null,
  measured_at timestamptz not null default now(),
  outcome_source text not null,
  error_metric numeric,
  evidence_ids uuid[] not null default '{}'
);

alter table model_outcomes enable row level security;
alter table model_outcomes force row level security;
DROP POLICY IF EXISTS model_outcomes_member ON model_outcomes;
CREATE POLICY model_outcomes_member ON model_outcomes FOR ALL TO authenticated
USING (exists(select 1 from model_predictions mp join user_preferences up on up.tenant_id=mp.tenant_id where mp.id=model_outcomes.prediction_id and up.user_id=auth.uid()))
WITH CHECK (exists(select 1 from model_predictions mp join user_preferences up on up.tenant_id=mp.tenant_id where mp.id=model_outcomes.prediction_id and up.user_id=auth.uid()));

create table if not exists security_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete restrict,
  actor_id uuid,
  event_type text not null,
  severity text not null check (severity in ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  resource_type text,
  resource_id text,
  decision text,
  reason_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_security_events_tenant_time on security_events(tenant_id,created_at desc);

-- Membership-based tenant RLS. No UI/localStorage field participates.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['truth_facts','data_conflicts','decision_certificates','decision_executions','decision_rollbacks','model_predictions','security_events'] LOOP
    EXECUTE format('alter table %I enable row level security', t);
    EXECUTE format('alter table %I force row level security', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS truth_facts_member ON truth_facts;
CREATE POLICY truth_facts_member ON truth_facts FOR ALL TO authenticated
USING (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=truth_facts.tenant_id))
WITH CHECK (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=truth_facts.tenant_id));
DROP POLICY IF EXISTS data_conflicts_member ON data_conflicts;
CREATE POLICY data_conflicts_member ON data_conflicts FOR ALL TO authenticated
USING (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=data_conflicts.tenant_id))
WITH CHECK (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=data_conflicts.tenant_id));
DROP POLICY IF EXISTS decision_certificates_member ON decision_certificates;
CREATE POLICY decision_certificates_member ON decision_certificates FOR ALL TO authenticated
USING (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=decision_certificates.tenant_id))
WITH CHECK (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=decision_certificates.tenant_id));
DROP POLICY IF EXISTS decision_executions_member ON decision_executions;
CREATE POLICY decision_executions_member ON decision_executions FOR ALL TO authenticated
USING (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=decision_executions.tenant_id))
WITH CHECK (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=decision_executions.tenant_id));
DROP POLICY IF EXISTS decision_rollbacks_member ON decision_rollbacks;
CREATE POLICY decision_rollbacks_member ON decision_rollbacks FOR ALL TO authenticated
USING (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=decision_rollbacks.tenant_id))
WITH CHECK (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=decision_rollbacks.tenant_id));
DROP POLICY IF EXISTS model_predictions_member ON model_predictions;
CREATE POLICY model_predictions_member ON model_predictions FOR ALL TO authenticated
USING (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=model_predictions.tenant_id))
WITH CHECK (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=model_predictions.tenant_id));
DROP POLICY IF EXISTS security_events_member ON security_events;
CREATE POLICY security_events_member ON security_events FOR ALL TO authenticated
USING (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=security_events.tenant_id))
WITH CHECK (exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=security_events.tenant_id));

-- Append-only tables: history is never updated/deleted by application roles.
CREATE OR REPLACE FUNCTION fiberos_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only: % not permitted', TG_TABLE_NAME, TG_OP; END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['truth_facts','decision_certificates','decision_executions','decision_rollbacks','model_predictions','model_outcomes','security_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_immutable ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fiberos_reject_history_mutation()', t, t);
  END LOOP;
END $$;
