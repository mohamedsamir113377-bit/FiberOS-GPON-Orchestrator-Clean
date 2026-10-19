-- 152_reality_operation_plan.sql
-- Persists policy-selected operation alternatives. This is not runtime verification.
BEGIN;
CREATE TABLE IF NOT EXISTS reality_operation_plan_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 request_key text NOT NULL,
 operation_type text NOT NULL CHECK(operation_type IN('fault_diagnosis','maintenance_closure','installation_acceptance','commercial_reconciliation','incident_command','optical_assurance','network_inventory_reconciliation')),
 subject_type text NOT NULL CHECK(subject_type IN('ticket','incident','service_order','work_package','service','asset','fault','installation','measurement','reconciliation')),
 subject_id uuid,
 network_family text NOT NULL CHECK(network_family IN('gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown')),
 policy_profile_id uuid REFERENCES reality_access_profiles(id) ON DELETE SET NULL,
 recommended_alternative_key text,
 recommendation_status text NOT NULL CHECK(recommendation_status IN('selected','candidate','fallback_required','partial','blocked')),
 plan jsonb NOT NULL DEFAULT '{}'::jsonb,
 selected_sources text[] NOT NULL DEFAULT '{}',
 authoritative_evidence_ready boolean NOT NULL DEFAULT false,
 runtime_verification_status text NOT NULL DEFAULT 'UNVERIFIED_POLICY_SELECTION' CHECK(runtime_verification_status IN('VERIFIED_BY_ADAPTER','UNVERIFIED_POLICY_SELECTION','NOT_APPLICABLE')),
 truth_boundary text NOT NULL,
 correlation_id text,
 idempotency_key text NOT NULL,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_key)
);
CREATE INDEX IF NOT EXISTS idx_reality_operation_plan_subject ON reality_operation_plan_events(tenant_id,subject_type,subject_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reality_operation_plan_corr ON reality_operation_plan_events(tenant_id,correlation_id,created_at DESC);
ALTER TABLE reality_operation_plan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE reality_operation_plan_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reality_operation_plan_select ON reality_operation_plan_events;
CREATE POLICY reality_operation_plan_select ON reality_operation_plan_events FOR SELECT TO authenticated USING(tenant_id=fiberos_current_tenant_id());
DROP POLICY IF EXISTS reality_operation_plan_insert ON reality_operation_plan_events;
CREATE POLICY reality_operation_plan_insert ON reality_operation_plan_events FOR INSERT TO authenticated WITH CHECK(tenant_id=fiberos_current_tenant_id());
CREATE OR REPLACE FUNCTION public.fiberos_reality_operation_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'REALITY_OPERATION_PLAN_IMMUTABLE'; END; $$;
REVOKE ALL ON FUNCTION public.fiberos_reality_operation_plan_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_reality_operation_plan_immutable ON reality_operation_plan_events;
CREATE TRIGGER trg_reality_operation_plan_immutable BEFORE UPDATE OR DELETE ON reality_operation_plan_events FOR EACH ROW EXECUTE FUNCTION public.fiberos_reality_operation_plan_immutable();
CREATE OR REPLACE FUNCTION public.fiberos_validate_reality_operation_plan_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.policy_profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reality_access_profiles p WHERE p.id=NEW.policy_profile_id AND p.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH_REALITY_OPERATION_POLICY'; END IF;
 IF NEW.recommendation_status='selected' AND NEW.authoritative_evidence_ready=false THEN RAISE EXCEPTION 'SELECTED_PLAN_REQUIRES_AUTHORITY'; END IF;
 IF NEW.runtime_verification_status='VERIFIED_BY_ADAPTER' THEN RAISE EXCEPTION 'RUNTIME_VERIFICATION_MUST_USE_ADAPTER_AUTHORITY'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fiberos_validate_reality_operation_plan_scope() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_reality_operation_plan_scope ON reality_operation_plan_events;
CREATE TRIGGER trg_reality_operation_plan_scope BEFORE INSERT OR UPDATE ON reality_operation_plan_events FOR EACH ROW EXECUTE FUNCTION public.fiberos_validate_reality_operation_plan_scope();
GRANT SELECT,INSERT ON reality_operation_plan_events TO fiberos_app,authenticated;
COMMIT;
