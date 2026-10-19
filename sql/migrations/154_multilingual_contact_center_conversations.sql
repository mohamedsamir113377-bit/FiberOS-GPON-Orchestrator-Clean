-- FiberOS 2026 multilingual contact-center conversation layer.
-- Adds tenant-scoped language/dialect state and auditable chat/message envelopes.
-- Does NOT claim telephony, ASR, TTS, or model-provider runtime connectivity.
BEGIN;

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS language_code text,
  ADD COLUMN IF NOT EXISTS locale text,
  ADD COLUMN IF NOT EXISTS dialect_mode text NOT NULL DEFAULT 'EXACT_LOCALE'
    CHECK (dialect_mode IN ('EXACT_LOCALE','REGIONAL_STANDARD','HUMAN_HANDOFF_REQUIRED')),
  ADD COLUMN IF NOT EXISTS language_confidence numeric(5,4)
    CHECK (language_confidence IS NULL OR (language_confidence >= 0 AND language_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS language_source text
    CHECK (language_source IS NULL OR language_source IN ('REQUESTED','DETECTED','AGENT_OVERRIDE','CUSTOMER_PROFILE')),
  ADD COLUMN IF NOT EXISTS voice_profile text,
  ADD COLUMN IF NOT EXISTS speech_adapter_mode text
    CHECK (speech_adapter_mode IS NULL OR speech_adapter_mode IN ('LOCAL_SOVEREIGN','EXTERNAL_OPTIONAL'));

CREATE INDEX IF NOT EXISTS idx_call_sessions_language
  ON call_sessions(tenant_id, language_code, locale, started_at DESC);

CREATE TABLE IF NOT EXISTS contact_center_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('VOICE','CHAT')),
  call_session_id uuid REFERENCES call_sessions(id) ON DELETE SET NULL,
  customer_ref text,
  language_code text NOT NULL,
  locale text NOT NULL,
  dialect_mode text NOT NULL DEFAULT 'EXACT_LOCALE'
    CHECK (dialect_mode IN ('EXACT_LOCALE','REGIONAL_STANDARD','HUMAN_HANDOFF_REQUIRED')),
  language_confidence numeric(5,4)
    CHECK (language_confidence IS NULL OR (language_confidence >= 0 AND language_confidence <= 1)),
  language_source text NOT NULL
    CHECK (language_source IN ('REQUESTED','DETECTED','AGENT_OVERRIDE','CUSTOMER_PROFILE')),
  adapter_mode text NOT NULL
    CHECK (adapter_mode IN ('LOCAL_SOVEREIGN','EXTERNAL_OPTIONAL')),
  voice_profile text,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','PAUSED','HANDOFF_REQUIRED','COMPLETED','FAILED')),
  created_by uuid,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cc_conversations_customer
  ON contact_center_conversations(tenant_id, customer_ref, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_conversations_language
  ON contact_center_conversations(tenant_id, language_code, locale, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_conversation_call
  ON contact_center_conversations(tenant_id, call_session_id)
  WHERE call_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_center_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES contact_center_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('CUSTOMER_TO_SYSTEM','SYSTEM_TO_CUSTOMER','AGENT_TO_CUSTOMER')),
  message_type text NOT NULL CHECK (message_type IN ('TEXT','TRANSCRIPT','TRANSLATION','SYSTEM_EVENT')),
  source_language_code text,
  source_locale text,
  target_language_code text,
  target_locale text,
  dialect_mode text NOT NULL DEFAULT 'EXACT_LOCALE'
    CHECK (dialect_mode IN ('EXACT_LOCALE','REGIONAL_STANDARD','HUMAN_HANDOFF_REQUIRED')),
  content text NOT NULL CHECK (length(content) <= 20000),
  audio_reference text,
  provider_reference text,
  evidence_class text NOT NULL DEFAULT 'declared'
    CHECK (evidence_class IN ('observed','measured','derived','declared','unverified')),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cc_messages_conversation
  ON contact_center_conversation_messages(tenant_id, conversation_id, occurred_at ASC, id ASC);

ALTER TABLE contact_center_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_center_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE contact_center_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_center_conversation_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cc_conversations_customer ON contact_center_conversations;
CREATE POLICY cc_conversations_customer ON contact_center_conversations
  FOR SELECT TO authenticated
  USING (tenant_id = fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['customer'])
    AND created_by = auth.uid());

DROP POLICY IF EXISTS cc_conversations_customer_insert ON contact_center_conversations;
CREATE POLICY cc_conversations_customer_insert ON contact_center_conversations
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['customer'])
    AND created_by = auth.uid());

DROP POLICY IF EXISTS cc_conversations_scope ON contact_center_conversations;
CREATE POLICY cc_conversations_scope ON contact_center_conversations
  FOR ALL TO authenticated
  USING (tenant_id = fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','exec','sysadmin']))
  WITH CHECK (tenant_id = fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','sysadmin']));

DROP POLICY IF EXISTS cc_conversations_app ON contact_center_conversations;
CREATE POLICY cc_conversations_app ON contact_center_conversations
  FOR ALL TO fiberos_app
  USING (tenant_id = fiberos_current_tenant_id())
  WITH CHECK (tenant_id = fiberos_current_tenant_id());

DROP POLICY IF EXISTS cc_messages_customer ON contact_center_conversation_messages;
CREATE POLICY cc_messages_customer ON contact_center_conversation_messages
  FOR SELECT TO authenticated
  USING (
    tenant_id = fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['customer'])
    AND EXISTS (
      SELECT 1 FROM contact_center_conversations c
      WHERE c.id = conversation_id AND c.tenant_id = tenant_id AND c.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS cc_messages_customer_insert ON contact_center_conversation_messages;
CREATE POLICY cc_messages_customer_insert ON contact_center_conversation_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['customer'])
    AND EXISTS (
      SELECT 1 FROM contact_center_conversations c
      WHERE c.id = conversation_id AND c.tenant_id = tenant_id AND c.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS cc_messages_scope ON contact_center_conversation_messages;
CREATE POLICY cc_messages_scope ON contact_center_conversation_messages
  FOR ALL TO authenticated
  USING (tenant_id = fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','exec','sysadmin']))
  WITH CHECK (tenant_id = fiberos_current_tenant_id()
    AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','sysadmin']));

DROP POLICY IF EXISTS cc_messages_app ON contact_center_conversation_messages;
CREATE POLICY cc_messages_app ON contact_center_conversation_messages
  FOR ALL TO fiberos_app
  USING (tenant_id = fiberos_current_tenant_id())
  WITH CHECK (tenant_id = fiberos_current_tenant_id());

CREATE OR REPLACE FUNCTION public.fiberos_cc_conversation_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CONTACT_CENTER_CONVERSATION_DELETE_FORBIDDEN';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.channel IS DISTINCT FROM OLD.channel
      OR NEW.call_session_id IS DISTINCT FROM OLD.call_session_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'CONTACT_CENTER_CONVERSATION_IDENTITY_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiberos_cc_message_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'CONTACT_CENTER_MESSAGE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cc_conversations_immutable ON contact_center_conversations;
CREATE TRIGGER trg_cc_conversations_immutable
  BEFORE UPDATE OR DELETE ON contact_center_conversations
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_cc_conversation_immutable();

DROP TRIGGER IF EXISTS trg_cc_messages_immutable ON contact_center_conversation_messages;
CREATE TRIGGER trg_cc_messages_immutable
  BEFORE UPDATE OR DELETE ON contact_center_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.fiberos_cc_message_immutable();

GRANT SELECT, INSERT, UPDATE ON call_sessions TO fiberos_app;
GRANT SELECT, INSERT ON contact_center_conversations TO fiberos_app;
GRANT SELECT, INSERT ON contact_center_conversation_messages TO fiberos_app;

COMMIT;
