# Volumetric DDoS — edge protection (buyer-owned)

## What “volumetric” means

Attacks that exhaust **network bandwidth or packet capacity** (UDP/SYN floods, amplification, multi-Gbps HTTP floods) must be stopped **before** packets reach the FiberOS process.

| Layer | Who operates it | FiberOS role |
|-------|-----------------|--------------|
| L3/L4 volumetric absorb | CDN / cloud DDoS (Cloudflare, AWS Shield, Azure DDoS, GCP Cloud Armor) | None in-process |
| L7 HTTP flood at edge | Same edge + WAF rate rules | Configures trusted proxy |
| Reverse proxy limits | Buyer nginx (`deploy/nginx/api-edge-ddos.conf`) | Template only |
| In-process concurrency + rate limit | FiberOS `ddosGuard` + `SECURITY_RATE_LIMIT_*` + firewall | Implemented in product |

## Required production topology

1. **Public DNS** points only to the edge provider (or Anycast).
2. **Origin** accepts traffic only from edge IP ranges (host firewall / security group).
3. API containers bind **loopback or private network** (see `docker-compose.sales.yml`: `127.0.0.1:8080:8080`).
4. Enable:

```bash
TRUST_PROXY=true
TRUST_PROXY_CIDR=<CIDR of nginx or mesh peer that terminates TLS>
SECURITY_REQUIRE_HTTPS=true
SECURITY_FIREWALL_ENABLED=true
SECURITY_DDOS_GUARD_ENABLED=true
SECURITY_RATE_LIMIT_BACKEND=REDIS   # multi-instance
SECURITY_RATE_LIMIT_EXPECTED_INSTANCES=<N>
```

5. Static website: Netlify/Cloudflare Pages (provider edge DDoS is included for the site surface).

## Acceptance checks

- [ ] Origin port 8080 not reachable from the public Internet
- [ ] Synthetic flood from a single IP receives `429` at edge or origin without process OOM
- [ ] Health check still succeeds from allowlisted probes
- [ ] Application logs show `X-Forwarded-For` / real client IP only when peer is trusted

## What this repository ships

- `deploy/nginx/api-edge-ddos.conf` — nginx limit_req / limit_conn profile
- `packages/security/src/ddosGuard.js` — in-process concurrent request caps
- Application firewall + rate limiter — after traffic has already been accepted by the OS

**No vendor API keys or paid Shield subscriptions are embedded.** Buyers attach their own edge contract.
