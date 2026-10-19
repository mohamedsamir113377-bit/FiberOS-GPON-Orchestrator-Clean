'use strict';

/**
 * OTDR Vendor Field Resolver Registry (Feature A)
 *
 * Truth boundary:
 * - Telcordia SR-4731 / Bellcore defines the block structure (already scanned by sorParser).
 * - ITU-T G.988 is OMCI (ONU management) — it is NOT the .SOR binary format.
 * - Numeric field extraction requires a vendor-specific + revision-specific layout.
 * - This registry stays empty until a real layout is supplied. No guessed offsets.
 *
 * Resolver contract:
 *   (scanResult, buffer) => {
 *     rxPowerDbm?: number,
 *     events?: Array<{ distanceM, lossDb, reflectanceDb, type }>,
 *     meta?: object
 *   }
 */

const { scanSorFile } = require('../../../domain/src/sorParser');

/** @type {Record<string, Function>} */
const registry = Object.create(null);

function registerVendorResolver(vendorKey, resolverFn) {
  if (!vendorKey || typeof vendorKey !== 'string') {
    throw new TypeError('VENDOR_KEY_REQUIRED');
  }
  if (typeof resolverFn !== 'function') {
    throw new TypeError('RESOLVER_MUST_BE_FUNCTION');
  }
  const key = vendorKey.trim().toUpperCase();
  registry[key] = resolverFn;
  return key;
}

function listRegisteredVendors() {
  return Object.freeze(Object.keys(registry).sort());
}

function getResolver(vendorKey) {
  if (!vendorKey) return null;
  return registry[String(vendorKey).trim().toUpperCase()] || null;
}

/**
 * High-level entry: scan + optional resolve.
 * Always returns scan metadata. Field data only if resolver exists.
 */
function processOtdrBuffer(fileBuffer, declaredVendor) {
  const scanResult = scanSorFile(fileBuffer);
  const vendorKey = declaredVendor ? String(declaredVendor).trim().toUpperCase() : null;
  const resolver = vendorKey ? getResolver(vendorKey) : null;

  if (!resolver) {
    return Object.freeze({
      scanned: true,
      fieldsParsed: false,
      standard: scanResult.standard,
      blockOffsets: scanResult.blockOffsets,
      vendorKey,
      registeredVendors: listRegisteredVendors(),
      reason: vendorKey
        ? `ERR_VENDOR_LAYOUT_NOT_REGISTERED: ${vendorKey}`
        : 'ERR_VENDOR_NOT_DECLARED',
      note: 'SR-4731 block boundaries only. ITU-T G.988 is OMCI, not SOR format.'
    });
  }

  const fields = resolver(scanResult, fileBuffer);
  return Object.freeze({
    scanned: true,
    fieldsParsed: true,
    standard: scanResult.standard,
    blockOffsets: scanResult.blockOffsets,
    vendorKey,
    fields: fields || {},
    note: 'Fields extracted by registered vendor resolver'
  });
}

module.exports = {
  registerVendorResolver,
  listRegisteredVendors,
  getResolver,
  processOtdrBuffer,
  STANDARDS_NOTE: Object.freeze({
    otodrBinary: 'Telcordia SR-4731 / Bellcore Map-block structure',
    g988: 'ITU-T G.988 = OMCI (ONU Management and Control Interface) — not used for .SOR parsing'
  })
};
