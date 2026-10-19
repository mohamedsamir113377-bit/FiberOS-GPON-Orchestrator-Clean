# Payment-plan / CI run isolation — 2026-10-14

This branch was created from frozen source snapshot `ed57d107574bfd2e28f840615b81dccb74ad35e0` to investigate payment-plan-related CI activity away from `main`.

Important GitHub Actions behavior:
- An existing workflow run is permanently associated with the commit and ref on which it was triggered. It cannot be moved or reassigned to another branch.
- This branch creation does not turn failed checks on `main` green and does not change any existing run.
- Run-specific investigation and any deliberate rerun should target this branch or a dedicated fix branch after the exact failing workflow/job is identified.
- No workflow logic, payment behavior, production database, or deployment was changed by creating this branch.

Known failed runs on the source snapshot:
- Website build: `38496182535`
- Truth check: `38496182577`
- Visual regression: `38496182579`
- Release admission: `38496182512`

Detailed job steps/logs were unavailable through the connected GitHub interface at the time this note was written. Do not assert a root cause until logs or reproducible evidence establish it.
