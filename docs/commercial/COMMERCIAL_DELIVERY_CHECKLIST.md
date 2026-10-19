# FiberOS R14.1 — Commercial Delivery Checklist

Use this checklist immediately before each buyer delivery.

## Identity and integrity

- [ ] Package version matches `package.json`, `package-lock.json`, and `SALES_PACKAGE_MANIFEST.json`.
- [ ] Final archive SHA-256 is recorded in the transaction record.
- [ ] `.env.example` contains placeholders only.
- [ ] No private keys, live credentials, or `.git` directory are present.

## Runtime and security

- [ ] Node.js baseline is 24.21.0.
- [ ] PostgreSQL 18.6+ / PostGIS 3.6.x requirements are stated.
- [ ] Production Hold defaults fail-closed.
- [ ] OIDC/JWKS is the production identity path.
- [ ] Canonical application-role admission middleware is active.
- [ ] Handler ownership/tenant/lifecycle checks and PostgreSQL/RLS authority remain intact.
- [ ] Rate-limit disclosure matches the implemented backend.

## Database

- [ ] `sql/bootstrap/00_production_roles.sql` is present.
- [ ] Production migration chain is `001–196`.
- [ ] `PRODUCTION_MIGRATIONS.txt`, `PRODUCTION_MIGRATIONS.sha256`, and `PRODUCTION_MIGRATIONS.extra.sha256` agree with the complete `001–196` chain.
- [ ] `sql/bootstrap/20_runtime_role_grants.sql` is documented for post-migration execution.
- [ ] `package-lock.json` contains the new workspace links for operations-trace and gis-reconciliation.
- [ ] `web-truth.json` uses handoff branch provenance and a release-freeze commit marker, not a stale historical SHA.
- [ ] capability registry contains only shipped evidence references or explicitly bounded non-runtime statuses.

## Commercial terms

- [ ] Reference list price is USD 3,500; current online campaign price is USD 3,000 (USD 500 discount). The order record contains the actual transaction terms.
- [ ] Standard support proposal is 14 calendar days unless the signed agreement says otherwise.
- [ ] Online license tier is identified in the order record.
- [ ] Campaign price, if applicable, is USD 3,000 and list price is USD 3,500.
- [ ] Standard license grants commercial use and deployed-service/solution resale.
- [ ] Source redistribution/master-reseller rights are explicitly excluded or granted in the selected tier.
- [ ] IP ownership and third-party license boundaries are reviewed.

## Evidence and acceptance

- [ ] `docs/commercial/COMMERCIAL_RELEASE_STATUS.md` is supplied with the delivery.
- [ ] Seller/reference verification evidence is retained separately from customer-production certification.
- [ ] The exact online terms/license version accepted at checkout is retained with the order.
- [ ] Any historical or failed evidence is not presented as a current PASS.
- [ ] Buyer acceptance is completed before production go-live.
