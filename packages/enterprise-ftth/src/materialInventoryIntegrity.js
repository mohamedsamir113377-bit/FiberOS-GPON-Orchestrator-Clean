'use strict';

const MOVEMENT_TYPES = Object.freeze(['receipt','issue','return','adjustment','transfer_in','transfer_out']);

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }
function assertDate(v, field) {
  if (!nonEmpty(v)) throw new Error(`MISSING_${field.toUpperCase()}`);
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error(`INVALID_${field.toUpperCase()}`);
  return ms;
}
function assertPositiveQuantity(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error('INVALID_MATERIAL_QUANTITY');
  return n;
}

function validateItem(item) {
  if (!item || typeof item !== 'object') throw new Error('INVALID_INVENTORY_ITEM');
  for (const f of ['material_item_id','warehouse_id','unit']) if (!nonEmpty(item[f])) throw new Error(`MISSING_${f.toUpperCase()}`);
  if (item.tenant_id !== undefined && !nonEmpty(item.tenant_id)) throw new Error('INVALID_INVENTORY_TENANT_ID');
  return true;
}

function validateMovement(movement, { now = Date.now() } = {}) {
  if (!movement || typeof movement !== 'object') throw new Error('INVALID_MATERIAL_MOVEMENT');
  for (const f of ['movement_id','material_item_id','warehouse_id','movement_type','quantity','actor_id','occurred_at']) {
    if (!nonEmpty(movement[f]) && f !== 'quantity') throw new Error(`MISSING_${f.toUpperCase()}`);
    if (f === 'quantity' && (movement[f] === undefined || movement[f] === null)) throw new Error('MISSING_QUANTITY');
  }
  if (!MOVEMENT_TYPES.includes(movement.movement_type)) throw new Error('UNKNOWN_MATERIAL_MOVEMENT_TYPE');
  const quantity = assertPositiveQuantity(movement.quantity);
  const at = assertDate(movement.occurred_at, 'occurred_at');
  if (at > now) throw new Error('FUTURE_MATERIAL_MOVEMENT');
  if (movement.work_package_id !== undefined && !nonEmpty(movement.work_package_id)) throw new Error('INVALID_MATERIAL_WORK_PACKAGE_ID');
  if (movement.tenant_id !== undefined && !nonEmpty(movement.tenant_id)) throw new Error('INVALID_MATERIAL_TENANT_ID');
  return { ...movement, quantity };
}

function validateLedger({ items, movements, initialBalances = {} }, { now = Date.now() } = {}) {
  if (!Array.isArray(items) || !Array.isArray(movements)) throw new Error('INVENTORY_ARRAYS_REQUIRED');
  const itemMap = new Map();
  for (const item of items) {
    validateItem(item);
    if (itemMap.has(item.material_item_id)) throw new Error('DUPLICATE_INVENTORY_ITEM_ID');
    itemMap.set(item.material_item_id, item);
  }
  const movementIds = new Set();
  const balance = new Map();
  for (const [key, value] of Object.entries(initialBalances)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('INVALID_INITIAL_BALANCE');
    balance.set(key, n);
  }
  const sorted = movements.map(m => validateMovement(m, { now })).sort((a,b) => Date.parse(a.occurred_at)-Date.parse(b.occurred_at));
  for (const m of sorted) {
    if (movementIds.has(m.movement_id)) throw new Error('DUPLICATE_MATERIAL_MOVEMENT_ID');
    movementIds.add(m.movement_id);
    const item = itemMap.get(m.material_item_id);
    if (!item) throw new Error('MOVEMENT_REFERENCES_UNKNOWN_ITEM');
    if (m.warehouse_id !== item.warehouse_id) throw new Error('MOVEMENT_WAREHOUSE_MISMATCH');
    if (m.tenant_id !== undefined && item.tenant_id !== undefined && m.tenant_id !== item.tenant_id) throw new Error('MOVEMENT_TENANT_MISMATCH');
    const key = `${m.warehouse_id}\u0000${m.material_item_id}`;
    const current = balance.get(key) ?? 0;
    const delta = (m.movement_type === 'receipt' || m.movement_type === 'return') ? m.quantity : -m.quantity;
    const next = current + delta;
    if (next < 0) throw new Error('NEGATIVE_STOCK');
    balance.set(key, next);
  }
  return Object.freeze({ balances: Object.fromEntries(balance) });
}

module.exports = Object.freeze({ MOVEMENT_TYPES, validateItem, validateMovement, validateLedger });
