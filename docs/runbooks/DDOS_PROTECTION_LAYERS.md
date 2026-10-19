# DDoS protection layers — volumetric + software

FiberOS separates **network volumetric** defense (buyer edge) from **software HTTP flood** defense (in product).

## 1) Volumetric (L3/L4) — buyer edge only

Absorb multi-Gbps / SYN / amplification **before** origin:

- CDN / Cloudflare / AWS Shield / Azure DDoS / GCP Cloud Armor
- Origin firewall: allow **only** edge IP ranges
- API not published on public `0.0.0.0:8080` (use `127.0.0.1` + nginx)

Templates:

- `docs/runbooks/VOLUMETRIC_DDOS_EDGE_PROTECTION.md`
- `deploy/nginx/api-edge-ddos.conf` (`limit_req`, `limit_conn`, timeouts)

## 2) Software / application HTTP flood — in FiberOS

After a request reaches the process:

| Control | Location | Codes |
|---------|----------|--------|
| Concurrent per IP + global + short rate window | `packages/security/src/ddosGuard.js` | `DDOS_IP_CONCURRENCY`, `DDOS_GLOBAL_CONCURRENCY`, `DDOS_IP_RATE` |
| Token-bucket rate limit | `packages/security/src/httpHardening.js` | `RATE_LIMIT_EXCEEDED` |
| Path/method/probe/body firewall | `packages/security-firewall` | `PROBE_PATH_BLOCKED`, `METHOD_NOT_ALLOWED`, … |
| Replay defense | Redis SET NX | fail-closed when required |
| RLS / tenant isolation | PostgreSQL | data-plane, not flood |

### Environment (software)

```bash
SECURITY_DDOS_GUARD_ENABLED=true
SECURITY_DDOS_MAX_CONCURRENT_PER_IP=32
SECURITY_DDOS_MAX_GLOBAL_CONCURRENT=512
SECURITY_DDOS_MAX_REQUESTS_PER_WINDOW=120
SECURITY_DDOS_RATE_WINDOW_MS=1000
SECURITY_RATE_LIMIT_PER_MINUTE=120
SECURITY_RATE_LIMIT_BURST=30
SECURITY_RATE_LIMIT_BACKEND=REDIS   # multi-instance
SECURITY_FIREWALL_ENABLED=true
SECURITY_REQUIRE_HTTPS=true
TRUST_PROXY=true
TRUST_PROXY_CIDR=<edge peer CIDR>
```

## 3) Acceptance

- [ ] Public Internet cannot open origin `:8080` directly
- [ ] Edge returns challenge/429 under synthetic flood
- [ ] Origin still returns `429`/`503` with `X-FiberOS-DDoS-Guard` if flood reaches app
- [ ] Legitimate health checks from allowlisted probes succeed

## Honesty

No single Node process replaces Anycast volumetric scrubbing. Claiming otherwise is false. This repository implements software controls and ships edge **templates** for the buyer to operate.
