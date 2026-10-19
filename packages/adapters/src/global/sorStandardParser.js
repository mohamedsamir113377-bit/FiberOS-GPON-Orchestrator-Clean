'use strict';

/**
 * Standards parser boundary for Telcordia SR-4731 / Bellcore SOR files.
 *
 * The commercial core intentionally does not guess binary offsets. The parser
 * implementation is supplied by the MIT-licensed `sor-reader` package during
 * deployment. This wrapper normalizes its output into FiberOS evidence fields
 * and rejects files with a failed CRC.
 */

function loadParser() {
  try {
    return require('sor-reader');
  } catch (error) {
    const e = new Error('ERR_SOR_PARSER_DEPENDENCY_MISSING');
    e.code = 'ERR_SOR_PARSER_DEPENDENCY_MISSING';
    e.cause = error;
    throw e;
  }
}

function parseSorBuffer(buffer, filename = 'trace.sor') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 120) {
    const e = new Error('ERR_INVALID_SOR_BINARY');
    e.code = 'ERR_INVALID_SOR_BINARY';
    throw e;
  }
  const parser = loadParser();
  const result = parser.parseSor(new Uint8Array(buffer), filename);
  if (!result || !result.Cksum || result.Cksum.match !== true) {
    const e = new Error('ERR_SOR_CHECKSUM_INVALID');
    e.code = 'ERR_SOR_CHECKSUM_INVALID';
    throw e;
  }
  const fixed = result.FxdParams || {};
  const events = result.KeyEvents || {};
  const trace = Array.isArray(result.trace) ? result.trace : [];
  const wavelength = Number.parseFloat(String(fixed.wavelength || '').replace(/[^0-9.\-]/g, ''));
  const rangeKm = Number(fixed.range);
  const dataPoints = Number(fixed['num data points']);
  const groupIndex = Number(String(fixed.index || '').replace(/[^0-9.\-]/g, ''));
  return Object.freeze({
    standard: 'TELCORDIA_SR_4731',
    version: String(result.version || result.format || ''),
    checksumValid: true,
    wavelengthNm: Number.isFinite(wavelength) ? wavelength : null,
    rangeKm: Number.isFinite(rangeKm) ? rangeKm : null,
    dataPoints: Number.isInteger(dataPoints) ? dataPoints : null,
    groupIndex: Number.isFinite(groupIndex) ? groupIndex : null,
    eventCount: Number(events['num events'] || events.numEvents || 0),
    events: Array.isArray(events.events) ? events.events : [],
    trace,
    blocks: result.blocks || {},
    metadata: { genParams: result.GenParams || null, supParams: result.SupParams || null, fixedParams: fixed }
  });
}

module.exports = { parseSorBuffer };
