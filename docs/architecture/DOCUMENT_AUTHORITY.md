# FiberOS R14.1 — Document Authority Map

## Current authoritative release documents

For commercial delivery and buyer-facing claims, use these files first:

1. `docs/commercial/COMMERCIAL_RELEASE_STATUS.md` — current release status, verification scope, and buyer acceptance boundary.
2. `docs/commercial/COMMERCIAL_PACKAGE_NOTICE.txt` — archive-level commercial boundary.
3. `docs/commercial/RESELLER_COMMERCIAL_PACKAGE.md` — reference commercial model and reseller rights scope.
4. `docs/commercial/SALES_AGREEMENT_TEMPLATE.md` — transaction terms template; the executed agreement controls.
5. `BUYER_QUICKSTART.md` and `docs/commercial/SELLER_README.md` — current runtime and deployment contract.
6. `SECURITY.md` — current security boundary.
7. `config/commercial-release-contract.v1.json` — machine-readable release truth for version, reference price, support period, runtime baseline, and migration range.

## Historical engineering documents

Files under `docs/` and dated audit/review records preserve historical engineering work. They may contain older package versions, migration ranges, counts, or intermediate findings. Those historical facts are not current commercial claims unless they are explicitly reconciled by the current release documents above.

## Source of truth for technical behavior

When documentation conflicts with executable source, numbered migrations, release verification scripts, or the generated sales manifest, the executable source and release-integrity gates govern technical behavior.

## Source of truth for transaction rights

The signed commercial agreement governs price, licensing, ownership, reseller/white-label rights, support, exclusions, and remedies. No markdown or text file in the archive is a substitute for the executed agreement.
