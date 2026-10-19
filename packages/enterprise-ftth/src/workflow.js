'use strict';
const WORKFLOW = Object.freeze({
  planned: ['ready','cancelled'], ready: ['assigned','blocked','cancelled'], assigned: ['in_progress','blocked','cancelled'],
  in_progress: ['submitted','blocked'], submitted: ['qc_pending','rework','rejected'], qc_pending: ['accepted','rework','rejected'],
  rework: ['in_progress','cancelled'], accepted: ['closed'], rejected: ['rework','cancelled'], blocked: ['ready','cancelled'], closed: [], cancelled: []
});
const MANDATORY_GATES = Object.freeze(['design','material','safety','qc','acceptance']);
const allowedTransition = (from,to) => (WORKFLOW[from] || []).includes(to);
module.exports = Object.freeze({WORKFLOW, MANDATORY_GATES, allowedTransition});
