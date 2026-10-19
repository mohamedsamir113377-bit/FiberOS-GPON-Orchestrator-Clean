-- FiberOS pre-DB hardening: introduce external webhook secret references.
-- Upgrade-safe: populated providers are NOT silently migrated or destroyed.
BEGIN;

ALTER TABLE IF EXISTS telco_webhook_providers
  ADD COLUMN IF NOT EXISTS signing_secret_ref text;

COMMENT ON COLUMN telco_webhook_providers.signing_secret_ref IS
  'External secret reference only. Secret material MUST NOT be stored in PostgreSQL; runtime resolves it from an approved secret provider.';

-- Fresh/disposable installs have no provider rows, so plaintext storage can be
-- removed immediately. Existing populated databases must first provision the
-- external secret references; migration 075 performs the final cut-over.
DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='telco_webhook_providers' AND column_name='signing_secret'
  ) THEN
    SELECT count(*) INTO n FROM telco_webhook_providers;
    IF n = 0 THEN
      ALTER TABLE telco_webhook_providers DROP COLUMN signing_secret;
    ELSE
      RAISE NOTICE 'WEBHOOK_SECRET_REPROVISION_REQUIRED:% provider rows still use legacy plaintext storage; run migration 075 after external refs are provisioned.',n;
    END IF;
  END IF;
END $$;

COMMIT;
