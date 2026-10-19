/**
 * Nokia NMS read-only adapter contract. Endpoints are configurable and the adapter remains UNCONNECTED until a verified vendor contract is supplied.
 */
'use strict';
const { createNmsReadOnlyAdapter } = require('./nmsReadOnly');

function createNokiaNmsAdapter(options) {
  options = options || {};
  return createNmsReadOnlyAdapter({
    vendorId: 'nokia-nms',
    displayName: options.displayName || 'Nokia NMS (read-only)',
    baseUrl: options.baseUrl || '',
    apiKey: options.apiKey || options.token || '',
    healthPath: options.healthPath || '/api/health',
    pollPath: options.pollPath || '/api/v1/optical/readings'
  });
}

module.exports = { createNokiaNmsAdapter };
