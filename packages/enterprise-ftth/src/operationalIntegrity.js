'use strict';

const { WORKFLOW, MANDATORY_GATES, allowedTransition } = require('./workflow');

const OPERATION_STAGES = Object.freeze([
  'survey','design','permit','material','civil','duct','cable','splicing','testing','qc','acceptance','drop','activation'
]);

function nonEmpty(v){ return typeof v === 'string' && v.trim().length > 0; }
function dateMs(v, field){
  if (!nonEmpty(v)) throw new Error(`MISSING_${field.toUpperCase()}`);
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error(`INVALID_${field.toUpperCase()}`);
  return ms;
}

function validateWorkPackageHeader(wp, { now = Date.now() } = {}) {
  if (!wp || typeof wp !== 'object') throw new Error('INVALID_WORK_PACKAGE');
  for (const f of ['work_package_id','tenant_id','status']) if (!nonEmpty(wp[f])) throw new Error(`MISSING_WORK_PACKAGE_${f.toUpperCase()}`);
  if (!Object.prototype.hasOwnProperty.call(WORKFLOW, wp.status)) throw new Error('UNKNOWN_WORK_PACKAGE_STATUS');
  if (wp.created_at !== undefined && dateMs(wp.created_at,'created_at') > now) throw new Error('FUTURE_WORK_PACKAGE');
  return true;
}

function validateTransition(command, { now = Date.now() } = {}) {
  if (!command || typeof command !== 'object') throw new Error('INVALID_WORKFLOW_COMMAND');
  for (const f of ['work_package_id','from_status','to_status','actor_id','occurred_at']) if (!nonEmpty(command[f])) throw new Error(`MISSING_WORKFLOW_${f.toUpperCase()}`);
  if (!allowedTransition(command.from_status, command.to_status)) throw new Error('INVALID_WORKFLOW_TRANSITION');
  const occurred = dateMs(command.occurred_at,'occurred_at');
  if (occurred > now) throw new Error('FUTURE_WORKFLOW_TRANSITION');
  return true;
}

function validateStageSequence(events, { now = Date.now() } = {}) {
  if (!Array.isArray(events)) throw new Error('STAGE_EVENTS_ARRAY_REQUIRED');
  const seen = new Set();
  let last = -1;
  for (const e of events) {
    if (!e || typeof e !== 'object' || !nonEmpty(e.stage) || !nonEmpty(e.occurred_at)) throw new Error('INVALID_STAGE_EVENT');
    if (!OPERATION_STAGES.includes(e.stage)) throw new Error('UNKNOWN_OPERATION_STAGE');
    const t = dateMs(e.occurred_at,'occurred_at');
    if (t > now) throw new Error('FUTURE_STAGE_EVENT');
    if (seen.has(e.stage)) throw new Error('DUPLICATE_OPERATION_STAGE');
    seen.add(e.stage);
    const idx = OPERATION_STAGES.indexOf(e.stage);
    if (idx < last) throw new Error('OUT_OF_ORDER_OPERATION_STAGE');
    last = idx;
  }
  return true;
}

function validateMandatoryGates(gates) {
  if (!Array.isArray(gates)) throw new Error('GATES_ARRAY_REQUIRED');
  const passed = new Set();
  for (const g of gates) {
    if (!g || !nonEmpty(g.gate_type) || g.status !== 'passed' || !nonEmpty(g.rule_version)) throw new Error('INVALID_OPERATION_GATE');
    if (passed.has(g.gate_type)) throw new Error('DUPLICATE_OPERATION_GATE');
    passed.add(g.gate_type);
  }
  const missing = MANDATORY_GATES.filter(g => !passed.has(g));
  if (missing.length) throw new Error(`MISSING_MANDATORY_GATES:${missing.join(',')}`);
  return true;
}

function validateOperationalClosure(record, { now = Date.now() } = {}) {
  if (!record || typeof record !== 'object') throw new Error('INVALID_OPERATIONAL_RECORD');
  validateWorkPackageHeader(record.work_package, { now });
  if (record.transition) validateTransition(record.transition, { now });
  validateStageSequence(record.stage_events || [], { now });
  if (record.work_package.status === 'closed') {
    if (!record.acceptance || record.acceptance.status !== 'accepted') throw new Error('CLOSED_WORK_PACKAGE_REQUIRES_ACCEPTANCE');
    validateMandatoryGates(record.acceptance.gates);
  }
  return true;
}

module.exports = Object.freeze({ OPERATION_STAGES, validateWorkPackageHeader, validateTransition, validateStageSequence, validateMandatoryGates, validateOperationalClosure });
