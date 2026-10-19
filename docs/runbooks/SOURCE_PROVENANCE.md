# Source Provenance — Commercial Delivery

## Delivery identity

- Product: FiberOS R14.1 Sales Core
- Version: `1.0.0-rc.1+commercial.2026-09-25`
- Preparation date: 2026-09-25
- Current reconciliation candidate: PR #74 on `fix/m191-release-provenance-reconciliation`. The previously checked PR candidate passed release admission and its exact source/runtime gates; PR #74 remains Draft/unmerged. `main` still points to `2527d64754766ab530650648cb1e25da03a52662` with release-source/RLS failures caused by manifest and inventory counters at 190 against the 191-file migration chain. Re-run release admission after merge; the candidate branch is not a substitute for a green `main` head.
- Release chain: `001-196`
- Release status: Commercial Release Candidate

## Integrity

The final delivery archive is identified by a SHA-256 sidecar. The buyer should calculate the digest after transfer and compare it with the transaction record before acceptance.

## Provenance boundary

This document records commercial-release provenance facts. It is **not** a SLSA attestation and makes no SLSA level claim. A buyer requiring formal supply-chain provenance attestations should perform or request those controls separately.


## Current handoff provenance rule

The authoritative final-tree identity is the exact handoff branch at release freeze. Derived artifacts must not embed stale historical commit SHAs as current provenance; the final manifest is the canonical file-level binding.
