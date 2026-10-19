'use strict';

/**
 * Pure deterministic Asset Fingerprint ("Asset DNA" precursor).
 * Truth boundary:
 * - Produces a content hash only from caller-supplied attributes.
 * - Does NOT write to the ledger. Caller must call ledgerAppend.appendLedgerBlock
 *   under LEDGER_SECRET_KEY + RLS if persistence is required.
 * - Never invents serial numbers, locations, or events.
 */

const crypto = require('crypto');

function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.keys(value).sort().reduce((o, k) => {
    o[k] = canonical(value[k]);
    return o;
  }, {});
}

/**
 * @param {object} asset
 * @param {string} asset.assetType   e.g. SPLITTER, ODF, ONT, CABINET
 * @param {string} [asset.serial]
 * @param {string} [asset.assetId]
 * @param {string} [asset.installEventId]
 * @param {object} [asset.locationRef]  { lat, lng } or topology node id
 * @param {object} [asset.attributes]  any extra deterministic fields
 * @returns {{ fingerprint: string, canonicalPayload: object, algorithm: string }}
 */
function createAssetFingerprint(asset) {
  if (!asset || typeof asset !== 'object') {
    throw new TypeError('ASSET_REQUIRED');
  }
  if (!asset.assetType || String(asset.assetType).trim() === '') {
    throw new TypeError('ASSET_TYPE_REQUIRED');
  }

  const payload = {
    assetType: String(asset.assetType).trim().toUpperCase(),
    serial: asset.serial != null ? String(asset.serial).trim() : null,
    assetId: asset.assetId != null ? String(asset.assetId).trim() : null,
    installEventId: asset.installEventId != null ? String(asset.installEventId).trim() : null,
    locationRef: asset.locationRef && typeof asset.locationRef === 'object'
      ? canonical(asset.locationRef)
      : null,
    attributes: asset.attributes && typeof asset.attributes === 'object'
      ? canonical(asset.attributes)
      : null
  };

  const canonicalPayload = canonical(payload);
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');

  return Object.freeze({
    fingerprint,
    canonicalPayload,
    algorithm: 'SHA-256',
    note: 'FINGERPRINT_ONLY_NOT_PERSISTED'
  });
}

module.exports = { createAssetFingerprint, canonical };
