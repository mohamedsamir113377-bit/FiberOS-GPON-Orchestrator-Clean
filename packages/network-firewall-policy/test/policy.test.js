'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPolicy, staticAudit, validatePolicy } = require('../src');

const validEnv = {
  FIBEROS_FW_INGRESS_CIDRS: '198.51.100.0/24,2001:db8:10::/64',
  FIBEROS_FW_CONTAINER_CIDRS: '172.30.0.0/16,fd00:30::/64',
  FIBEROS_CONTAINER_SUBNET: '172.30.0.0/16',
  FIBEROS_FW_EGRESS_CIDRS: '198.51.100.10/32,2001:db8:20::10/128',
  FIBEROS_FW_RESOLVER_CIDRS: '198.51.100.53/32,2001:db8:53::53/128',
  FIBEROS_FW_NTP_CIDRS: '198.51.100.123/32,2001:db8:123::123/128',
  FIBEROS_FW_ADMIN_CIDRS: '198.51.100.22/32'
};

test('strict policy requires every operator-supplied network boundary', () => {
  const result = validatePolicy({
    table: 'fiberos',
    ingressCidrs: ['198.51.100.0/24'],
    adminCidrs: [],
    egressCidrs: [],
    resolverCidrs: [],
    ntpCidrs: [],
    ingressPorts: ['443'],
    adminPorts: ['22'],
    containerCidrs: ['172.30.0.0/16'],
    containerSubnet: '172.30.0.0/16',
    strictOutput: true
  });
  assert.equal(result.ok, false);
  assert.throws(() => renderPolicy({ ...validEnv, FIBEROS_FW_INGRESS_PORTS: '443,invalid' }), /INVALID_PORT:ingressPorts:invalid/);
  assert.throws(() => renderPolicy({ ...validEnv, FIBEROS_CONTAINER_SUBNET: 'not-a-cidr' }), /INVALID_CIDR:containerSubnet:not-a-cidr/);
  assert.deepEqual(result.failures.sort(), [
    'STRICT_OUTPUT_REQUIRES_EGRESS_ALLOWLIST',
    'STRICT_OUTPUT_REQUIRES_NTP_ALLOWLIST',
    'STRICT_OUTPUT_REQUIRES_RESOLVER_ALLOWLIST'
  ]);
});

test('rendered strict policy is fail-closed and statically admissible', () => {
  const rendered = renderPolicy(validEnv);
  assert.equal(rendered.validation.ok, true);
  assert.match(rendered.policy, /chain input \{[\s\S]*policy drop;/);
  assert.match(rendered.policy, /chain forward \{[\s\S]*policy drop;/);
  assert.match(rendered.policy, /chain output \{[\s\S]*policy drop;/);
  assert.match(rendered.policy, /tcp dport 443 ip daddr @egress4 ct state new accept/);
  assert.match(rendered.policy, /set admin6 \{ type ipv6_addr; flags interval; \}/);
  assert.doesNotMatch(rendered.policy, /set admin6[\s\S]*elements = \{\s*\}/);
  assert.equal(staticAudit(rendered.policy).ok, true);
});

test('static audit rejects a policy that silently restores unrestricted output', () => {
  const rendered = renderPolicy(validEnv).policy.replace(
    /chain output \{([\s\S]*?)policy drop;/,
    'chain output {$1policy accept;'
  );
  const audit = staticAudit(rendered);
  assert.equal(audit.ok, false);
  assert.ok(audit.failures.includes('MISSING:/chain output \\{[\\s\\S]*policy drop;/'));
  assert.ok(audit.failures.includes('OUTPUT_POLICY_MUST_BE_DROP'));
});

test('strict renderer never emits a universal CIDR or implicit public egress', () => {
  const policy = renderPolicy(validEnv).policy;
  assert.doesNotMatch(policy, /0\.0\.0\.0\/0|::\/0/);
  assert.doesNotMatch(policy, /tcp dport 80/);
  assert.doesNotMatch(policy, /tcp dport 443 accept/);
});
