# Runtime Evidence Chain

FiberOS R14.1 Sales Core carries an optional runtime evidence chain for attributable environment verification.

## What it proves

The chain records runtime check outcomes together with:

- the release identifier;
- a hash of the canonical tenant-sensitive inventory;
- a deterministic hash of the exact source artifacts used by the check;
- provenance for the check and execution environment;
- a previous-record hash and record hash for tamper detection.

An empty store is valid before runtime execution. An empty store is **not** runtime proof and never lifts the production hold.

## Store boundary

Runtime records are written below `evidence/r14_1/runtime/records.jsonl`. This directory is deployment/runtime state and is excluded from the immutable sales manifest.

## Verification

```bash
npm run verify:runtime-evidence
```

The verifier checks release, inventory, artifact-set binding, record sequence, provenance, and the hash chain. It never fabricates evidence and never changes `PRODUCTION_HOLD`.

## Capturing a runtime record

Use `packages/core/src/runtimeEvidenceCapture.js` from a disposable, staging, or production verification runner after the external system has actually been exercised. The caller must provide a real `releaseId`, inventory hash, artifact list, execution identity, and evidence reference.

The runtime chain complements — and does not replace — `packages/core/src/productionHold.js` and the buyer-owned production readiness attestation.
