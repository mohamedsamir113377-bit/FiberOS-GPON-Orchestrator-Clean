'use strict';

const { UnsupportedInputError } = require('./global/types');

const RX_OID = '1.3.6.1.4.1.3902.1082.500.1.2.4.2.1.2';
const ZTE_SYSTEM_DESCR_OID = '1.3.6.1.2.1.1.1.0';
const NA_VALUE = 65535000;
const NO_SIGNAL_VALUE = -80000;

function codedUnsupported(code) {
  const e = new UnsupportedInputError(code);
  e.code = code;
  return e;
}

function finiteDbm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw codedUnsupported('ERR_ZTE_RX_NON_NUMERIC');
  if (n === NA_VALUE) return null;
  if (n === NO_SIGNAL_VALUE) return null;
  const dbm = n / 1000;
  if (dbm < -100 || dbm > 20) throw codedUnsupported('ERR_ZTE_RX_OUT_OF_RANGE');
  return Number(dbm.toFixed(3));
}

function unwrapVarbind(value) {
  if (value && value.value !== undefined) return value;
  return { value };
}

function createZteSnmpDriver({ sessionFactory, oid = RX_OID, indexResolver, timeoutMs = 5000 } = {}) {
  if (typeof sessionFactory !== 'function') throw new TypeError('ZTE_SNMP_SESSION_FACTORY_REQUIRED');
  const resolveIndex = indexResolver || (value => {
    const s = String(value == null ? '' : value).trim();
    if (!/^\d+(?:\.\d+)*$/.test(s)) throw codedUnsupported('ERR_ZTE_SNMP_INDEX_REQUIRED');
    return s;
  });

  return Object.freeze({
    vendorId: 'zte-nms',
    displayName: 'ZTE OLT / NMS (SNMP read-only)',
    capabilities: ['olt.telemetry', 'nms.poll', 'rx_power'],
    async healthCheck() {
      const session = await sessionFactory({ timeoutMs });
      try {
        if (!session || typeof session.get !== 'function') throw new Error('ERR_ZTE_SNMP_SESSION_INVALID');
        const rows = await session.get([{ oid: ZTE_SYSTEM_DESCR_OID }]);
        const first = unwrapVarbind(Array.isArray(rows) ? rows[0] : rows);
        if (!first || first.error) throw new Error('ERR_ZTE_SNMP_HEALTH_READ_FAILED');
        return { ok: true, detail: 'SNMP_READ_ONLY_REACHABLE' };
      } finally {
        if (session && typeof session.close === 'function') session.close();
      }
    },
    async pollOpticalPower(ontId, options = {}) {
      const index = resolveIndex(options.oidIndex != null ? options.oidIndex : ontId);
      const session = await sessionFactory({ timeoutMs });
      try {
        if (!session || typeof session.get !== 'function') throw new Error('ERR_ZTE_SNMP_SESSION_INVALID');
        const rows = await session.get([{ oid: `${oid}.${index}` }]);
        const first = unwrapVarbind(Array.isArray(rows) ? rows[0] : rows);
        if (first && first.error) throw codedUnsupported('ERR_ZTE_RX_VARBIND_ERROR');
        const raw = first && first.value != null ? first.value : first;
        const dbm = finiteDbm(raw);
        return { valueDbm: dbm, rawValue: Number(raw), oid: `${oid}.${index}`, status: dbm == null ? 'NO_READING' : 'OK' };
      } finally {
        if (session && typeof session.close === 'function') session.close();
      }
    }
  });
}

function createZteNmsAdapter({ sessionFactory, indexResolver, timeoutMs, oid } = {}) {
  const driver = createZteSnmpDriver({ sessionFactory, indexResolver, timeoutMs, oid });
  return {
    vendorId: driver.vendorId,
    displayName: driver.displayName,
    capabilities: driver.capabilities,
    healthCheck: driver.healthCheck,
    pollOptical: async query => {
      if (!query || query.ontId == null) throw codedUnsupported('ERR_ZTE_ONT_ID_REQUIRED');
      const result = await driver.pollOpticalPower(query.ontId, query);
      if (result.valueDbm == null) return [];
      return [{
        measurementType: 'rx_power',
        valueNumeric: result.valueDbm,
        unit: 'dBm',
        source: 'nms_poll',
        externalId: String(query.ontId),
        measuredAt: new Date().toISOString(),
        sourceMeta: { vendor: 'ZTE', protocol: 'SNMP', oid: result.oid, rawValue: result.rawValue }
      }];
    },
    submitCommand: async () => ({ ok: false, accepted: false, detail: 'ZTE_DRIVER_READ_ONLY' })
  };
}

module.exports = { RX_OID, ZTE_SYSTEM_DESCR_OID, NA_VALUE, NO_SIGNAL_VALUE, createZteSnmpDriver, createZteNmsAdapter };
