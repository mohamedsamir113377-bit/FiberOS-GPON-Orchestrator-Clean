BEGIN;

-- Payment authority functions are invoked by the production API transaction
-- after withPrincipal() switches the local role to fiberos_app. Keep PUBLIC,
-- anon, and authenticated denied; grant only the exact function signatures
-- required by the application runtime.
REVOKE ALL ON FUNCTION public.fiberos_start_payment_cycle(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiberos_transition_payment_cycle(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fiberos_start_payment_cycle(uuid, text) TO fiberos_app;
GRANT EXECUTE ON FUNCTION public.fiberos_transition_payment_cycle(uuid, text, text, text) TO fiberos_app;

COMMIT;
