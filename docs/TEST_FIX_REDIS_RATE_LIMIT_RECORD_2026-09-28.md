# Test Fix Record — redisRateLimit Sovereign-Boundary Test — 2026-09-28

## Summary

The full unit suite (`npm test`) had a single failing test:

```
packages/security/test/redisRateLimit.test.js:53
✖ production requires an explicit sovereign-boundary choice and strong secret if enabled
  AssertionError: false !== true
```

Final state after the fix: **294 pass / 0 fail / 1 skipped (integration-only by design)**.

## Root Cause (verified against source and the official contract)

- `packages/security/src/httpHardening.js:44`:
  `replayDefenseRequired: envBool(env, 'FIBEROS_REPLAY_DEFENSE_REQUIRED', production)`
  — replay defense defaults to REQUIRED in production.
- `packages/security/src/httpHardening.js:387`:
  `if (cfg.replayDefenseRequired && cfg.replayDefenseBackend !== 'REDIS') failures.push('REPLAY_DEFENSE_REDIS_REQUIRED')`
- `config/runtime-environment-contract.v1.json` states explicitly:
  "FIBEROS_REPLAY_DEFENSE_BACKEND: Required in production for protected write routes.
  Must be REDIS; process-local replay protection is not accepted as a distributed
  security boundary."
- The test, however, expected `ok: true` for a production configuration that never set
  `FIBEROS_REPLAY_DEFENSE_REQUIRED`, and did not assert the `REPLAY_DEFENSE_REDIS_REQUIRED`
  failure anywhere. The source behavior matches the official contract; the test
  expectation was stale.

## Fix (test-side only — no security check weakened)

`packages/security/test/redisRateLimit.test.js`, test
`production requires an explicit sovereign-boundary choice and strong secret if enabled`:

1. Added assertion that omitting `FIBEROS_REPLAY_DEFENSE_REQUIRED` in production with a
   PROCESS_LOCAL replay backend fails with `REPLAY_DEFENSE_REDIS_REQUIRED` (strengthens coverage).
2. The two `ok: true` assertions now set `FIBEROS_REPLAY_DEFENSE_REQUIRED: 'false'`,
   the explicit, contract-documented opt-out, instead of relying on silence.

`packages/security/src/httpHardening.js` was NOT modified.

## Follow-up corrections surfaced by `npm run verify`

- `verify:manifest` initially failed with sha256 mismatches for 4 test files and a byte
  count delta, because the manifest inside the delivery archive predated the archive
  contents ("tests-fixed" build). Resolved with the project's canonical tool:
  `node scripts/regen-manifest.js` → `Manifest parity gate passed (1122 files)`.
- The previously skipped integration test
  `independent limiter instances share the same Redis token bucket` was activated by
  running the suite with `FIBEROS_REDIS_TEST_URL=redis://127.0.0.1:6379` against a real
  local Redis.

## Reproduction

```bash
npm install        # requires Node >= 24.21.0 (engine-strict)
npm test
FIBEROS_REDIS_TEST_URL=redis://127.0.0.1:6379 npm test   # activates the Redis integration test
npm run verify
```