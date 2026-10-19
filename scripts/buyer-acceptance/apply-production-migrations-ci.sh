#!/usr/bin/env bash
set -euo pipefail
: "${MIGRATOR_URL:?MIGRATOR_URL is required}"
BASE="sql/migrations"
MANIFEST="$BASE/PRODUCTION_MIGRATIONS.txt"
CHECKSUMS="$BASE/PRODUCTION_MIGRATIONS.sha256"
EXTRA_CHECKSUMS="$BASE/PRODUCTION_MIGRATIONS.extra.sha256"
test -f "$MANIFEST"
test -f "$CHECKSUMS"
test -f "$EXTRA_CHECKSUMS"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Mirror the production migrator's history contract so CI validates the same
# migration ledger that production uses, without inventing a second mechanism.
printf '%s\n' 'SET ROLE fiberos_owner;' '\set ON_ERROR_STOP on' > "$tmp"
cat >> "$tmp" <<'SQL'
CREATE TABLE IF NOT EXISTS public.fiberos_migration_history (
  migration_name text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.fiberos_migration_history FROM PUBLIC, fiberos_runtime, fiberos_worker, fiberos_app;
GRANT SELECT ON public.fiberos_migration_history TO fiberos_migrator;
SQL

while IFS= read -r f; do
  [[ -n "$f" && "$f" != \#* ]] || continue
  test -f "$BASE/$f"
  expected="$(awk -v file="$f" '$2==file {print $1; exit}' "$CHECKSUMS" "$EXTRA_CHECKSUMS")"
  test "${#expected}" -eq 64
  actual="$(sha256sum "$BASE/$f" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || { echo "MIGRATION_CHECKSUM_MISMATCH:$f" >&2; exit 1; }
  printf '\\i %s\n' "$BASE/$f" >> "$tmp"
  printf "INSERT INTO public.fiberos_migration_history(migration_name,sha256) VALUES ('%s','%s');\n" "$f" "$expected" >> "$tmp"
done < "$MANIFEST"

psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$tmp"
echo 'EPHEMERAL_CI_MIGRATIONS_APPLIED_WITH_HISTORY'
