'use strict';

const crypto = require('node:crypto');
const { buildGraph } = require('../../unified-intelligence-graph/src');

const MAX_ASSETS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertClient(client) {
  if (!client || typeof client.query !== 'function') throw new Error('CONTACT_INTELLIGENCE_DB_CLIENT_REQUIRED');
}
function assertUuid(value, code = 'CONTACT_INTELLIGENCE_CALL_SESSION_ID_INVALID') {
  const id = String(value || '');
  if (!UUID.test(id)) throw new Error(code);
  return id;
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function dedupe(ids) {
  return [...new Set(ids.filter(id => UUID.test(String(id || ''))).map(String))].slice(0, MAX_ASSETS);
}

function buildCorrelationGraph({ callSession, ticket = null, incidents = [] } = {}) {
  const nodes = [], edges = [];
  const addNode = (type,id,attributes={}) => { if (id == null) return; const key=type+':'+String(id); if (!nodes.some(n=>n.key===key)) nodes.push({key,type,id:String(id),attributes}); };
  const addEdge = (fromType,fromId,toType,toId,relation) => { if (fromId==null||toId==null) return; const edge={from:fromType+':'+String(fromId),to:toType+':'+String(toId),relation}; if(!edges.some(e=>JSON.stringify(e)===JSON.stringify(edge))) edges.push(edge); };
  if(callSession?.id!=null) addNode('CALL',callSession.id,{provider:callSession.provider||null,direction:callSession.direction||null});
  if(ticket?.id!=null) addNode('TICKET',ticket.id,{status:ticket.status||null,serviceId:ticket.service_id||ticket.serviceId||null});
  if(callSession?.service_id!=null) addNode('SERVICE',callSession.service_id);
  if(ticket?.service_id!=null) addNode('SERVICE',ticket.service_id);
  if(ticket?.technician_id!=null) addNode('TECHNICIAN',ticket.technician_id);
  for(const incident of incidents||[]){ addNode('INCIDENT',incident.id,{severity:incident.severity||null,state:incident.state||null}); if(incident.primary_asset_id!=null)addNode('ASSET',incident.primary_asset_id); if(incident.ticketId!=null)addEdge('INCIDENT',incident.id,'TICKET',incident.ticketId,'EXPLICIT_TICKET_LINK'); if(incident.serviceId!=null)addEdge('INCIDENT',incident.id,'SERVICE',incident.serviceId,'EXPLICIT_SERVICE_LINK'); if(incident.primary_asset_id!=null)addEdge('INCIDENT',incident.id,'ASSET',incident.primary_asset_id,'PRIMARY_ASSET'); }
  if(callSession?.id!=null&&callSession.ticket_id!=null)addEdge('CALL',callSession.id,'TICKET',callSession.ticket_id,'SERVER_TICKET_LINK');
  if(callSession?.id!=null&&callSession.service_id!=null)addEdge('CALL',callSession.id,'SERVICE',callSession.service_id,'SERVER_SERVICE_LINK');
  if(ticket?.id!=null&&ticket.service_id!=null)addEdge('TICKET',ticket.id,'SERVICE',ticket.service_id,'SERVER_SERVICE_LINK');
  if(ticket?.id!=null&&ticket.technician_id!=null)addEdge('TICKET',ticket.id,'TECHNICIAN',ticket.technician_id,'ASSIGNED_TECHNICIAN');
  const activeCount=(incidents||[]).filter(i=>!['resolved','closed'].includes(String(i.state||'').toLowerCase())).length;
  nodes.sort((a,b)=>a.type.localeCompare(b.type)||a.id.localeCompare(b.id));
  edges.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.relation.localeCompare(b.relation));
  return Object.freeze({schema:'fiberos.contact-correlation.v1',status:activeCount>1?'AMBIGUOUS_ACTIVE_INCIDENTS':'CORRELATED',readOnly:true,advisoryOnly:true,executionAuthorized:false,nodes,edges,ambiguity:activeCount>1?{reason:'MULTIPLE_ACTIVE_EXPLICIT_INCIDENTS',count:activeCount}:null});
}

async function buildContactIntelligence(client, input = {}) {
  assertClient(client);
  if (Object.prototype.hasOwnProperty.call(input, 'tenantId')) throw new Error('CONTACT_INTELLIGENCE_TENANT_ID_FORBIDDEN');
  const callSessionId = assertUuid(input.callSessionId);

  const session = await client.query({
    text: `SELECT id, provider, direction, status, ivr_state, service_id, ticket_id, started_at
           FROM call_sessions WHERE id=$1::uuid`,
    values: [callSessionId]
  });
  if (!session.rows[0]) throw new Error('CONTACT_INTELLIGENCE_CALL_SESSION_NOT_FOUND');
  const s = session.rows[0];

  const [ticketRows, eventsRows] = await Promise.all([
    s.ticket_id ? client.query({
      text: `SELECT id, status, type, service_id, technician_id, sla_deadline
             FROM tickets WHERE id=$1::uuid LIMIT 1`,
      values: [s.ticket_id]
    }) : Promise.resolve({ rows: [] }),
    client.query({
      text: `SELECT event_type, occurred_at FROM call_events
             WHERE call_session_id=$1::uuid ORDER BY occurred_at DESC LIMIT 20`,
      values: [callSessionId]
    })
  ]);

  const ticket = ticketRows.rows[0] || null;
  let incidents = [];
  if (ticket) {
    // Correlation is explicit: only incidents carrying the server-owned
    // ticket/service relationship are eligible. We do not infer a relationship
    // merely because an incident exists in the same tenant.
    incidents = (await client.query({
      text: `SELECT id, incident_key, severity, state, primary_asset_id
             FROM incidents
             WHERE state NOT IN ('resolved','closed')
               AND primary_asset_id IS NOT NULL
               AND (metadata->>'ticketId' = $1::text OR metadata->>'serviceId' = $2::text)
             ORDER BY created_at DESC LIMIT 20`,
      values: [ticket.id, ticket.service_id]
    })).rows;
  }

  const assetIds = dedupe(incidents.map(i => i.primary_asset_id));
  const assetIntelligence = [];
  for (const assetId of assetIds) {
    try {
      assetIntelligence.push(await buildGraph(client, { assetId, depth: 4, neighborLimit: 20, assessmentLimit: 10 }));
    } catch (e) {
      assetIntelligence.push({ assetId, unavailable: e.code || e.message || 'GRAPH_UNAVAILABLE' });
    }
  }

  const correlationGraph=buildCorrelationGraph({callSession:s,ticket,incidents});
  const out = {
    authority: 'FIBEROS_DATABASE_RLS',
    availability: assetIntelligence.some(item => item.unavailable) ? 'DEGRADED' : 'COMPLETE',
    degraded: assetIntelligence.some(item => item.unavailable),
    readOnly: true,
    advisoryOnly: true,
    executionAuthorized: false,
    telephonyConfirmed: false,
    call: {
      id: s.id, provider: s.provider, direction: s.direction, status: s.status,
      ivrState: s.ivr_state, serviceLinked: Boolean(s.service_id), ticketLinked: Boolean(s.ticket_id), startedAt: s.started_at
    },
    ticket: ticket ? { id: ticket.id, status: ticket.status, type: ticket.type, serviceId: ticket.service_id, slaDeadline: ticket.sla_deadline } : null,
    incidents: incidents.map(i => ({ id:i.id, key:i.incident_key, severity:i.severity, state:i.state, assetId:i.primary_asset_id })),
    correlationGraph,
    assetIntelligence,
    recentCallEvents: eventsRows.rows.map(e => ({ type:e.event_type, occurredAt:e.occurred_at })),
    aiPolicy: { authority:'ADVISORY_ONLY', executionAuthorized:false, customerIdentifiersExcluded:true, secretsExcluded:true },
    provenance: { callSessionId:s.id, ticketId:s.ticket_id, incidentIds:incidents.map(i=>i.id), assetIds }
  };
  return Object.freeze({ ...out, resultSha256: digest(out) });
}

module.exports = Object.freeze({ MAX_ASSETS, buildContactIntelligence, buildCorrelationGraph, assertUuid });
