/**
 * Huawei NMS read-only adapter contract. Endpoints are configurable and the adapter remains UNCONNECTED until a verified vendor contract is supplied.
 * Do not infer vendor endpoints: production configuration must provide and validate the vendor API contract.
 */
'use strict';
const { createNmsReadOnlyAdapter } = require('./nmsReadOnly');

function createHuaweiNmsAdapter(options) {
  options = options || {};
  return createNmsReadOnlyAdapter({
    vendorId: 'huawei-nms',
    displayName: options.displayName || 'Huawei NMS (read-only)',
    baseUrl: options.baseUrl || '',
    apiKey: options.apiKey || options.token || '',
    healthPath: options.healthPath || '/rest/health',
    pollPath: options.pollPath || '/rest/optical/query',
    mapReading: options.mapReading
  });
}

module.exports = { createHuaweiNmsAdapter };
