'use strict';

const { scanSorFile } = require('../../../domain/src/sorParser');
const { parseSorBuffer } = require('./sorStandardParser');
const { UnsupportedInputError } = require('./types');

/** Real SOR ingestion path: SR-4731 + CRC, with explicit structural-only fallback. */
function buildOtdrFileAdapter({ vendorFieldResolvers = {} } = {}) {
  return {
    sourceId: 'OTDR_FILE_UPLOAD',
    priority: 10,
    canHandle(rawInput) {
      return rawInput && rawInput.inputType === 'otdr_file' && Buffer.isBuffer(rawInput.fileBuffer);
    },
    extract(rawInput) {
      try {
        const parsed = parseSorBuffer(rawInput.fileBuffer, rawInput.fileName || 'trace.sor');
        return {
          measurementType: 'otdr_trace', valueNumeric: parsed.rangeKm, unit: 'km', source: 'field_reading',
          confidenceTier: 'PARSED_SR_4731_CRC_VERIFIED', trace: parsed.trace, events: parsed.events,
          metadata: parsed.metadata,
          sourceMeta: { standard: parsed.standard, version: parsed.version, checksumValid: parsed.checksumValid,
            wavelengthNm: parsed.wavelengthNm, groupIndex: parsed.groupIndex, dataPoints: parsed.dataPoints, eventCount: parsed.eventCount }
        };
      } catch (error) {
        if (!error || error.code !== 'ERR_SOR_PARSER_DEPENDENCY_MISSING') throw error;
        if (!rawInput.allowStructuralOnly) throw new UnsupportedInputError('ERR_SOR_STANDARD_PARSER_REQUIRED: install the approved SR-4731 parser before accepting an OTDR measurement');
        const scanResult = scanSorFile(rawInput.fileBuffer);
        const vendorKey = rawInput.declaredVendor;
        const resolver = vendorKey && vendorFieldResolvers[vendorKey];
        if (!resolver) throw new UnsupportedInputError(`ERR_VENDOR_LAYOUT_NOT_REGISTERED: structural scan succeeded (${Object.keys(scanResult.blockOffsets).join(', ')}) but no approved numeric resolver exists for vendor "${vendorKey || 'unknown'}"`);
        const fields = resolver(scanResult, rawInput.fileBuffer) || {};
        return { ...fields,
          confidenceTier: fields.confidenceTier || 'PARSED_BY_REGISTERED_VENDOR_RESOLVER',
          sourceMeta: { vendor: vendorKey, blockOffsets: scanResult.blockOffsets,
            evidenceStatus: fields.evidenceStatus || 'PARSER_OUTPUT_NOT_INSTRUMENT_VALIDATION' } };
      }
    }
  };
}
module.exports = { buildOtdrFileAdapter };
