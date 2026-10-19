/**
 * Append a block to hash_ledger when LEDGER_SECRET_KEY is configured.
 * If secret missing: skip write (does not invent a secret).
 */
'use strict';
const { GENESIS_HASH, computeBlockHash, requireLedgerSecret } = require('./ledger');

async function appendLedgerBlock(client, { eventType, actorId, payload, env }) {
  env = env || process.env;
  var secret;
  try {
    secret = requireLedgerSecret(env);
  } catch (e) {
    return { appended: false, reason: 'LEDGER_SECRET_MISSING' };
  }

  // The database owns the ledger head read and append lock. The app role
  // must not read hash_ledger directly because its RLS policy intentionally
  // restricts direct reads.
  const head = await client.query(`select fiberos_hash_ledger_head() as block_hash`);
  const previousHash = head.rows[0] && head.rows[0].block_hash
    ? head.rows[0].block_hash
    : GENESIS_HASH;
  const timestampMs = Date.now();
  const blockHash = computeBlockHash({
    previousHash: previousHash,
    timestampMs: timestampMs,
    eventType: eventType,
    actorId: actorId || 'system',
    payload: payload || {}
  }, secret);

  const ins = await client.query(
    `select fiberos_append_hash_ledger($1::char(64), $2::char(64), $3::bigint, $4::text, $5::text, $6::jsonb) as block_index`,
    [previousHash, blockHash, timestampMs, eventType, actorId || null, JSON.stringify(payload || {})]
  );

  return {
    appended: true,
    blockIndex: ins.rows[0].block_index,
    blockHash: blockHash,
    previousHash: previousHash
  };
}

module.exports = { appendLedgerBlock };
