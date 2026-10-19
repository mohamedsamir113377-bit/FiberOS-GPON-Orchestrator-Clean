# FiberOS host firewall lifecycle

This directory documents the **operator-controlled** nftables boundary. It is not a production firewall by itself and must not be applied until the operator has supplied the real ingress, container, resolver, NTP, and HTTPS egress CIDRs.

## Safe lifecycle

1. Render a policy from explicit environment allowlists:

   ```bash
   node scripts/firewall/render-nft-policy.js /tmp/fiberos.nft
   ```

2. Syntax-check without changing the live ruleset:

   ```bash
   sudo scripts/firewall/apply-nft-policy.sh --check /tmp/fiberos.nft
   ```

3. Review the generated file and confirm the management source, service interfaces, IPv4/IPv6 routes, DNS, NTP, and approved HTTPS destinations. The script never discovers or invents these values.

4. Apply only during an approved maintenance window:

   ```bash
   sudo scripts/firewall/apply-nft-policy.sh --apply /tmp/fiberos.nft
   ```

   The script validates the one configured `inet` table, snapshots only that table to `/run/fiberos-firewall/last-known-good-table.nft`, and replaces it in one nftables transaction. The operation is serialized with a state-directory lock. A failed apply or post-apply check attempts to restore only the previous managed table; unrelated nftables tables are not snapshotted or replayed.

5. Manual rollback:

   ```bash
   sudo scripts/firewall/apply-nft-policy.sh --rollback
   ```

## Required test matrix before live use

- IPv4 and IPv6 ingress from approved and unapproved sources.
- Existing established/related connections remain accepted.
- DNS UDP/TCP 53 only to the declared resolver sets.
- NTP UDP 123 only to the declared NTP sets.
- HTTPS TCP 443 only to the declared egress sets.
- All other new output and forwarding attempts are rejected.
- Missing allowlists cause rendering to fail; they never produce an open policy.
- Verify the actual interface and route layout in a staging environment that matches the buyer deployment.

`--check` is a parser validation, not proof of reachability or production readiness. This repository deliberately does not apply the policy to a customer host.
