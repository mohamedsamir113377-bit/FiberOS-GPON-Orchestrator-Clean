'use strict';

/**
 * Strict outbox delivery boundary.
 *
 * A production provider adapter must be injected through OUTBOX_DELIVERY_ADAPTER.
 * The adapter module must export:
 *   async function deliver(event, context) -> { delivered: true }
 *
 * Any other result is rejected. The worker never treats enqueue/HTTP acceptance
 * as publication unless the adapter explicitly returns delivered: true.
 */

function loadDeliveryAdapter(env = process.env) {
  const spec = String(env.OUTBOX_DELIVERY_ADAPTER || '').trim();
  if (!spec && String(env.OUTBOX_DELIVERY_URL || '').trim()) {
    return require('./httpOutboxAdapter').createHttpAdapter(env);
  }
  if (!spec) return null;
  let adapter;
  try {
    adapter = require(require('path').resolve(spec));
  } catch (error) {
    const e = new Error('OUTBOX_DELIVERY_ADAPTER_LOAD_FAILED');
    e.cause = error;
    throw e;
  }
  if (!adapter || typeof adapter.deliver !== 'function') {
    throw new Error('OUTBOX_DELIVERY_ADAPTER_INVALID');
  }
  return adapter;
}

async function deliver(adapter, event, context = {}) {
  if (!adapter) throw new Error('DELIVERY_NOT_CONFIGURED');
  if (!event || !event.event_id) throw new Error('EVENT_ID_REQUIRED');
  const idempotencyKey = String(context.idempotencyKey || event.event_id);
  if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  const result = await adapter.deliver(event, { ...context, idempotencyKey });
  if (!result || result.delivered !== true) {
    throw new Error('DELIVERY_NOT_CONFIRMED');
  }
  return result;
}

module.exports = { loadDeliveryAdapter, deliver };
