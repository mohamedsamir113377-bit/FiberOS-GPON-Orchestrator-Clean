#!/usr/bin/env bash
# FiberOS R14.1 — tenant isolation proof (§14/§15 of the execution report).
# A cross-tenant attempt PASSES only when it is refused: an ERROR, or 0 rows.
# A cross-tenant attempt FAILS if it returns rows / affects rows.
# Same-tenant access must succeed. Any failure makes the whole check exit 1.
set -uo pipefail

ADMIN_URL="${RUNTIME_ADMIN_DATABASE_URL:?set the admin/DBA URL}"
APP_URL="${RUNTIME_APP_DATABASE_URL:?set the constrained fiberos_runtime URL}"
A="11111111-1111-4111-8111-111111111111"      # Tenant A
B="22222222-2222-4222-8222-222222222222"      # Tenant B
UA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"     # Tenant A's user
TKB="66666666-6666-4666-8666-666666666666"    # a Tenant B ticket
FAILURES=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILURES=$((FAILURES + 1)); }

as_a() { # run $1 as Tenant A's authenticated user through the constrained app role
  psql "$APP_URL" -v ON_ERROR_STOP=0 -tA <<SQL 2>&1
BEGIN;
SELECT set_config('request.jwt.claim.sub','$UA',true),
       set_config('request.jwt.claim.role','authenticated',true),
       set_config('request.jwt.claims','{"sub":"$UA","role":"authenticated","app_metadata":{"role":"field_tech"}}',true);
SET LOCAL ROLE fiberos_app;
$1
ROLLBACK;
SQL
}

is_refused() { # refusal = an ERROR line, or a 0-row result
  local out="$1"
  echo "$out" | grep -qiE 'ERROR:' && return 0
  echo "$out" | grep -qE '^(UPDATE|DELETE|INSERT) 0$' && return 0
  local n
  n=$(echo "$out" | grep -E '^[0-9]+$' | head -1)
  [ -n "$n" ] && [ "$n" = "0" ] && return 0
  return 1
}
refuse() { if is_refused "$(as_a "$2")"; then pass "$1"; else fail "$1 -> cross-tenant access SUCCEEDED"; fi; }
allow()  { if is_refused "$(as_a "$2")"; then fail "$1 -> same-tenant access REFUSED"; else pass "$1"; fi; }

echo "== seed two tenants (DBA path) =="
psql "$ADMIN_URL" -tA >/dev/null 2>&1 <<SQL
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY, email text,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO auth.users(id,email) VALUES ('$UA','iso-a@example.invalid') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants(id,name,slug) VALUES ('$A','Iso A','iso-a'),('$B','Iso B','iso-b') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_preferences(user_id,tenant_id,preferred_locale) VALUES ('$UA','$A','en')
  ON CONFLICT (user_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id;
INSERT INTO public.tickets(id,tenant_id,status,type,location_coordinates)
  VALUES ('$TKA','$A','pending','isolation',ST_SetSRID(ST_MakePoint(31.2457,30.0544),4326)::geography),
         ('$TKB','$B','pending','isolation',ST_SetSRID(ST_MakePoint(31.2457,30.0544),4326)::geography)
  ON CONFLICT (id) DO NOTHING;
SQL

echo "== cross-tenant attempts (all must be REFUSED) =="
refuse "A SELECT count of B rows" "SELECT count(*) FROM tickets WHERE tenant_id='$B';"
refuse "A UPDATE B row"           "UPDATE tickets SET status='closed' WHERE id='$TKB';"
refuse "A DELETE B row"           "DELETE FROM tickets WHERE id='$TKB';"
refuse "A INSERT a row for B"     "INSERT INTO tickets(id,tenant_id,status,type,location_coordinates) VALUES (gen_random_uuid(),'$B','pending','iso',ST_SetSRID(ST_MakePoint(31.2,30.0),4326)::geography);"

echo "== same-tenant access (must be ALLOWED) =="
allow  "A SELECT own rows"        "SELECT count(*) FROM tickets WHERE tenant_id='$A';"

echo
cleanup() {
  psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -tA >/dev/null 2>&1 <<SQL
DELETE FROM public.tickets WHERE id IN ('$TKA','$TKB');
DELETE FROM public.user_preferences WHERE user_id='$UA';
DELETE FROM public.tenants WHERE id IN ('$A','$B');
DELETE FROM auth.users WHERE id='$UA';
SQL
}
trap cleanup EXIT

if [ "$FAILURES" -eq 0 ]; then
  echo "TENANT_ISOLATION: PASS — 4 cross-tenant attempts refused, own-tenant access allowed"
  exit 0
fi
echo "TENANT_ISOLATION: FAIL ($FAILURES)"
exit 1
