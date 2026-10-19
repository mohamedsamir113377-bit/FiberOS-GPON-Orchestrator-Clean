'use strict';

const LINK_ROLES = Object.freeze(['trigger','context','impact','resolution']);

async function linkOperationalEventToIncident(client,{tenantId,eventId,incidentId,linkRole='trigger',actorId=null}={}) {
  if (!client || typeof client.query!=='function') throw Object.assign(new Error('DB_CLIENT_REQUIRED'),{code:'DB_CLIENT_REQUIRED'});
  if(!tenantId||!eventId||!incidentId) throw Object.assign(new Error('EVIDENCE_INCIDENT_LINK_INPUT_REQUIRED'),{code:'EVIDENCE_INCIDENT_LINK_INPUT_REQUIRED'});
  if(!LINK_ROLES.includes(String(linkRole))) throw Object.assign(new Error('EVIDENCE_INCIDENT_LINK_ROLE_INVALID'),{code:'EVIDENCE_INCIDENT_LINK_ROLE_INVALID'});
  const event=await client.query(
    'select event_id,tenant_id,canonical_event_version,correlation_id,causation_id,idempotency_key,integrity_sha256 from outbox_events where event_id=$1::uuid and tenant_id=$2 for share',
    [eventId,tenantId]);
  if(!event.rows[0]) throw Object.assign(new Error('OPERATIONAL_EVENT_NOT_FOUND'),{code:'OPERATIONAL_EVENT_NOT_FOUND'});
  if(event.rows[0].canonical_event_version!=='fiberos.operational-event.v1') throw Object.assign(new Error('OPERATIONAL_EVENT_NOT_CANONICAL'),{code:'OPERATIONAL_EVENT_NOT_CANONICAL'});
  const incident=await client.query(
    'select id,tenant_id,incident_key,state,severity from incidents where id=$1::uuid and tenant_id=$2 for share',
    [incidentId,tenantId]);
  if(!incident.rows[0]) throw Object.assign(new Error('INCIDENT_NOT_FOUND'),{code:'INCIDENT_NOT_FOUND'});
  const inserted=await client.query(
    `insert into operational_event_incident_links(tenant_id,event_id,incident_id,link_role,created_by)
     values($1,$2::uuid,$3::uuid,$4,$5::uuid)
     on conflict (tenant_id,event_id,incident_id,link_role) do nothing
     returning id,tenant_id,event_id,incident_id,link_role,created_by,created_at`,
    [tenantId,eventId,incidentId,linkRole,actorId]);
  if(inserted.rows[0]) return {link:inserted.rows[0],replayed:false,event:event.rows[0],incident:incident.rows[0]};
  const replay=await client.query(
    'select id,tenant_id,event_id,incident_id,link_role,created_by,created_at from operational_event_incident_links where tenant_id=$1 and event_id=$2::uuid and incident_id=$3::uuid and link_role=$4',
    [tenantId,eventId,incidentId,linkRole]);
  if(!replay.rows[0]) throw Object.assign(new Error('EVIDENCE_INCIDENT_LINK_COLLISION'),{code:'EVIDENCE_INCIDENT_LINK_COLLISION'});
  return {link:replay.rows[0],replayed:true,event:event.rows[0],incident:incident.rows[0]};
}
module.exports={LINK_ROLES,linkOperationalEventToIncident};
