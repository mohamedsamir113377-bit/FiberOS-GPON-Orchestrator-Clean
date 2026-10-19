'use strict';

/**
 * Telcordia SR-4731 / Bellcore .SOR block scanner.
 *
 * WHAT'S REAL:
 * Bellcore/Telcordia .SOR files are organized as a Map block that lists the
 * other blocks (GenParams, FxdParams, KeyEvents, DataPts, ...) each identified
 * by an ASCII name. Scanning for those ASCII markers to find block *boundaries*
 * is a real, standard first step used by every real .SOR parser (including
 * open-source ones) — this part below is genuinely implemented.
 *
 * WHAT'S NOT REAL (on purpose, not by accident):
 * The pasted "v12" draft read groupIndex from a hardcoded byte offset
 * (`fxdParamsOffset + 10`) and divided by a hardcoded scale (100000) with a
 * silent fallback of 1.46820 if the read looked wrong. That offset was
 * guessed, not sourced from the spec — the exact byte layout of FxdParams
 * depends on the block's own revision number, which varies between OTDR
 * vendors and firmware versions. Faking a plausible-looking number here is
 * exactly the "ornamentation" you asked to eliminate, so this version
 * refuses to guess: it reports the block was found, and raises a clear,
 * catchable error instead of returning an invented value.
 *
 * TO MAKE THIS REAL: bring the actual Telcordia SR-4731 field table (or the
 * OTDR vendor's SDK/spec) and we implement per-revision field parsing against
 * it — that's a half-day task once we have the real byte layout, not a
 * guess-and-ship one.
 */

const REQUIRED_BLOCKS = ['GenParams', 'FxdParams', 'KeyEvents'];

function findBlockOffsets(buffer) {
  const offsets = {};
  for (const name of REQUIRED_BLOCKS) {
    const idx = buffer.indexOf(name, 0, 'ascii');
    offsets[name] = idx === -1 ? null : idx;
  }
  return offsets;
}

function scanSorFile(binaryBuffer) {
  if (!Buffer.isBuffer(binaryBuffer) || binaryBuffer.length < 120) {
    throw new Error('ERR_INVALID_BINARY_STREAM: file is missing or too small to be a real .SOR trace');
  }

  const signature = binaryBuffer.toString('ascii', 0, 4).trim();
  if (!signature.toLowerCase().includes('map')) {
    throw new Error('ERR_BELLCORE_SIGNATURE_MISMATCH: file does not start with a Map block identifier');
  }

  const offsets = findBlockOffsets(binaryBuffer);
  const missing = REQUIRED_BLOCKS.filter((name) => offsets[name] === null);
  if (missing.length > 0) {
    throw new Error(`ERR_STRUCTURAL_BLOCKS_MISSING: ${missing.join(', ')} not found in file`);
  }

  return {
    standard: 'Telcordia SR-4731 — block boundaries only, fields NOT parsed',
    blockOffsets: offsets,
    fieldsParsed: false,
    reason:
      'Numeric field extraction (groupIndex, event distances, loss values) requires the ' +
      'real per-revision byte layout, which has not been sourced yet. See file header comment.',
  };
}

module.exports = { scanSorFile, REQUIRED_BLOCKS };
