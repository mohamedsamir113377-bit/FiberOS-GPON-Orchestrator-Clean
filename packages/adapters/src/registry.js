/**
 * FiberOS Southbound Vendor Adapter Interface
 * -----------------------------------------------------------------
 * Purpose: allow any ISP/equipment vendor to plug OLT/NMS/Inventory
 * without changing core domain or RLS.
 *
 * Contract rules:
 *  - Adapters NEVER grant browser-side authority
 *  - Measurements MUST set source: field_reading | nms_poll | ai_simulated
 *  - Fail closed on timeout / auth errors
 *  - No secrets in adapter source; inject via secure config
 */
'use strict';

/**
 * @typedef {Object} OpticalReading
 * @property {'rx_power'|'otdr_trace'|'insertion_loss'} measurementType
 * @property {number|null} valueNumeric
 * @property {string} [unit]
 * @property {'field_reading'|'nms_poll'|'ai_simulated'} source
 * @property {string} [assetCode]
 * @property {string} [portRef]
 * @property {string} [externalId]
 * @property {string} measuredAt ISO-8601
 */

/**
 * @typedef {Object} VendorAdapter
 * @property {string} vendorId
 * @property {string} displayName
 * @property {string[]} capabilities  e.g. ['olt.telemetry','nms.poll','inventory.sync']
 * @property {() => Promise<{ok:boolean, detail?:string}>} healthCheck
 * @property {(query:Object) => Promise<OpticalReading[]>} [pollOptical]
 * @property {(query:Object) => Promise<Object[]>} [listAssets]
 * @property {(cmd:Object) => Promise<{ok:boolean, accepted:boolean, detail?:string}>} [submitCommand]
 *   submitCommand must default accepted:false unless backend confirms
 */

/** Registry — companies register adapters at integration time */
function createAdapterRegistry() {
  const map = Object.create(null);
  const api = {
    register: function (adapter) {
      if (!adapter || !adapter.vendorId) throw new Error('ADAPTER_REQUIRES_vendorId');
      if (typeof adapter.healthCheck !== 'function') throw new Error('ADAPTER_REQUIRES_healthCheck');
      map[adapter.vendorId] = Object.freeze(Object.assign({}, adapter));
      return map[adapter.vendorId];
    },
    get: function (vendorId) { return map[vendorId] || null; },
    list: function () { return Object.keys(map).map(function (k) { return map[k]; }); }
  };

  if (String(process.env.NMS_VENDOR || '').toLowerCase() === 'zte') {
    const { createZteNmsAdapter } = require('./zteNms');
    const { createZteSnmpSessionFactory } = require('./zteSnmpSession');
    const sessionFactory = createZteSnmpSessionFactory({
      host: process.env.NMS_HOST || process.env.ZTE_SNMP_HOST,
      version: process.env.NMS_SNMP_VERSION || process.env.ZTE_SNMP_VERSION || '3',
      community: process.env.NMS_SNMP_COMMUNITY || process.env.ZTE_SNMP_COMMUNITY,
      user: process.env.NMS_SNMP_USER || process.env.ZTE_SNMP_USER,
      authKey: process.env.NMS_SNMP_AUTH_KEY || process.env.ZTE_SNMP_AUTH_KEY,
      privKey: process.env.NMS_SNMP_PRIV_KEY || process.env.ZTE_SNMP_PRIV_KEY,
      authProtocol: process.env.NMS_SNMP_AUTH_PROTOCOL || 'sha256',
      privProtocol: process.env.NMS_SNMP_PRIV_PROTOCOL || 'aes',
      port: process.env.NMS_SNMP_PORT || 161
    });
    api.register(createZteNmsAdapter({ sessionFactory }));
  }

  return api;
}

/** Null adapter — safe default when no vendor configured */
const NullVendorAdapter = Object.freeze({
  vendorId: 'null',
  displayName: 'Unconfigured',
  capabilities: [],
  healthCheck: async function () {
    return { ok: false, detail: 'NO_VENDOR_CONFIGURED' };
  },
  pollOptical: async function () { return []; },
  listAssets: async function () { return []; },
  submitCommand: async function () {
    return { ok: false, accepted: false, detail: 'NO_VENDOR_CONFIGURED' };
  }
});

module.exports = { createAdapterRegistry, NullVendorAdapter };

if (typeof window !== 'undefined') {
  window.FiberOSAdapters = window.FiberOSAdapters || {};
  window.FiberOSAdapters.createAdapterRegistry = createAdapterRegistry;
  window.FiberOSAdapters.NullVendorAdapter = NullVendorAdapter;
}
