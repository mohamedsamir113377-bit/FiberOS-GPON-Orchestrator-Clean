# Dependency & Supply-Chain Disclosure

This package includes `package-lock.json` and `SBOM.cdx.json`. The lockfile is the installation authority for the delivered source tree; the SBOM inventories the dependency set represented by that lockfile and is not, by itself, a vulnerability, license-compliance, or production-security certification.

## Current reconciled dependency state

- Root/package workspace graph is consistent with the delivered `package-lock.json`.
- The current lockfile contains **192 package records**.
- The current checked-in CycloneDX SBOM contains **135 component entries**.
- The release-integrity gate validates workspace identity/version parity and the migration/hash contracts before dependency installation.
- The canonical CI workflow runs registry-backed vulnerability checks against the lockfile before commercial release admission.

## Historical vulnerability evidence

The external verification record dated 2026-09-25 reports a point-in-time `npm audit` result of 0 vulnerabilities and an OSV-Scanner result with no reported issues for that earlier evidence set. Those results are historical observations and are not presented as an evergreen guarantee for the current archive.

## Current test-environment limitation

The present audit environment has Node.js 22.16.0, while the package requires Node.js 24.21.0. The current local test command therefore cannot serve as a clean production-runtime dependency installation proof. A current Node 24.21.0 CI run should be retained with the exact final archive/source commit before publishing a zero-failure test claim.

## Third-party license boundary

Third-party/open-source components remain subject to their applicable licenses. The seller does not claim ownership of third-party code merely because it is included in the archive. A buyer requiring a formal license-compliance opinion should conduct its own review or obtain legal review.
