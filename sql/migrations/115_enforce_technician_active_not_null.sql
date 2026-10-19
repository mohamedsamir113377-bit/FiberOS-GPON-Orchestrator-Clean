-- 115_enforce_technician_active_not_null.sql
-- Fail closed for historical unknown technician activity states before enforcing the JWT source invariant.
BEGIN;

LOCK TABLE public.technicians IN SHARE ROW EXCLUSIVE MODE;

-- NULL is not proof of active employment; preserve safety by treating it as inactive.
UPDATE public.technicians
SET is_active = false
WHERE is_active IS NULL;

ALTER TABLE public.technicians
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL;

COMMIT;
