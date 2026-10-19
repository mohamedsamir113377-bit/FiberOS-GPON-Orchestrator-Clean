#!/usr/bin/env bash
# Buyer-run cross-tenant smoke checks. Fail-closed. Does not invent data.
# Usage:
#   DATABASE_URL_A=... DATABASE_URL_B=... TENANT_B_UUID=... ./cross-tenant-smoke.sh
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }
need() { [[ -n "${!1:-}" ]] || die "Environment variable $1 is required"; }

need DATABASE_URL_A
need DATABASE_URL_B
need TENANT_B_UUID

echo "== Cross-tenant smoke (buyer-attested) =="

echo "-- A: count tickets visible to connection A"
COUNT_A=$(psql "$DATABASE_URL_A" -Atc "SELECT count(*) FROM tickets;" 2>/dev/null || echo "ERROR")
[[ "$COUNT_A" != "ERROR" ]] || die "Cannot query tickets on DATABASE_URL_A (RLS/auth/schema)"

echo "   visible rows: $COUNT_A"

echo "-- A: attempt to see Tenant B rows (expect 0 under RLS)"
COUNT_B_FROM_A=$(psql "$DATABASE_URL_A" -Atc "SELECT count(*) FROM tickets WHERE tenant_id = '$TENANT_B_UUID';" 2>/dev/null || echo "ERROR")
[[ "$COUNT_B_FROM_A" != "ERROR" ]] || die "Query failed"
if [[ "$COUNT_B_FROM_A" != "0" ]]; then
  die "RLS leak? Connection A saw $COUNT_B_FROM_A rows for Tenant B"
fi
echo "   OK: 0 rows for Tenant B from connection A"

echo "-- Protected tables: direct INSERT should fail for app roles (manual verification recommended)"
echo "   Check REVOKE on audit_log / hash_ledger per migration 069"

echo "-- Lifecycle authority: status change without GUC should fail (manual)"
echo "   Expected: TICKET_STATUS_CHANGE_REQUIRES_LIFECYCLE_AUTHORITY"

echo "PASS: basic cross-tenant smoke completed (buyer must still run full suite)"
exit 0
