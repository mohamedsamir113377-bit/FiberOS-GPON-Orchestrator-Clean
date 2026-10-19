#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { renderPolicy, staticAudit } = require('../../packages/network-firewall-policy/src');

const output = process.argv[2];
if (!output || process.argv.length !== 3) {
  console.error('usage: render-nft-policy.js <output.nft>');
  process.exit(2);
}
const rendered = renderPolicy(process.env);
const audit = staticAudit(rendered.policy);
if (!audit.ok) {
  console.error(`FIBEROS_NFT_STATIC_AUDIT_FAILED:${audit.failures.join('|')}`);
  process.exit(1);
}
const target = path.resolve(output);
fs.mkdirSync(path.dirname(target), { recursive: true });
const temporary = `${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary, rendered.policy, { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temporary, target);
console.log(`FIBEROS_NFT_POLICY_RENDERED:${target}`);
