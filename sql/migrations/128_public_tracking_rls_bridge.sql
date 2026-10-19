BEGIN;

-- Public customer tracking is token-authorized, not tenant-session-authorized.
-- Keep technician/position visibility narrowly bound to the same live tracking
-- token already accepted by installation_jobs_public_tracking_select.
DROP POLICY IF EXISTS technicians_public_tracking_select ON public.technicians;
CREATE POLICY technicians_public_tracking_select
  ON public.technicians
  FOR SELECT
  TO fiberos_app
  USING (
    EXISTS (
      SELECT 1
      FROM public.installation_jobs j
      WHERE j.technician_id = technicians.id
        AND j.customer_tracking_token_hash IS NOT NULL
        AND length(nullif(current_setting('fiberos.public_tracking_token_hash', true), '')) = 64
        AND j.customer_tracking_token_hash = current_setting('fiberos.public_tracking_token_hash', true)
        AND j.customer_tracking_revoked = false
        AND j.customer_tracking_expires_at > now()
    )
  );

DROP POLICY IF EXISTS technician_positions_public_tracking_select ON public.technician_positions;
CREATE POLICY technician_positions_public_tracking_select
  ON public.technician_positions
  FOR SELECT
  TO fiberos_app
  USING (
    EXISTS (
      SELECT 1
      FROM public.installation_jobs j
      WHERE j.technician_id = technician_positions.technician_id
        AND j.tenant_id = technician_positions.tenant_id
        AND j.customer_tracking_token_hash IS NOT NULL
        AND length(nullif(current_setting('fiberos.public_tracking_token_hash', true), '')) = 64
        AND j.customer_tracking_token_hash = current_setting('fiberos.public_tracking_token_hash', true)
        AND j.customer_tracking_revoked = false
        AND j.customer_tracking_expires_at > now()
    )
  );

COMMIT;
