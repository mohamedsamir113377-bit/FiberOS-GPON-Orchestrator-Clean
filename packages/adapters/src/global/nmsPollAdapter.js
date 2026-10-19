'use strict';

const { UnsupportedInputError } = require('./types');

/**
 * Covers: reading rx power directly from the OLT/router's management plane
 * instead of a human taking a measurement at all (NETCONF/YANG per RFC 6242,
 * SNMP, or a vendor's proprietary NBI like Huawei's MML/U2000).
 *
 * There is no universal protocol here — Huawei, Nokia, ZTE, and others each
 * expose optical power through their own OID trees / YANG models / APIs, and
 * you don't yet know which OLT models each client company runs. So this file
 * defines the *driver contract* only; each real vendor driver is a separate,
 * small module registered by key, built once that company's actual OLT model
 * and management-plane access are known.
 *
 * driverRegistry: { [vendorKey]: { connect(creds), pollOpticalPower(ontId) } }
 */
function buildNmsPollAdapter({ driverRegistry = {} } = {}) {
  return {
    sourceId: 'NMS_LIVE_POLL',
    priority: 5, // preferred over everything else when it's actually available — it's the least error-prone

    canHandle(rawInput) {
      return rawInput && rawInput.inputType === 'nms_poll' && !!rawInput.vendorKey;
    },

    async extract(rawInput) {
      const driver = driverRegistry[rawInput.vendorKey];
      if (!driver) {
        throw new UnsupportedInputError(
          `ERR_VENDOR_DRIVER_NOT_REGISTERED: no NMS driver registered for "${rawInput.vendorKey}" — needs that OLT vendor's real management-plane access (NETCONF/SNMP/vendor NBI) before this can return a real reading`
        );
      }
      const rxPowerDbm = await driver.pollOpticalPower(rawInput.ontId);
      return {
        rxPowerDbm,
        confidenceTier: 'VERIFIED',
        sourceMeta: { vendor: rawInput.vendorKey, ontId: rawInput.ontId, polledLive: true },
      };
    },
  };
}

module.exports = { buildNmsPollAdapter };
