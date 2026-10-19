'use strict';

/**
 * Asset DNA install binding (Feature D)
 *
 * Truth boundary:
 * - Always produces a pure fingerprint.
 * - Ledger append happens only if caller provides a DB client + env with LEDGER_SECRET_KEY.
 * - Never invents the secret or writes without explicit authority.
 */

const { createAssetFingerprint } = require('./assetFingerprint');
const { appendLedgerBlock } = require('./ledgerAppend');

/**
 * @param {object} asset   same shape as createAssetFingerprint
 * @param {object} [opts]
 * @param {object} [opts.client]  pg client (must be in transaction if appending)
 * @param {object} [opts.env]
 * @param {string} [opts.actorId]
 * @param {boolean} [opts.appendToLedger=false]
 */
async function bindAssetOnInstall(asset, opts) {
  opts = opts || {};
  const fingerprintResult = createAssetFingerprint(asset);

  const payload = {
    event: 'ASSET_INSTALL_FINGERPRINT',
    fingerprint: fingerprintResult.fingerprint,
    algorithm: fingerprintResult.algorithm,
    canonicalPayload: fingerprintResult.canonicalPayload
  };

  if (!opts.appendToLedger) {
    return Object.freeze({
      fingerprint: fingerprintResult.fingerprint,
      appended: false,
      reason: 'APPEND_NOT_REQUESTED',
      payload
    });
  }

  if (!opts.client) {
    return Object.freeze({
      fingerprint: fingerprintResult.fingerprint,
      appended: false,
      reason: 'CLIENT_REQUIRED_FOR_APPEND',
      payload
    });
  }

  const ledgerResult = await appendLedgerBlock(opts.client, {
    eventType: 'ASSET_INSTALL_FINGERPRINT',
    actorId: opts.actorId || 'system',
    payload,
    env: opts.env
  });

  return Object.freeze({
    fingerprint: fingerprintResult.fingerprint,
    appended: ledgerResult.appended === true,
    reason: ledgerResult.reason || null,
    blockIndex: ledgerResult.blockIndex || null,
    blockHash: ledgerResult.blockHash || null,
    payload
  });
}

module.exports = { bindAssetOnInstall };
