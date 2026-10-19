#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const SCRIPT = path.resolve(__dirname, '../firewall/apply-nft-policy.sh');
const OLD_TABLE = [
  'table inet fiberos {',
  '  chain input {',
  '    type filter hook input priority 0; policy accept;',
  '  }',
  '}',
  ''
].join('\n');
const NEW_POLICY = [
  'table inet fiberos {',
  '  chain input {',
  '    type filter hook input priority 0; policy drop;',
  '  }',
  '}',
  ''
].join('\n');

const MOCK_NFT = String.raw`#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "$MOCK_NFT_LOG"

case "$1" in
  list)
    if [[ "$2" == "tables" ]]; then
      if [[ -f "$MOCK_NFT_STATE" ]]; then printf 'table inet fiberos\n'; fi
      exit 0
    fi
    if [[ "$2" == "table" && "$3" == "inet" && "$4" == "fiberos" ]]; then
      [[ -f "$MOCK_NFT_STATE" ]] || exit 1
      if [[ "$MOCK_POSTCHECK_FAIL" == "1" ]] && grep -qF 'policy drop' "$MOCK_NFT_STATE"; then
        echo 'MOCK_POSTCHECK_FAILURE' >&2
        exit 41
      fi
      cat "$MOCK_NFT_STATE"
      exit 0
    fi
    echo 'MOCK_UNSUPPORTED_LIST' >&2
    exit 44
    ;;
  -c)
    [[ "$2" == "-f" ]] || exit 46
    if grep -Fq '\n' "$3"; then
      echo 'LITERAL_BACKSLASH_N_FOUND_IN_BATCH' >&2
      exit 42
    fi
    if [[ "$MOCK_VALIDATE_EXIT" != "0" ]]; then exit "$MOCK_VALIDATE_EXIT"; fi
    exit 0
    ;;
  -f)
    if [[ "$MOCK_APPLY_EXIT" != "0" && ! -f "$MOCK_NFT_FAIL_ONCE_FILE" ]]; then
      : > "$MOCK_NFT_FAIL_ONCE_FILE"
      exit "$MOCK_APPLY_EXIT"
    fi
    if grep -Eq '^[[:space:]]*table[[:space:]]+inet[[:space:]]+fiberos[[:space:]]*\{' "$2"; then
      awk '/^[[:space:]]*table[[:space:]]+inet[[:space:]]+fiberos[[:space:]]*\{/ { copy=1 } copy { print }' "$2" > "$MOCK_NFT_STATE.new"
      [[ -s "$MOCK_NFT_STATE.new" ]] || exit 47
      mv -f "$MOCK_NFT_STATE.new" "$MOCK_NFT_STATE"
      exit 0
    fi
    if grep -Fqx 'delete table inet fiberos' "$2"; then
      rm -f "$MOCK_NFT_STATE"
      exit 0
    fi
    echo 'MOCK_BATCH_HAS_NO_MANAGED_TABLE' >&2
    exit 45
    ;;
  *)
    echo 'MOCK_UNSUPPORTED_NFT_COMMAND' >&2
    exit 43
    ;;
esac
`;

function setup({ initialTable = null, validateExit = 0, applyExit = 0, postcheckFail = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fiberos-firewall-test-'));
  const bin = path.join(root, 'bin');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const nftPath = path.join(bin, 'nft');
  fs.writeFileSync(nftPath, MOCK_NFT, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'id'), ['#!/usr/bin/env bash', 'printf "0"', ''].join('\n'), { mode: 0o755 });

  const statePath = path.join(root, 'current-table.nft');
  if (initialTable !== null) fs.writeFileSync(statePath, initialTable);
  const logPath = path.join(root, 'nft.log');

  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    FIBEROS_FIREWALL_STATE_DIR: stateDir,
    FIBEROS_NFT_TABLE: 'fiberos',
    MOCK_NFT_STATE: statePath,
    MOCK_NFT_LOG: logPath,
    MOCK_VALIDATE_EXIT: String(validateExit),
    MOCK_APPLY_EXIT: String(applyExit),
    MOCK_NFT_FAIL_ONCE_FILE: path.join(root, 'nft-apply-failed-once'),
    MOCK_POSTCHECK_FAIL: String(postcheckFail)
  };

  function run(...args) {
    return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env });
  }
  function readState() {
    return fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : null;
  }
  function close() {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const policyPath = path.join(root, 'new-policy.nft');
  fs.writeFileSync(policyPath, NEW_POLICY);
  return { root, stateDir, policyPath, run, readState, close };
}

test('check mode emits a valid newline-delimited table replacement and changes no live state', t => {
  const ctx = setup({ initialTable: OLD_TABLE });
  t.after(ctx.close);
  const result = ctx.run('--check', ctx.policyPath);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FIBEROS_NFT_CHECK_OK/);
  assert.equal(ctx.readState(), OLD_TABLE);
});

test('apply atomically replaces only the managed table and rollback restores its prior content', t => {
  const ctx = setup({ initialTable: OLD_TABLE });
  t.after(ctx.close);

  const applied = ctx.run('--apply', ctx.policyPath);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(ctx.readState(), NEW_POLICY);
  assert.equal(fs.existsSync(path.join(ctx.stateDir, 'last-known-good-table.nft')), true);
  // A stale legacy marker must not override the backup's single-file state.
  fs.writeFileSync(path.join(ctx.stateDir, 'previous-table-was-absent'), '');

  const rolledBack = ctx.run('--rollback');
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.equal(ctx.readState(), OLD_TABLE);
  assert.equal(fs.existsSync(path.join(ctx.stateDir, 'last-known-good-table.nft')), false);
  assert.equal(fs.existsSync(path.join(ctx.stateDir, 'previous-table-was-absent')), false);
});

test('rollback removes the managed table if it was absent before apply', t => {
  const ctx = setup();
  t.after(ctx.close);

  const applied = ctx.run('--apply', ctx.policyPath);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(ctx.readState(), NEW_POLICY);

  const rolledBack = ctx.run('--rollback');
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.equal(ctx.readState(), null);
});

test('failed nft validation preserves the existing table and its exit status', t => {
  const ctx = setup({ initialTable: OLD_TABLE, validateExit: 23 });
  t.after(ctx.close);

  const result = ctx.run('--apply', ctx.policyPath);
  assert.equal(result.status, 23, result.stderr);
  assert.equal(ctx.readState(), OLD_TABLE);
});

test('failed nft apply restores prior state and preserves the original exit status', t => {
  const ctx = setup({ initialTable: OLD_TABLE, applyExit: 37 });
  t.after(ctx.close);

  const result = ctx.run('--apply', ctx.policyPath);
  assert.equal(result.status, 37, result.stderr);
  assert.doesNotMatch(result.stderr, /FIREWALL_AUTO_ROLLBACK_FAILED/);
  assert.equal(ctx.readState(), OLD_TABLE);
  assert.equal(fs.existsSync(path.join(ctx.stateDir, 'last-known-good-table.nft')), false);
  assert.equal(fs.existsSync(path.join(ctx.stateDir, 'previous-table-was-absent')), false);
});

test('failed post-apply verification atomically restores prior state and fails closed', t => {
  const ctx = setup({ initialTable: OLD_TABLE, postcheckFail: 1 });
  t.after(ctx.close);

  const result = ctx.run('--apply', ctx.policyPath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FIREWALL_POST_APPLY_TABLE_CHECK_FAILED/);
  assert.equal(ctx.readState(), OLD_TABLE);
});

test('policy cannot replace a different table or supply multiple table declarations', t => {
  const ctx = setup({ initialTable: OLD_TABLE });
  t.after(ctx.close);
  const wrongPath = path.join(ctx.root, 'wrong-policy.nft');
  fs.writeFileSync(wrongPath, 'table inet unrelated { }\n');
  const wrong = ctx.run('--apply', wrongPath);
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /POLICY_TABLE_MISMATCH/);
  assert.equal(ctx.readState(), OLD_TABLE);

  const multiplePath = path.join(ctx.root, 'multiple-policy.nft');
  fs.writeFileSync(multiplePath, 'table inet fiberos { }\ntable inet unrelated { }\n');
  const multiple = ctx.run('--apply', multiplePath);
  assert.equal(multiple.status, 2);
  assert.match(multiple.stderr, /POLICY_TABLE_MISMATCH/);
  assert.equal(ctx.readState(), OLD_TABLE);

  const globalCommandPath = path.join(ctx.root, 'global-command-policy.nft');
  fs.writeFileSync(globalCommandPath, 'table inet fiberos { }\nflush ruleset\n');
  const globalCommand = ctx.run('--apply', globalCommandPath);
  assert.equal(globalCommand.status, 2);
  assert.match(globalCommand.stderr, /POLICY_SCOPE_MISMATCH/);
  assert.equal(ctx.readState(), OLD_TABLE);
});
