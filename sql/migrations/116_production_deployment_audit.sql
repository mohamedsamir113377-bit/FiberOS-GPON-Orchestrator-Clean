-- 116_production_deployment_audit.sql
-- Deployment-proof and production-readiness audit trail.
-- Runtime services do not receive write access; migration/owner paths own these tables.
BEGIN;

CREATE TABLE IF NOT EXISTS public.production_deployment_audit (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id         text NOT NULL,
    build_ref           text NOT NULL,
    proof_hash          char(64) NOT NULL,
    key_id              text NOT NULL,
    issuer              text NOT NULL,
    observed_status     text NOT NULL CHECK (observed_status IN ('PASS', 'FAIL', 'REVOKED')),
    observed_at         timestamptz NOT NULL DEFAULT now(),
    runtime_role        text,
    connected_replicas  integer,
    failover_tested_at  timestamptz,
    evidence_reference  text NOT NULL,
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_deployment_audit_proof_hash
    ON public.production_deployment_audit (proof_hash);
CREATE INDEX IF NOT EXISTS idx_production_deployment_audit_resource_build
    ON public.production_deployment_audit (resource_id, build_ref, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.production_readiness_check_log (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    deployment_audit_id uuid REFERENCES public.production_deployment_audit(id) ON DELETE CASCADE,
    check_name          text NOT NULL,
    status              text NOT NULL CHECK (status IN ('PASS', 'FAIL', 'SKIPPED', 'NOT_VERIFIED')),
    details             jsonb NOT NULL DEFAULT '{}'::jsonb,
    checked_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_readiness_check_log_deployment
    ON public.production_readiness_check_log (deployment_audit_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.production_proof_revocation (
    proof_hash          char(64) PRIMARY KEY,
    revoked_at          timestamptz NOT NULL DEFAULT now(),
    reason              text NOT NULL,
    revoked_by          uuid,
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.production_deployment_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_deployment_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_readiness_check_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_readiness_check_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_proof_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_proof_revocation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_deployment_audit_owner ON public.production_deployment_audit;
CREATE POLICY production_deployment_audit_owner ON public.production_deployment_audit
    FOR ALL TO fiberos_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS production_readiness_check_log_owner ON public.production_readiness_check_log;
CREATE POLICY production_readiness_check_log_owner ON public.production_readiness_check_log
    FOR ALL TO fiberos_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS production_proof_revocation_owner ON public.production_proof_revocation;
CREATE POLICY production_proof_revocation_owner ON public.production_proof_revocation
    FOR ALL TO fiberos_owner USING (true) WITH CHECK (true);

REVOKE ALL ON public.production_deployment_audit FROM PUBLIC;
REVOKE ALL ON public.production_readiness_check_log FROM PUBLIC;
REVOKE ALL ON public.production_proof_revocation FROM PUBLIC;

COMMIT;
