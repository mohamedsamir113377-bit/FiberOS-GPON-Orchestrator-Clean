#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

STATE_DIR="${FIBEROS_FIREWALL_STATE_DIR:-/run/fiberos-firewall}"
TABLE="${FIBEROS_NFT_TABLE:-fiberos}"
BACKUP="$STATE_DIR/last-known-good-table.nft"
ABSENT_MARKER="$STATE_DIR/previous-table-was-absent"
LOCK_FILE="$STATE_DIR/operation.lock"
WORK=""

usage() {
  cat <<'EOF'
Usage:
  apply-nft-policy.sh --check <policy.nft>
  apply-nft-policy.sh --apply <policy.nft>
  apply-nft-policy.sh --rollback

--check validates the configured table replacement without changing live rules.
--apply validates and atomically replaces only the configured inet table.
--rollback restores the saved managed table, or removes it if none existed before apply.
EOF
}

need_nft() {
  command -v nft >/dev/null 2>&1 || { echo 'NFTABLES_NOT_INSTALLED' >&2; exit 127; }
}
need_root() {
  [[ "$(id -u)" -eq 0 ]] || { echo 'ROOT_REQUIRED_FOR_LIVE_FIREWALL_OPERATION' >&2; exit 77; }
}
valid_table() { [[ "$TABLE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,31}$ ]]; }
check_file() { [[ -r "$1" ]] || { echo "POLICY_FILE_UNREADABLE:$1" >&2; exit 2; }; }

cleanup() {
  [[ -z "$WORK" ]] || rm -rf -- "$WORK"
}
trap cleanup EXIT

acquire_state_lock() {
  command -v flock >/dev/null 2>&1 || { echo 'FLOCK_NOT_INSTALLED' >&2; exit 127; }
  mkdir -p -- "$STATE_DIR"
  chmod 700 -- "$STATE_DIR"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { echo 'FIREWALL_OPERATION_ALREADY_IN_PROGRESS' >&2; exit 75; }
}

# Enumerate first so permission/netlink failures cannot be mistaken for an absent table.
# Prints "present" or "absent"; returns nonzero if nft cannot enumerate the ruleset.
table_status() {
  local listed
  listed="$(nft list tables)" || { echo 'NFT_TABLE_ENUMERATION_FAILED' >&2; return 2; }
  if grep -Fqx -- "table inet $TABLE" <<< "$listed"; then
    printf 'present'
  else
    printf 'absent'
  fi
}

validate_policy_table() {
  local file="$1"
  local declarations expected
  declarations="$(grep -Ec '^[[:space:]]*table[[:space:]]+' "$file" || true)"
  expected="$(grep -Ec "^[[:space:]]*table[[:space:]]+inet[[:space:]]+${TABLE}[[:space:]]*\\{" "$file" || true)"
  if [[ "$declarations" -ne 1 || "$expected" -ne 1 ]]; then
    echo "POLICY_TABLE_MISMATCH:expected exactly one table inet $TABLE" >&2
    return 2
  fi
}

# The file must contain exactly one managed table block and no global nft commands.
# This rejects constructs such as 'flush ruleset' that could affect other tables.
validate_policy_scope() {
  local file="$1"
  awk -v table="$TABLE" '
    function fail() { bad = 1 }
    {
      line = $0
      sub(/[[:space:]]*#.*/, "", line)
      if (line ~ /^[[:space:]]*$/) next
      if (closed) { fail(); next }
      if (!started) {
        if (line !~ ("^[[:space:]]*table[[:space:]]+inet[[:space:]]+" table "[[:space:]]*[{][[:space:]]*$")) fail()
        started = 1
      }
      opens = 0
      closes = 0
      for (i = 1; i <= length(line); i++) {
        ch = substr(line, i, 1)
        if (ch == "{") opens++
        else if (ch == "}") closes++
      }
      depth += opens - closes
      if (depth < 0) fail()
      if (started && depth == 0) closed = 1
    }
    END { if (!started || !closed || depth != 0 || bad) exit 2 }
  ' "$file" || {
    echo "POLICY_SCOPE_MISMATCH:only one managed inet table block is allowed" >&2
    return 2
  }
}

# Restores only the managed table. State is consumed only after successful verification.
restore_previous() {
  local status rc batch
  [[ -f "$BACKUP" ]] || { echo "FIREWALL_BACKUP_MISSING:$BACKUP" >&2; return 2; }
  if [[ -n "$WORK" ]]; then rm -rf -- "$WORK"; WORK=""; fi
  WORK="$(mktemp -d "$STATE_DIR/rollback.XXXXXX")"
  batch="$WORK/rollback.nft"

  if status="$(table_status)"; then :; else rc=$?; return "$rc"; fi
  : > "$batch"
  if [[ "$status" == "present" ]]; then
    printf 'delete table inet %s\n' "$TABLE" >> "$batch"
  fi
  # The backup is the single source of rollback state:
  # non-empty means a table existed; an empty atomic snapshot means it was absent.
  if [[ -s "$BACKUP" ]]; then cat "$BACKUP" >> "$batch"; fi
  if [[ -s "$batch" ]]; then
    nft -c -f "$batch" || return $?
    nft -f "$batch" || return $?
  fi

  if [[ -s "$BACKUP" ]]; then
    nft list table inet "$TABLE" >/dev/null || { echo 'FIREWALL_ROLLBACK_VERIFY_FAILED' >&2; return 1; }
  else
    if status="$(table_status)"; then :; else rc=$?; return "$rc"; fi
    [[ "$status" == "absent" ]] || { echo 'FIREWALL_ROLLBACK_TABLE_STILL_PRESENT' >&2; return 1; }
  fi

  rm -f -- "$BACKUP" "$ABSENT_MARKER"
  echo "FIBEROS_NFT_ROLLBACK_OK:$TABLE"
}

[[ $# -ge 1 ]] || { usage >&2; exit 2; }
need_nft
valid_table || { echo "INVALID_NFT_TABLE_NAME:$TABLE" >&2; exit 2; }

case "$1" in
  --check)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    check_file "$2"
    validate_policy_table "$2" || exit $?
    validate_policy_scope "$2" || exit $?
    WORK="$(mktemp -d "${TMPDIR:-/tmp}/fiberos-fw-check.XXXXXX")"
    local_batch="$WORK/check.nft"
    : > "$local_batch"
    status="$(table_status)" || exit $?
    if [[ "$status" == "present" ]]; then
      printf 'delete table inet %s\n' "$TABLE" >> "$local_batch"
    fi
    cat "$2" >> "$local_batch"
    nft -c -f "$local_batch"
    echo "FIBEROS_NFT_CHECK_OK:$2"
    ;;
  --apply)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    need_root
    check_file "$2"
    validate_policy_table "$2" || exit $?
    validate_policy_scope "$2" || exit $?
    acquire_state_lock
    WORK="$(mktemp -d "$STATE_DIR/apply.XXXXXX")"
    local_batch="$WORK/apply.nft"

    status="$(table_status)" || exit $?
    # Capture one atomic rollback record: populated for an existing table,
    # empty for an originally absent table. Never infer state from two marker files.
    if [[ "$status" == "present" ]]; then
      nft list table inet "$TABLE" > "$WORK/previous-table.nft" || {
        echo 'FIREWALL_SNAPSHOT_FAILED' >&2; exit 1;
      }
      [[ -s "$WORK/previous-table.nft" ]] || { echo 'FIREWALL_SNAPSHOT_EMPTY' >&2; exit 1; }
    else
      : > "$WORK/previous-table.nft"
    fi
    chmod 600 "$WORK/previous-table.nft"
    if ! mv -f -- "$WORK/previous-table.nft" "$BACKUP"; then
      rm -f -- "$BACKUP"
      echo 'FIREWALL_ROLLBACK_STATE_COMMIT_FAILED' >&2
      exit 1
    fi
    rm -f -- "$ABSENT_MARKER"

    : > "$local_batch"
    if [[ "$status" == "present" ]]; then
      printf 'delete table inet %s\n' "$TABLE" >> "$local_batch"
    fi
    cat "$2" >> "$local_batch"

    # nft validates and applies one atomic transaction; unrelated tables never enter this batch.
    nft -c -f "$local_batch"
    if nft -f "$local_batch"; then
      :
    else
      rc=$?
      restore_previous || echo 'FIREWALL_AUTO_ROLLBACK_FAILED' >&2
      exit "$rc"
    fi

    if ! nft list table inet "$TABLE" >/dev/null; then
      restore_previous || echo 'FIREWALL_AUTO_ROLLBACK_FAILED' >&2
      echo 'FIREWALL_POST_APPLY_TABLE_CHECK_FAILED' >&2
      exit 1
    fi
    echo "FIBEROS_NFT_APPLY_OK:$TABLE"
    ;;
  --rollback)
    [[ $# -eq 1 ]] || { usage >&2; exit 2; }
    need_root
    acquire_state_lock
    restore_previous
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
