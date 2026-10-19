'use strict';

const crypto = require('crypto');

const GENESIS_HASH = '0'.repeat(64);

/**
 * Ledger HMAC secret must come from environment only.
 * Refuses to start without LEDGER_SECRET_KEY (>=32 chars). No hardcoded fallback.
 */
function requireLedgerSecret(env = process.env) {
  const secret = env.LEDGER_SECRET_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      'ERR_LEDGER_SECRET_MISSING: LEDGER_SECRET_KEY must be set (>=32 chars). Refusing to start with no fallback.'
    );
  }
  return secret;
}

/**
 * Deterministic block hash: HMAC-SHA256 over previousHash + fields.
 * Same inputs always produce the same hash (no Math.random, no Date.now()
 * baked into the hash itself — timestamp is passed in explicitly by the caller).
 */
function computeBlockHash({ previousHash, timestampMs, eventType, actorId, payload }, secret) {
  if (!previousHash || previousHash.length !== 64) {
    throw new TypeError('ERR_INVALID_PREV_HASH: previousHash must be a 64-char hex string');
  }
  const hashInput = `${previousHash}${timestampMs}${eventType}${actorId}${JSON.stringify(payload)}`;
  return crypto.createHmac('sha256', secret).update(hashInput).digest('hex');
}

/**
 * Verifies a full chain of blocks was not tampered with, by recomputing every
 * hash from genesis forward and checking previous_hash linkage. This is the
 * actual tamper-evidence mechanism — the DB-level RULEs are a second layer,
 * not a substitute for this check.
 */
function verifyChain(blocks, secret) {
  let expectedPrev = GENESIS_HASH;
  for (const block of blocks) {
    if (block.previous_hash !== expectedPrev) {
      return { valid: false, brokenAt: block.block_index, reason: 'PREV_HASH_MISMATCH' };
    }
    const recomputed = computeBlockHash(
      {
        previousHash: block.previous_hash,
        timestampMs: block.ts_epoch_ms,
        eventType: block.event_type,
        actorId: block.actor_id,
        payload: block.payload,
      },
      secret
    );
    if (recomputed !== block.block_hash) {
      return { valid: false, brokenAt: block.block_index, reason: 'HASH_MISMATCH' };
    }
    expectedPrev = block.block_hash;
  }
  return { valid: true };
}

module.exports = { GENESIS_HASH, requireLedgerSecret, computeBlockHash, verifyChain };
