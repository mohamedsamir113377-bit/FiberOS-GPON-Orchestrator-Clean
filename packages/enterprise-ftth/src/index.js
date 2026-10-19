'use strict';

const WORKFLOW = Object.freeze({
  planned: ['ready','cancelled'], ready: ['assigned','blocked','cancelled'], assigned: ['in_progress','blocked','cancelled'],
  in_progress: ['submitted','blocked'], submitted: ['qc_pending','rework','rejected'], qc_pending: ['accepted','rework','rejected'],
  rework: ['in_progress','cancelled'], accepted: ['closed'], rejected: ['rework','cancelled'], blocked: ['ready','cancelled'], closed: [], cancelled: []
});
const MANDATORY_GATES = Object.freeze(['design','material','safety','qc','acceptance']);
function allowedTransition(from,to){ return (WORKFLOW[from]||[]).includes(to); }
function canClose({status, gates=[]}){ return status === 'accepted' && MANDATORY_GATES.every(k => gates.some(g => g.gate_type===k && g.status==='passed')); }
function activationPrerequisites(events=[]){
  const has = type => events.some(e => e.event_type===type);
  return {drop:has('drop_installed'), ont:has('ont_installed'), router:has('router_installed'), optical:has('optical_tested')};
}
const topologyIntegrity = require('./topologyIntegrity');
const operationalIntegrity = require('./operationalIntegrity');
const qcAcceptanceIntegrity = require('./qcAcceptanceIntegrity');
module.exports = Object.freeze({ WORKFLOW, MANDATORY_GATES, allowedTransition, canClose, activationPrerequisites, topologyIntegrity, operationalIntegrity, qcAcceptanceIntegrity });
