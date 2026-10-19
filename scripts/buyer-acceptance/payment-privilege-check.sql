-- Runtime diagnostic: execute as the same production API role used by the payment path.
-- This is intentionally read-only and must not grant privileges itself.
SELECT
  current_user AS current_user,
  has_function_privilege(
    current_user,
    'public.fiberos_start_payment_cycle(uuid,text)',
    'EXECUTE'
  ) AS can_start_payment_cycle,
  has_function_privilege(
    current_user,
    'public.fiberos_transition_payment_cycle(uuid,text,text,text)',
    'EXECUTE'
  ) AS can_transition_payment_cycle;
