# Edge nginx for FiberOS API

`api-edge-ddos.conf` is a **buyer-operated** reverse-proxy profile:

- `limit_req` — request rate per IP
- `limit_conn` — concurrent connections per IP
- short header/body timeouts — reduce slowloris pressure
- TLS 1.2+ only

## Mandatory architecture for volumetric DDoS

```
Internet → CDN / Cloud WAF / Shield (L3–L7 absorb)
        → nginx edge (optional, connection/req limits)
        → FiberOS API on loopback (app firewall + rate limit + ddosGuard)
```

Never publish Node ports (`8080`) to `0.0.0.0` on the public Internet without an edge.

## Cloudflare (example)

1. Orange-cloud the API hostname.
2. Firewall rules: bot fight / rate limiting at Cloudflare.
3. Origin firewall: **allow only Cloudflare IP ranges** to nginx:443.
4. Set FiberOS:

```bash
TRUST_PROXY=true
TRUST_PROXY_CIDR=<your nginx or CF tunnel peer CIDR>
SECURITY_REQUIRE_HTTPS=true
SECURITY_ALLOWED_HOSTS=api.yourdomain.com
```

## AWS

- Put ALB/API Gateway + **AWS Shield Standard** (or Advanced) in front.
- Security groups: only ALB → task/instance.
- Optional AWS WAF rate-based rules.

## Honesty boundary

Nginx/Cloudflare configs here are **templates**. Buyer must provision certificates, DNS, and provider accounts. FiberOS application code cannot absorb multi-Gbps L3 floods in-process.
