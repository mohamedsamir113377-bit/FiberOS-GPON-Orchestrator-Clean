/**
 * Generic read-only NMS adapter skeleton.
 * Companies implement pollOptical against their OSS/NMS HTTP API.
 * Never accepts network write commands (accepted:false always for submitCommand).
 */
'use strict';

const { parseAttestedOutboundUrl, joinAttestedPath, resolveAttestedOutboundTarget, requestAttestedJson } = require('../../security/src/outboundPolicy');

function createNmsReadOnlyAdapter(options) {
  options = options || {};
  const vendorId = options.vendorId || 'nms-readonly';
  const baseUrl = options.baseUrl || '';
  const apiKey = options.apiKey || '';
  let parsedBaseUrl = null;
  if (baseUrl) {
    try { parsedBaseUrl = parseAttestedOutboundUrl(baseUrl, { envName:'NMS_BASE_URL', codePrefix:'NMS_BASE', productionPort443:false }); } catch (_) { parsedBaseUrl = null; }
  }
  function targetUrl(suffix) {
    if (!parsedBaseUrl || !['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
      const e = new Error('NMS_BASE_URL_INVALID'); e.code = 'NMS_BASE_URL_INVALID'; throw e;
    }
    const path = String(suffix || '/');
    if (!path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
      const e = new Error('NMS_PATH_INVALID'); e.code = 'NMS_PATH_INVALID'; throw e;
    }
    return joinAttestedPath(parsedBaseUrl, path);
  }

  return Object.freeze({
    vendorId: vendorId,
    displayName: options.displayName || 'NMS Read-Only',
    capabilities: Object.freeze(['nms.poll']),
    healthCheck: async function () {
      if (!baseUrl) return { ok: false, detail: 'NMS_BASE_URL_MISSING' };
      try {
        const url = targetUrl(options.healthPath || '/health');
        const target = await resolveAttestedOutboundTarget(parsedBaseUrl, { codePrefix:'NMS_BASE' });
        const res = await requestAttestedJson(url, target, { codePrefix:'NMS_HEALTH', method:'GET', timeoutMs:10000, maxResponseBytes:512 * 1024, headers:apiKey ? { Authorization:'Bearer ' + apiKey } : {} });
        return { ok:res.ok, detail:'HTTP_' + res.status };
      } catch (e) {
        return { ok: false, detail: 'NMS_HEALTH_CHECK_FAILED' };
      }
    },
    pollOptical: async function (query) {
      if (!baseUrl) return [];
      const path = options.pollPath || '/optical';
      const url = targetUrl(path);
      const target = await resolveAttestedOutboundTarget(parsedBaseUrl, { codePrefix:'NMS_BASE' });
      const res = await requestAttestedJson(url, target, { codePrefix:'NMS_POLL', method:'POST', timeoutMs:15000, maxResponseBytes:2 * 1024 * 1024,
        headers: Object.assign({ 'Content-Type':'application/json' }, apiKey ? { Authorization:'Bearer ' + apiKey } : {}),
        body: JSON.stringify(query || {})
      });
      if (!res.ok) throw new Error('NMS_POLL_HTTP_' + res.status);
      const data = res.data;
      const rows = Array.isArray(data) ? data : (data.readings || []);
      return rows.map(function (r) {
        return {
          measurementType: r.measurementType || 'rx_power',
          valueNumeric: r.valueNumeric != null ? r.valueNumeric : r.rxDbm,
          unit: r.unit || 'dBm',
          source: 'nms_poll',
          assetCode: r.assetCode,
          portRef: r.portRef,
          externalId: r.externalId,
          measuredAt: r.measuredAt || new Date().toISOString()
        };
      });
    },
    listAssets: async function () { return []; },
    submitCommand: async function () {
      return {
        ok: false,
        accepted: false,
        detail: 'READ_ONLY_ADAPTER_COMMANDS_DISABLED'
      };
    }
  });
}

module.exports = { createNmsReadOnlyAdapter };
