-- FiberOS final webhook secret cut-over.
-- Execute only after every active provider has an approved external secret reference.
BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='telco_webhook_providers' AND column_name='signing_secret'
  ) THEN
    SELECT count(*) INTO n FROM telco_webhook_providers
    WHERE active AND (signing_secret_ref IS NULL OR btrim(signing_secret_ref)='');
    IF n <> 0 THEN
      RAISE EXCEPTION 'WEBHOOK_SECRET_EXTERNAL_REF_REQUIRED:% active providers lack signing_secret_ref',n;
    END IF;
    ALTER TABLE telco_webhook_providers DROP COLUMN signing_secret;
  END IF;
END $$;

ALTER TABLE IF EXISTS telco_webhook_providers
  ADD CONSTRAINT telco_webhook_provider_secret_ref_active_chk
  CHECK (NOT active OR (signing_secret_ref IS NOT NULL AND btrim(signing_secret_ref) <> ''));

ALTER TABLE IF EXISTS telco_webhook_providers
  ALTER COLUMN signing_secret_ref SET NOT NULL;

COMMIT;
