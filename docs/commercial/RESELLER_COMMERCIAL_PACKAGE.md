# FiberOS R14.1 — Online Commercial / Reseller Package

> Commercial policy template. The standard online license is non-exclusive. Any expanded source-resale or master-reseller tier must be explicitly selected at checkout or in a separate valid agreement.

## Release identity

- Version: `1.0.0-rc.1+commercial.2026-09-25`
- Release status: **Commercial Release Candidate**
- Production migration chain: **001–196**
- Reference list price: **USD 3,500**
- Current online campaign price: **USD 3,000** (USD 500 discount)
- Standard support proposal: **14 calendar days**

The reference list price is an offer-positioning baseline, not a binding transaction price. The online order record and applicable checkout terms control the actual amount and selected license tier.

## Standard online commercial model

The default model is **non-exclusive, worldwide commercial licensing**. The seller may continue to use and sell FiberOS to other customers.

The purchaser may, subject to the standard license:

1. install and deploy the delivered source in its own environments;
2. use it for lawful internal and commercial operations;
3. modify and customize the delivered source for its business;
4. rebrand buyer-visible product surfaces where legally permitted;
5. create and sell deployed white-label implementations, managed services, implementation services, and end-customer solutions built from the authorized deployment.

## Source resale boundary

The standard online license does **not** include:

- standalone resale of the original FiberOS source archive;
- public source publication or repository redistribution;
- downstream source sublicensing;
- master-reseller/source-redistribution rights;
- IP assignment or exclusivity.

A separate **Source Resale / Master Reseller** tier may be offered, but its scope must be explicitly stated in the checkout/order record or a separate valid agreement.

## Online order record

Each sale should retain:

- order ID and purchaser/legal entity;
- product/version;
- selected license tier;
- exact archive SHA-256;
- purchase timestamp;
- price/currency;
- accepted license/terms version;
- support dates where applicable.

## Support

The current standard proposal is 14 calendar days. Support is not a 24/7 SLA unless separately purchased.

## Production boundary

The purchaser remains responsible for validating its production infrastructure, including PostgreSQL/PostGIS, OIDC/JWKS, TLS/ingress, secrets, backup/restore, rate limiting, external adapters, tenant isolation, and production attestation.

## Legal boundary

This document is a commercial-operating template, not legal advice. The online checkout terms and applicable law should be reviewed for the seller's jurisdiction and sales markets.
