# FiberOS R14.1 — Online Commercial License / Order Terms Template

**Template only. Obtain local legal review before publishing as binding online terms.**

## 1. Online purchase model

FiberOS R14.1 may be sold through an online checkout as a digital software product. The purchaser reviews the applicable license and order terms before payment and accepts them through the checkout flow.

Unless a purchased tier or separate valid agreement states otherwise, the standard license is **non-exclusive, worldwide, commercial, and does not transfer IP ownership**.

## 2. Asset

The delivered asset is the FiberOS R14.1 Sales Core source distribution identified by the exact bytes delivered:

- Product: `FiberOS R14.1 Sales Core`
- Package version: `1.0.0-rc.1+commercial.2026-09-25`
- Production migration chain: `001–196`
- Delivery archive: `[FINAL ZIP NAME]`
- SHA-256: `[FINAL ZIP SHA-256]`

## 2A. Language catalog scope and automated-translation notice

The declared language scope consists of the 84 catalogs enumerated in `i18n/official-84.json`. In the 114-catalog source manifest, 2 catalogs carry the `verified` status label and 112 are `machine-draft` (0 catalogs remain untranslated); the 30 catalogs outside this 84-catalog scope ship as machine-draft within the official-114 structural pack.

The translations were generated automatically. This contractual scope accepts automated translation as a delivery format only; it does not represent native-speaker review, human certification, or a guarantee of semantic correctness. The current human-certified catalog count is zero. The purchaser should have legal, safety-critical, billing and customer-facing text reviewed before operational use.

## 3. Price and payment

Reference list price: **USD 3,500**.

Actual online price: **[AMOUNT] [CURRENCY]**.

Selected license tier: **[STANDARD ONLINE COMMERCIAL / SOURCE RESALE-MASTER RESELLER / OTHER]**.

The online order record controls the actual transaction price and selected license tier.

## 4. Standard license grant

Upon successful purchase and acceptance of the applicable online terms, the seller grants the purchaser a non-exclusive, worldwide commercial license to:

- install and run FiberOS;
- use it for lawful commercial operations;
- modify and customize the delivered source for the purchaser's business;
- deploy buyer-branded/white-label solutions where the purchaser has the necessary branding rights;
- sell deployed services, managed services, implementations, and end-customer solutions based on the authorized deployment.

## 5. Seller rights

The seller retains the right to use FiberOS and to sell or license the same release to other customers. The standard license creates no exclusivity.

## 6. Source redistribution

The standard license does not grant standalone resale or redistribution of the original source archive, public source publication, downstream source sublicensing, master-reseller/source-redistribution rights, or IP assignment.

If a source-resale/master-reseller tier is purchased, its exact downstream rights and limits must be recorded in the order or a separate valid agreement.

## 7. Delivery and acceptance

Delivery consists of the exact digital source archive and agreed documentation. The SHA-256 identifies the delivered bytes. The purchaser should validate the declared runtime prerequisites and its own environment before production go-live.

## 8. Technical condition and production boundary

The package is a **Commercial Release Candidate** with seller/reference-environment verification evidence dated 2026-09-25. That evidence is not certification of the purchaser's infrastructure.

Buyer production requires its own PostgreSQL/PostGIS, identity, TLS/ingress, secrets, backup/restore, rate-limit, external-adapter, tenant-isolation, and production-attestation verification unless separately scoped.

## 9. Intellectual property

This license does not transfer ownership or assign FiberOS intellectual property. Third-party/open-source components remain subject to their applicable licenses. Any assignment must be separately and expressly documented by a party with the legal right to make it.

## 10. Support

Standard proposal: **14 calendar days** from the support start date recorded in the order.

Custom development, dashboards, custom UI/UX, infrastructure operations, database administration, identity-provider administration, hosting, and new external integrations are separately scoped unless expressly included.

## 11. Warranties and disclaimers

No guarantee of revenue, customer acquisition, uptime, regulatory compliance, production certification, or business outcome is made unless expressly stated in the applicable terms.

## 12. Online records and terms versioning

The seller should retain the order ID, purchaser, product/version, license tier, package SHA-256, purchase timestamp, price/currency, and exact version of the terms accepted at checkout.

## 13. Entire agreement / contractual hierarchy

The applicable online checkout terms and purchased license tier govern the transaction. A separately executed agreement controls only where it expressly modifies those terms and is legally valid.

**Seller:** ____________________  **Date:** __________

**Buyer / Purchaser:** _____________________  **Date:** __________

<!-- FIBERNEXUS_LANGUAGE_SCOPE_START -->
## Included language catalog scope

The official language catalog delivery scope includes the 84 catalogs listed in `i18n/official-84.json`; the 30 catalogs outside this scope ship as machine-draft in the official-114 structural pack.

**Translation was performed automatically.**
<!-- FIBERNEXUS_LANGUAGE_SCOPE_END -->
