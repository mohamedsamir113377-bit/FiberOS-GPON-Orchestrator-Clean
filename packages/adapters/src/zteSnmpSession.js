'use strict';

function loadSnmp() {
  try { return require('net-snmp'); } catch (error) {
    const e = new Error('ERR_NET_SNMP_DEPENDENCY_MISSING');
    e.code = 'ERR_NET_SNMP_DEPENDENCY_MISSING';
    e.cause = error;
    throw e;
  }
}

function createZteSnmpSessionFactory({ host, version = '3', community, user, authKey, privKey, authProtocol = 'sha256', privProtocol = 'aes', port = 161 } = {}) {
  if (!host) throw new TypeError('ZTE_SNMP_HOST_REQUIRED');
  const normalizedVersion = String(version).toLowerCase();
  return async function sessionFactory({ timeoutMs = 5000 } = {}) {
    const snmp = loadSnmp();
    const options = { port: Number(port), timeout: Number(timeoutMs), retries: 1, transport: 'udp4' };
    if (normalizedVersion === '3') {
      if (!user || !authKey) throw new Error('ZTE_SNMPV3_CREDENTIALS_REQUIRED');
      const authProtocols = { md5: snmp.AuthProtocols.md5, sha: snmp.AuthProtocols.sha, sha1: snmp.AuthProtocols.sha, sha224: snmp.AuthProtocols.sha224, sha256: snmp.AuthProtocols.sha256, sha384: snmp.AuthProtocols.sha384, sha512: snmp.AuthProtocols.sha512 };
      const privProtocols = { des: snmp.PrivProtocols.des, aes: snmp.PrivProtocols.aes, aes128: snmp.PrivProtocols.aes };
      const auth = authProtocols[String(authProtocol).toLowerCase()];
      const priv = privProtocols[String(privProtocol).toLowerCase()];
      if (!auth) throw new Error('ZTE_SNMP_AUTH_PROTOCOL_UNSUPPORTED');
      if (privKey && !priv) throw new Error('ZTE_SNMP_PRIV_PROTOCOL_UNSUPPORTED');
      return snmp.createV3Session(host, {
        name: String(user),
        level: privKey ? snmp.SecurityLevel.authPriv : snmp.SecurityLevel.authNoPriv,
        authProtocol: auth,
        authKey: String(authKey),
        privProtocol: privKey ? priv : undefined,
        privKey: privKey ? String(privKey) : undefined
      }, options);
    }
    if (normalizedVersion === '2c') {
      if (!community) throw new Error('ZTE_SNMPV2C_COMMUNITY_REQUIRED');
      return snmp.createSession(host, String(community), options);
    }
    throw new Error('ZTE_SNMP_VERSION_UNSUPPORTED');
  };
}

module.exports = { createZteSnmpSessionFactory };
