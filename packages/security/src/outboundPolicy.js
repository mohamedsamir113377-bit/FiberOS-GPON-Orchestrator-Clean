'use strict';

const net = require('node:net');
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');

function production(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production';
}

function csvSet(name, env = process.env) {
  return new Set(String(env[name] || '')
    .split(',').map(v => v.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
}

function allowedHosts(options = {}) {
  return csvSet(options.allowedHostsEnv || 'FIBEROS_SELF_HOSTED_HOSTS', options.env || process.env);
}

function parseIPv4(address) {
  if (net.isIP(address) !== 4) return null;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

function ipv4ToBigInt(address) {
  const p = parseIPv4(address);
  if (!p) return null;
  return (BigInt(p[0]) << 24n) | (BigInt(p[1]) << 16n) | (BigInt(p[2]) << 8n) | BigInt(p[3]);
}

function expandIPv6(address) {
  if (net.isIP(address) !== 6) return null;
  let value = String(address).toLowerCase();
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const v4 = value.slice(lastColon + 1);
    const n = ipv4ToBigInt(v4);
    if (n === null) return null;
    value = `${value.slice(0, lastColon)}:${Number((n >> 16n) & 0xffffn).toString(16)}:${Number(n & 0xffffn).toString(16)}`;
  }
  const sides = value.split('::');
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(':').filter(Boolean) : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(':').filter(Boolean) : [];
  const parseHextets = list => list.map(h => /^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : null);
  const l = parseHextets(left); const r = parseHextets(right);
  if (l.some(v => v === null) || r.some(v => v === null)) return null;
  const missing = sides.length === 2 ? 8 - l.length - r.length : 0;
  if (missing < 0 || (sides.length === 1 && l.length !== 8)) return null;
  const all = l.concat(Array(missing).fill(0), r);
  if (all.length !== 8) return null;
  return all;
}

function ipv6ToBigInt(address) {
  const parts = expandIPv6(address);
  if (!parts) return null;
  return parts.reduce((n, x) => (n << 16n) | BigInt(x), 0n);
}

function cidrContains(address, cidr) {
  const text = String(cidr || '').trim();
  const slash = text.lastIndexOf('/');
  if (slash <= 0) return false;
  const base = text.slice(0, slash);
  const bits = Number(text.slice(slash + 1));
  const af = net.isIP(address);
  if (af !== net.isIP(base) || !Number.isInteger(bits)) return false;
  if (af === 4) {
    if (bits < 0 || bits > 32) return false;
    const ip = ipv4ToBigInt(address); const network = ipv4ToBigInt(base);
    if (ip === null || network === null) return false;
    if (bits === 0) return true;
    const mask = ((1n << BigInt(bits)) - 1n) << BigInt(32 - bits);
    return (ip & mask) === (network & mask);
  }
  if (af === 6) {
    if (bits < 0 || bits > 128) return false;
    const ip = ipv6ToBigInt(address); const network = ipv6ToBigInt(base);
    if (ip === null || network === null) return false;
    if (bits === 0) return true;
    const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
    return (ip & mask) === (network & mask);
  }
  return false;
}

function embeddedIPv4(address) {
  const parts = expandIPv6(address);
  if (!parts) return null;
  if (parts[0] !== 0 || parts[1] !== 0 || parts[2] !== 0 || parts[3] !== 0 || parts[4] !== 0 || parts[5] !== 0xffff) return null;
  return [Number(parts[6] >> 8), Number(parts[6] & 0xff), Number(parts[7] >> 8), Number(parts[7] & 0xff)].join('.');
}

// AI-specific egress policy is stricter than the generic outbound attestation:
 // only loopback, RFC1918 IPv4, and IPv6 ULA destinations count as internal.
 // Link-local, CGNAT, public, multicast, unspecified, and special-use ranges
 // are deliberately not treated as internal AI endpoints.
function isInternalNetworkAddress(address) {
  const value = String(address || '').trim().replace(/^\\[|\\]$/g, '').toLowerCase();
  const family = net.isIP(value);
  if (family === 4) {
    return cidrContains(value, '10.0.0.0/8') ||
      cidrContains(value, '172.16.0.0/12') ||
      cidrContains(value, '192.168.0.0/16') ||
      cidrContains(value, '127.0.0.0/8');
  }
  if (family !== 6) return false;
  const mapped = embeddedIPv4(value);
  if (mapped) return isInternalNetworkAddress(mapped);
  return cidrContains(value, '::1/128') || cidrContains(value, 'fc00::/7');
}

function hasOnlyInternalNetworkTargets(target) {
  const addresses = target && Array.isArray(target.addresses) ? target.addresses : [];
  return addresses.length > 0 &&
    addresses.every(entry => entry && isInternalNetworkAddress(entry.address));
}

function isPrivateOrSpecialAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const p = parseIPv4(address);
    if (!p) return true;
    const [a,b,c] = p;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a >= 224) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    const h = ipv6ToBigInt(address);
    if (h === null) return true;
    const v4 = embeddedIPv4(address);
    if (v4 && isPrivateOrSpecialAddress(v4)) return true;
    return h === 0n || h === 1n ||
      cidrContains(address, 'fc00::/7') ||
      cidrContains(address, 'fe80::/10') ||
      cidrContains(address, 'ff00::/8') ||
      cidrContains(address, '2001:db8::/32');
  }
  return true;
}

function attestedCidrs(options = {}) {
  const env = options.env || process.env;
  return String(env[options.cidrsEnv || 'FIBEROS_SELF_HOSTED_CIDRS'] || '')
    .split(',').map(v => v.trim()).filter(Boolean);
}

function explicitlyAttestedAddress(address, options = {}) {
  return attestedCidrs(options).some(cidr => cidrContains(address, cidr));
}

function localLoopbackLabAllowed(address, options = {}) {
  if (production(options.env || process.env) || !options.allowLabLoopback) return false;
  return address === '127.0.0.1' || address === '::1';
}

function parseAttestedOutboundUrl(raw, options = {}) {
  const envName = options.envName || 'OUTBOUND_URL';
  const codePrefix = options.codePrefix || envName;
  const value = String(raw || '').trim();
  if (!value) throw Object.assign(new Error(`${envName}_REQUIRED`), { code: `${envName}_REQUIRED` });
  let u;
  try { u = new URL(value); } catch (_) {
    throw Object.assign(new Error(`${envName}_INVALID`), { code: `${envName}_INVALID` });
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error(`${codePrefix}_PROTOCOL_INVALID`), { code: `${codePrefix}_PROTOCOL_INVALID` });
  if (u.username || u.password) throw Object.assign(new Error(`${codePrefix}_CREDENTIALS_IN_URL_FORBIDDEN`), { code: `${codePrefix}_CREDENTIALS_IN_URL_FORBIDDEN` });
  if (production(options.env || process.env) && u.protocol !== 'https:') throw Object.assign(new Error(`${codePrefix}_HTTPS_REQUIRED`), { code: `${codePrefix}_HTTPS_REQUIRED` });
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const hosts = allowedHosts(options);
  const labLoopback = options.allowLabLoopback && !production(options.env || process.env) && (host === '127.0.0.1' || host === '::1');
  const hostExplicitlyAttested = hosts.has(host);
  // Note: this must NOT short-circuit on an empty/unset hosts allowlist —
  // that would make allowLabLoopback (deliberately usable with zero
  // allowlist configuration, e.g. in tests) unreachable, since every
  // caller with no HOSTS env configured would be rejected before the
  // labLoopback check is even considered.
  if (!hostExplicitlyAttested && !labLoopback) throw Object.assign(new Error(`${codePrefix}_HOST_NOT_ATTESTED`), { code: `${codePrefix}_HOST_NOT_ATTESTED` });
  // An exact-match entry in the *default* self-hosted-infrastructure
  // allowlist (FIBEROS_SELF_HOSTED_HOSTS) is itself an explicit,
  // administrator-curated attestation for that address — including when the
  // address happens to be private/loopback, which is the normal case for
  // genuinely self-hosted infrastructure (local AI inference, sovereign GIS,
  // contact-center ARI). A *custom* allowlist (e.g. ROUTING_ALLOWED_HOSTS
  // for third-party routing providers, expected to be public internet
  // services) does NOT get this exemption: an operator listing a hostname
  // there has not necessarily considered that it might resolve to a private
  // address, so that path still requires separate, deliberate CIDR
  // attestation via explicitlyAttestedAddress.
  const usingDefaultSelfHostedAllowlist = !options.allowedHostsEnv;
  if (net.isIP(host) && isPrivateOrSpecialAddress(host) && !(hostExplicitlyAttested && usingDefaultSelfHostedAllowlist) && !explicitlyAttestedAddress(host, options) && !labLoopback) {
    throw Object.assign(new Error(`${codePrefix}_PRIVATE_ADDRESS_NOT_ATTESTED`), { code: `${codePrefix}_PRIVATE_ADDRESS_NOT_ATTESTED` });
  }
  if (options.productionPort443 !== false && production(options.env || process.env) && u.port && u.port !== '443') throw Object.assign(new Error(`${codePrefix}_PORT_FORBIDDEN`), { code: `${codePrefix}_PORT_FORBIDDEN` });
  return u;
}

async function resolveAttestedOutboundTarget(u, options = {}) {
  if (!(u instanceof URL)) throw new TypeError('OUTBOUND_URL_REQUIRED');
  const codePrefix = options.codePrefix || 'OUTBOUND';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const lookup = options.lookup || dns.lookup;
  const isLiteralIp = !!net.isIP(host);
  let entries;
  if (isLiteralIp) entries = [{ address: host, family: net.isIP(host) }];
  else entries = await lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(entries) || entries.length === 0) throw Object.assign(new Error(`${codePrefix}_DNS_EMPTY`), { code: `${codePrefix}_DNS_EMPTY` });
  // A literal IP in the URL (no DNS lookup happened, no indirection) that is
  // already an exact-match entry in the *default* self-hosted allowlist was
  // already attested in parseAttestedOutboundUrl — re-demanding a separate
  // CIDR attestation for the identical address here is redundant. This
  // exemption never applies to hostname-based lookups: there the resolved
  // IP can legitimately differ from whatever the hostname string implied
  // (DNS rebinding), so CIDR/lab-loopback attestation of the *resolved*
  // address is still required regardless of what the hostname was.
  const literalHostExplicitlyAttested = isLiteralIp && !options.allowedHostsEnv && allowedHosts(options).has(host);
  const normalized = entries.map(e => {
    const address = String(e.address);
    const actualFamily = net.isIP(address);
    const reportedFamily = Number(e.family) || actualFamily;
    return { address, family: reportedFamily, actualFamily };
  });
  for (const entry of normalized) {
    if (!entry.actualFamily || ![4, 6].includes(entry.family) || entry.family !== entry.actualFamily) throw Object.assign(new Error(`${codePrefix}_DNS_ADDRESS_INVALID`), { code: `${codePrefix}_DNS_ADDRESS_INVALID` });
    if (isPrivateOrSpecialAddress(entry.address) && !literalHostExplicitlyAttested && !explicitlyAttestedAddress(entry.address, options) && !localLoopbackLabAllowed(entry.address, options)) {
      throw Object.assign(new Error(`${codePrefix}_UNATTESTED_ADDRESS`), { code: `${codePrefix}_UNATTESTED_ADDRESS` });
    }
  }
  const selected = normalized[0];
  return Object.freeze({ host, address: selected.address, family: selected.actualFamily, addresses: Object.freeze(normalized.map(({address,family}) => Object.freeze({address,family}))) });
}

function joinAttestedPath(base, pathname) {
  if (!(base instanceof URL)) throw new TypeError('OUTBOUND_BASE_URL_REQUIRED');
  const path = String(pathname || '');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.split('/').includes('..') || /%2e/i.test(path) || /%5c/i.test(path) || /[\u0000-\u001f\u007f]/.test(path)) {
    throw Object.assign(new Error('OUTBOUND_PATH_INVALID'), { code: 'OUTBOUND_PATH_INVALID' });
  }
  const resolved = new URL(path, base);
  if (resolved.protocol !== base.protocol || resolved.hostname !== base.hostname || resolved.port !== base.port || resolved.username || resolved.password) {
    throw Object.assign(new Error('OUTBOUND_PATH_ESCAPES_ORIGIN'), { code: 'OUTBOUND_PATH_ESCAPES_ORIGIN' });
  }
  return resolved;
}

function requestAttested(url, target, options = {}) {
  if (!(url instanceof URL) || !target || !target.address) throw new TypeError('ATTESTED_REQUEST_TARGET_REQUIRED');
  const method = String(options.method || 'GET').toUpperCase();
  const timeoutMs = Number(options.timeoutMs ?? 15000);
  const maxResponseBytes = Number(options.maxResponseBytes ?? 2 * 1024 * 1024);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw Object.assign(new Error('OUTBOUND_TIMEOUT_CONFIGURATION_INVALID'), { code:'OUTBOUND_TIMEOUT_CONFIGURATION_INVALID' });
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 50 * 1024 * 1024) throw Object.assign(new Error('OUTBOUND_RESPONSE_LIMIT_CONFIGURATION_INVALID'), { code:'OUTBOUND_RESPONSE_LIMIT_CONFIGURATION_INVALID' });
  const secure = url.protocol === 'https:';
  const transport = secure ? https : http;
  const rawBody = options.body == null ? null : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
  const headers = Object.assign({}, options.headers || {});
  if (rawBody && headers['Content-Length'] == null && headers['content-length'] == null) headers['Content-Length'] = rawBody.length;
  if (headers.Host == null && headers.host == null) headers.Host = url.host;
  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (secure ? 443 : 80),
      path: url.pathname + url.search,
      method,
      servername: url.hostname,
      headers,
      timeout: timeoutMs,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions && lookupOptions.all) return callback(null, [{ address:target.address, family:target.family }]);
        return callback(null, target.address, target.family);
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        reject(Object.assign(new Error(`${options.codePrefix || 'OUTBOUND'}_REDIRECT_FORBIDDEN`), { code: `${options.codePrefix || 'OUTBOUND'}_REDIRECT_FORBIDDEN`, statusCode: 502 }));
        return;
      }
      let size = 0;
      const chunks = [];
      let overflow = false;
      res.on('data', chunk => {
        size += chunk.length;
        if (size <= maxResponseBytes) chunks.push(chunk);
        else if (!overflow) {
          overflow = true;
          req.destroy(Object.assign(new Error(`${options.codePrefix || 'OUTBOUND'}_RESPONSE_TOO_LARGE`), { code: `${options.codePrefix || 'OUTBOUND'}_RESPONSE_TOO_LARGE`, statusCode: 502 }));
        }
      });
      res.on('end', () => {
        if (overflow || size > maxResponseBytes) return;
        resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, headers: res.headers, body: Buffer.concat(chunks), target });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`${options.codePrefix || 'OUTBOUND'}_TIMEOUT`), { code:`${options.codePrefix || 'OUTBOUND'}_TIMEOUT`, statusCode:504 })));
    req.on('error', reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

async function requestAttestedJson(url, target, options = {}) {
  const response = await requestAttested(url, target, options);
  const text = response.body.toString('utf8');
  let data;
  try { data = text ? JSON.parse(text) : null; }
  catch (_) { throw Object.assign(new Error(`${options.codePrefix || 'OUTBOUND'}_INVALID_JSON`), { code:`${options.codePrefix || 'OUTBOUND'}_INVALID_JSON`, statusCode:502 }); }
  return Object.assign({}, response, { data });
}

module.exports = Object.freeze({
  parseAttestedOutboundUrl,
  joinAttestedPath,
  isPrivateOrSpecialAddress,
  isInternalNetworkAddress,
  hasOnlyInternalNetworkTargets,
  allowedHosts,
  cidrContains,
  explicitlyAttestedAddress,
  resolveAttestedOutboundTarget,
  requestAttested,
  requestAttestedJson
});
