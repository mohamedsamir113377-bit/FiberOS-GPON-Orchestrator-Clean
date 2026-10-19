'use strict';

const net = require('net');

function resolveBindHost(env) {
  env = env || process.env;
  const host = String(env.API_BIND_HOST || '127.0.0.1').trim();
  if (!host) throw new Error('API_BIND_HOST_EMPTY');
  // Fail closed on malformed host values. Hostname resolution is deliberately
  // not performed here; operators should provide an explicit bind address.
  if (net.isIP(host) === 0 && host !== 'localhost') {
    throw new Error('API_BIND_HOST_MUST_BE_IP_OR_LOCALHOST');
  }
  return host;
}

module.exports = { resolveBindHost };
