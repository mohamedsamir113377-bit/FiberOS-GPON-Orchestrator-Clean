#!/usr/bin/env bash
# Local mirror of .github/workflows/runtime-postgres-rls.yml migration + adversarial path.
# Does NOT claim production certification. Requires real PostgreSQL/PostGIS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${ADMIN_URL:-}" || -z "${MIGRATOR_URL:-}" ]]; then
  echo "LOCAL_POSTGRES_RLS_GATE_SKIPPED: set ADMIN_URL and MIGRATOR_URL to a PostGIS database." >&2
  echo "Example: ADMIN_URL=postgresql://postgres:pass@127.0.0.1:5432/fiberos MIGRATOR_URL=postgresql://fiberos_migrator:pass@127.0.0.1:5432/fiberos" >&2
  exit 2
fi

command -v psql >/dev/null || { echo "psql required" >&2; exit 1; }
command -v node >/dev/null || { echo "node required" >&2; exit 1; }

node --check scripts/buyer-acceptance/adversarial-db-static-audit.js
node --check scripts/buyer-acceptance/adversarial-db-runtime-audit.js
node --check scripts/buyer-acceptance/adversarial-tenant-fk-mutation-audit.js
node scripts/buyer-acceptance/adversarial-db-static-audit.js

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f sql/bootstrap/00_production_roles.sql
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS auth"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb, raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f sql/bootstrap/01_production_auth_shim.sql
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f sql/bootstrap/02_extension_bootstrap.sql

MIGRATOR_URL="$MIGRATOR_URL" bash scripts/buyer-acceptance/apply-production-migrations-ci.sh

# Runtime adversarial (requires APP_URL etc. as documented in workflow)
if [[ -n "${APP_URL:-}" ]]; then
  node scripts/buyer-acceptance/live-postgres-rls.js
  node scripts/buyer-acceptance/adversarial-db-runtime-audit.js
fi

echo "LOCAL_POSTGRES_RLS_GATE_SOURCE_AND_MIGRATIONS_COMPLETE"
echo "productionCertification remains false until hosted admission also passes on exact HEAD."
