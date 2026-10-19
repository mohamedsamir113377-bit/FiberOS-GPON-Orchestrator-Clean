'use strict';

const { AdapterRegistry } = require('./adapterRegistryGlobal');
const { manualEntryAdapter } = require('./manualEntryAdapter');
const { buildPhotoOcrAdapter } = require('./photoOcrAdapter');
const { buildOtdrFileAdapter } = require('./otdrFileAdapter');
const { buildNmsPollAdapter } = require('./nmsPollAdapter');

const ADAPTER_BUILDERS = {
  MANUAL_ENTRY: () => manualEntryAdapter,
  PHOTO_OCR: (cfg) => buildPhotoOcrAdapter({ ocrProvider: cfg.ocrProvider || null }),
  OTDR_FILE_UPLOAD: (cfg) => buildOtdrFileAdapter({ vendorFieldResolvers: cfg.otdrVendorResolvers || {} }),
  NMS_LIVE_POLL: (cfg) => buildNmsPollAdapter({ driverRegistry: cfg.nmsDriverRegistry || {} }),
};

/**
 * orgConfig shape (this is exactly `client_organizations.enabled_measurement_sources`
 * plus whatever real provider/driver objects that org's integration actually needs):
 *   {
 *     enabledSources: ['MANUAL_ENTRY', 'OTDR_FILE_UPLOAD'],
 *     ocrProvider: null,                  // or a real provider instance
 *     otdrVendorResolvers: {},            // { EXFO: fn, VIAVI: fn, ... } — added per client as confirmed
 *     nmsDriverRegistry: {},              // { HUAWEI_MA5800: driver, ... } — added per client as confirmed
 *   }
 *
 * MANUAL_ENTRY is always force-included even if an org config forgets it —
 * a company must never end up with zero way to close a ticket because of a
 * config mistake. That would be the actual embarrassing failure mode.
 */
function buildRegistryForOrganization(orgConfig = {}) {
  const enabledSources = new Set(orgConfig.enabledSources || []);
  enabledSources.add('MANUAL_ENTRY');

  const registry = new AdapterRegistry();
  for (const sourceId of enabledSources) {
    const builder = ADAPTER_BUILDERS[sourceId];
    if (!builder) {
      throw new Error(`ERR_UNKNOWN_MEASUREMENT_SOURCE: "${sourceId}" is not a recognized adapter sourceId`);
    }
    registry.register(builder(orgConfig));
  }
  return registry;
}

module.exports = { buildRegistryForOrganization, ADAPTER_BUILDERS };
