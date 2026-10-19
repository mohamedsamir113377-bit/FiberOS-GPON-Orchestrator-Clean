-- Alpha47 Zero-Trust Hardening Wave #1.
-- Provider identity is server-side; webhook replay protection is durable.
BEGIN;

CREATE TABLE IF NOT EXISTS telco_webhook_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  signing_secret text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_key)
);
CREATE INDEX IF NOT EXISTS idx_telco_webhook_providers_key ON telco_webhook_providers(provider_key) WHERE active;
ALTER TABLE telco_webhook_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telco_webhook_providers_scope ON telco_webhook_providers;
CREATE POLICY telco_webhook_providers_scope ON telco_webhook_providers FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['ops_manager','sysadmin'])
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
  AND fiberos_has_any_role(ARRAY['ops_manager','sysadmin'])
);

CREATE TABLE IF NOT EXISTS telco_webhook_replay_guard (
  provider_id uuid NOT NULL REFERENCES telco_webhook_providers(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_telco_webhook_replay_time ON telco_webhook_replay_guard(received_at DESC);
ALTER TABLE telco_webhook_replay_guard ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telco_webhook_replay_guard_deny ON telco_webhook_replay_guard;
CREATE POLICY telco_webhook_replay_guard_deny ON telco_webhook_replay_guard FOR ALL USING (false) WITH CHECK (false);

COMMIT;
