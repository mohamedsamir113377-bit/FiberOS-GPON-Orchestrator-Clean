'use strict';

const net = require('net');

function list(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function validPort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

function validCidr(value) {
  const parts = String(value || '').trim().split('/');
  const version = net.isIP(parts[0]), bits = Number(parts[1]);
  return parts.length === 2 && version > 0 && Number.isInteger(bits) && bits > 0 && bits <= (version === 4 ? 32 : 128);
}

function dedupeSorted(values) {
  return [...new Set(values)].sort();
}

function configuredPort(v) { return validPort(v) ?? String(v); }

function nftSetElements(values) {
  return values.length === 1 ? values[0] : `{ ${values.join(', ')} }`;
}

function nftAddressSet(name, type, values) {
  const elements = values.length ? ` elements = { ${values.join(', ')} }` : '';
  return `  set ${name} { type ${type}; flags interval;${elements} }`;
}

function parsePolicy(env) {
  env = env || process.env;
  const cfg = {
    table: String(env.FIBEROS_NFT_TABLE || 'fiberos'),
    ingressCidrs: dedupeSorted(list(env.FIBEROS_FW_INGRESS_CIDRS)),
    adminCidrs: dedupeSorted(list(env.FIBEROS_FW_ADMIN_CIDRS)),
    egressCidrs: dedupeSorted(list(env.FIBEROS_FW_EGRESS_CIDRS)),
    resolverCidrs: dedupeSorted(list(env.FIBEROS_FW_RESOLVER_CIDRS)),
    ntpCidrs: dedupeSorted(list(env.FIBEROS_FW_NTP_CIDRS)),
    ingressPorts: dedupeSorted(list(env.FIBEROS_FW_INGRESS_PORTS || '443').map(configuredPort)),
    adminPorts: dedupeSorted(list(env.FIBEROS_FW_ADMIN_PORTS || '22').map(configuredPort)),
    containerCidrs: dedupeSorted(list(env.FIBEROS_FW_CONTAINER_CIDRS)),
    containerSubnet: String(env.FIBEROS_CONTAINER_SUBNET || '').trim(),
    allowIcmpEcho: String(env.FIBEROS_FW_ALLOW_ICMP_ECHO || 'false').toLowerCase() === 'true',
    strictOutput: String(env.FIBEROS_FW_STRICT_OUTPUT || 'true').toLowerCase() !== 'false'
  };
  return Object.freeze(cfg);
}

function validatePolicy(cfg) {
  const failures = [];
  const review = [];
  if (!cfg.table || !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(cfg.table)) failures.push('INVALID_NFT_TABLE_NAME');
  for (const field of ['ingressCidrs', 'adminCidrs', 'egressCidrs', 'resolverCidrs', 'ntpCidrs', 'containerCidrs']) {
    for (const cidr of cfg[field]) if (!validCidr(cidr)) failures.push(`INVALID_CIDR:${field}:${cidr}`);
  }
  for (const field of ['ingressPorts', 'adminPorts']) {
    for (const port of cfg[field]) if (!validPort(port)) failures.push(`INVALID_PORT:${field}:${port}`);
  }
  if (!cfg.ingressCidrs.length) failures.push('NO_INGRESS_ALLOWLIST');
  if (!cfg.containerCidrs.length) failures.push('NO_CONTAINER_NETWORK_ALLOWLIST');
  if (cfg.containerSubnet && !validCidr(cfg.containerSubnet)) failures.push('INVALID_CIDR:containerSubnet:' + cfg.containerSubnet);
  else if (cfg.containerSubnet && !cfg.containerCidrs.includes(cfg.containerSubnet)) failures.push('CONTAINER_SUBNET_NOT_IN_FIREWALL_ALLOWLIST');
  if (cfg.strictOutput) {
    if (!cfg.resolverCidrs.length) failures.push('STRICT_OUTPUT_REQUIRES_RESOLVER_ALLOWLIST');
    if (!cfg.ntpCidrs.length) failures.push('STRICT_OUTPUT_REQUIRES_NTP_ALLOWLIST');
    if (!cfg.egressCidrs.length) failures.push('STRICT_OUTPUT_REQUIRES_EGRESS_ALLOWLIST');
  }
  if (!cfg.adminCidrs.length) review.push('ADMIN_SSH_NOT_ALLOWED_BY_HOST_FIREWALL');
  return { ok: failures.length === 0, failures, review };
}

function renderPolicy(env) {
  const cfg = parsePolicy(env);
  const validation = validatePolicy(cfg);
  if (!validation.ok) {
    const err = new Error(`FIBEROS_NFT_POLICY_INVALID:${validation.failures.join('|')}`);
    err.code = 'INVALID_POLICY';
    err.validation = validation;
    throw err;
  }

  const lines = [];
  lines.push(`# FiberOS host firewall — generated policy, fail-closed.`);
  lines.push(`# This file contains only operator-supplied allowlists. Missing inputs are fatal.`);
  lines.push(`table inet ${cfg.table} {`);
  lines.push(nftAddressSet('ingress4', 'ipv4_addr', cfg.ingressCidrs.filter(x => net.isIP(x.split('/')[0]) === 4)));
  lines.push(nftAddressSet('ingress6', 'ipv6_addr', cfg.ingressCidrs.filter(x => net.isIP(x.split('/')[0]) === 6)));
  lines.push(nftAddressSet('admin4', 'ipv4_addr', cfg.adminCidrs.filter(x => net.isIP(x.split('/')[0]) === 4)));
  lines.push(nftAddressSet('admin6', 'ipv6_addr', cfg.adminCidrs.filter(x => net.isIP(x.split('/')[0]) === 6)));
  lines.push(nftAddressSet('egress4', 'ipv4_addr', cfg.egressCidrs.filter(x => net.isIP(x.split('/')[0]) === 4)));
  lines.push(nftAddressSet('egress6', 'ipv6_addr', cfg.egressCidrs.filter(x => net.isIP(x.split('/')[0]) === 6)));
  lines.push(nftAddressSet('resolver4', 'ipv4_addr', cfg.resolverCidrs.filter(x => net.isIP(x.split('/')[0]) === 4)));
  lines.push(nftAddressSet('resolver6', 'ipv6_addr', cfg.resolverCidrs.filter(x => net.isIP(x.split('/')[0]) === 6)));
  lines.push(nftAddressSet('ntp4', 'ipv4_addr', cfg.ntpCidrs.filter(x => net.isIP(x.split('/')[0]) === 4)));
  lines.push(nftAddressSet('ntp6', 'ipv6_addr', cfg.ntpCidrs.filter(x => net.isIP(x.split('/')[0]) === 6)));
  lines.push(nftAddressSet('container4', 'ipv4_addr', cfg.containerCidrs.filter(x => net.isIP(x.split('/')[0]) === 4)));
  lines.push(nftAddressSet('container6', 'ipv6_addr', cfg.containerCidrs.filter(x => net.isIP(x.split('/')[0]) === 6)));
  lines.push(`  chain input {`);
  lines.push(`    type filter hook input priority 0; policy drop;`);
  lines.push(`    ct state invalid drop`);
  lines.push(`    ct state established,related accept`);
  lines.push(`    iifname lo accept`);
  lines.push(`    tcp dport ${nftSetElements(cfg.ingressPorts)} ip saddr @ingress4 ct state new accept`);
  lines.push(`    tcp dport ${nftSetElements(cfg.ingressPorts)} ip6 saddr @ingress6 ct state new accept`);
  if (cfg.adminCidrs.length) {
    lines.push(`    tcp dport ${nftSetElements(cfg.adminPorts)} ip saddr @admin4 ct state new accept`);
    lines.push(`    tcp dport ${nftSetElements(cfg.adminPorts)} ip6 saddr @admin6 ct state new accept`);
  }
  lines.push(`    icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert } accept`);
  if (cfg.allowIcmpEcho) {
    lines.push(`    icmp type echo-request limit rate 5/second burst 10 packets accept`);
    lines.push(`    icmpv6 type echo-request limit rate 5/second burst 10 packets accept`);
  }
  lines.push(`  }`);
  lines.push(`  chain forward {`);
  lines.push(`    type filter hook forward priority 0; policy drop;`);
  lines.push(`    ct state invalid drop`);
  lines.push(`    ct state established,related accept`);
  lines.push(`    ip saddr @container4 ip daddr @container4 ct state new accept`);
  lines.push(`    ip6 saddr @container6 ip6 daddr @container6 ct state new accept`);
  lines.push(`  }`);
  lines.push(`  chain output {`);
  lines.push(`    type filter hook output priority 0; policy ${cfg.strictOutput ? 'drop' : 'accept'};`);
  lines.push(`    ct state invalid drop`);
  lines.push(`    ct state established,related accept`);
  lines.push(`    oifname lo accept`);
  if (cfg.strictOutput) {
    lines.push(`    udp dport 53 ip daddr @resolver4 ct state new accept`);
    lines.push(`    tcp dport 53 ip daddr @resolver4 ct state new accept`);
    lines.push(`    udp dport 53 ip6 daddr @resolver6 ct state new accept`);
    lines.push(`    tcp dport 53 ip6 daddr @resolver6 ct state new accept`);
    lines.push(`    udp dport 123 ip daddr @ntp4 ct state new accept`);
    lines.push(`    udp dport 123 ip6 daddr @ntp6 ct state new accept`);
    lines.push(`    tcp dport 443 ip daddr @egress4 ct state new accept`);
    lines.push(`    tcp dport 443 ip6 daddr @egress6 ct state new accept`);
  }
  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');
  return { config: cfg, validation, policy: lines.join('\n') };
}

function staticAudit(policyText) {
  const required = [
    /table inet [A-Za-z_][A-Za-z0-9_]{0,31} \{/,
    /chain input \{[\s\S]*policy drop;/,
    /chain forward \{[\s\S]*policy drop;/,
    /chain output \{[\s\S]*policy drop;/,
    /ct state invalid drop/,
    /ct state established,related accept/,
    /iifname lo accept/,
    /tcp dport[\s\S]*ct state new accept/
  ];
  const failures = [];
  for (const re of required) if (!re.test(policyText)) failures.push('MISSING:' + re);
  if (/0\.0\.0\.0\/0/.test(policyText) || /::\/0/.test(policyText)) failures.push('UNIVERSAL_CIDR_FOUND');
  if (/chain output \{[\s\S]*policy accept;/.test(policyText)) failures.push('OUTPUT_POLICY_MUST_BE_DROP');
  if (/chain forward \{[\s\S]*\baccept;/.test(policyText) &&
      !/ip[6]? saddr @container[46] ip[6]? daddr @container[46] ct state new accept/.test(policyText)) {
    failures.push('FORWARD_ACCEPT_NOT_CONTAINER_SCOPED');
  }
  if (!/tcp dport 443 (?:ip|ip6) daddr (?:@egress4|@egress6) ct state new accept/.test(policyText)) {
    failures.push('HTTPS_EGRESS_ALLOWLIST_RULE_MISSING');
  }
  return { ok: failures.length === 0, failures };
}

module.exports = Object.freeze({ parsePolicy, validatePolicy, renderPolicy, staticAudit, validCidr, validPort });
