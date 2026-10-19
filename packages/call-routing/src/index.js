'use strict';
/**
 * Call queue -> agent assignment engine.
 *
 * Scope, stated plainly (matches the FiberOS "no synthetic capability" rule):
 *  - This engine decides WHICH agent on the roster should take the NEXT
 *    queued call_session. It does not touch a telephony provider, does not
 *    ring a phone, and does not claim a call was actually connected.
 *  - "Assigned" means: the database now says this agent owns this session
 *    and no other assignment can be made for the same session or the same
 *    agent's other open session. Whether the agent's softphone/webhook
 *    confirms connection is a separate, later event.
 *
 * The selection logic (`selectAgent`) is pure and DB-free so it can be unit
 * tested without a database. `assignNextInQueue` is the DB-integrated path
 * that uses SELECT ... FOR UPDATE SKIP LOCKED so concurrent workers never
 * double-assign the same call or the same agent.
 */

function finiteOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick the best agent for a queued call from a list of currently-available
 * candidates. Pure function, no I/O, fully deterministic given its inputs.
 *
 * @param {{requiredSkill?: string|null}} call
 * @param {Array<{agentId:string, skills:string[], idleSinceMs:number}>} agents
 * @returns {{agentId:string, matchedSkill:boolean}|null}
 */
function selectAgent(call, agents) {
  if (!Array.isArray(agents) || agents.length === 0) return null;
  const wanted = call && call.requiredSkill ? String(call.requiredSkill) : null;

  const withSkillFlag = agents.map(a => ({
    agentId: String(a.agentId),
    idleSinceMs: finiteOrNull(a.idleSinceMs) ?? 0,
    matchedSkill: !wanted || (Array.isArray(a.skills) && a.skills.map(String).includes(wanted)),
  }));

  const pool = wanted
    ? (withSkillFlag.some(a => a.matchedSkill) ? withSkillFlag.filter(a => a.matchedSkill) : withSkillFlag)
    : withSkillFlag;

  // Longest-idle agent first (fairness): bigger idleSinceMs sorts first.
  // Tie-break on agentId for determinism.
  pool.sort((a, b) => (b.idleSinceMs - a.idleSinceMs) || (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));

  const chosen = pool[0];
  return { agentId: chosen.agentId, matchedSkill: chosen.matchedSkill };
}

/**
 * Assign the single oldest queued call_session (FIFO) for a tenant to the
 * best available agent, inside one row-locked transaction.
 *
 * Returns one of:
 *   { outcome: 'ASSIGNED', callSessionId, agentId, matchedSkill, waitSeconds }
 *   { outcome: 'NO_QUEUED_CALLS' }
 *   { outcome: 'NO_AVAILABLE_AGENT', callSessionId }
 */
async function assignNextInQueue(db, principal, { withPrincipal } = require('../../db/src/session')) {
  return withPrincipal(db, principal, async client => {
    const call = await client.query(`
      select id, required_skill, started_at, xmin::text::bigint as xmin_version
      from call_sessions
      where status = 'queued'
        and tenant_id = fiberos_current_tenant_id()
      order by started_at asc
      for update skip locked
      limit 1
    `);
    if (!call.rows[0]) return { outcome: 'NO_QUEUED_CALLS' };
    const session = call.rows[0];

    const candidates = await client.query(`
      select p.agent_id, t.skills, p.updated_at
      from contact_center_agent_presence p
      join technicians t on t.id = p.agent_id and t.is_active = true
      where p.status = 'AVAILABLE'
        and p.tenant_id = fiberos_current_tenant_id()
        and not exists (
          select 1 from call_sessions cs
          where cs.assigned_agent_id = p.agent_id
            and cs.status in ('assigned','in_progress')
        )
      for update of p skip locked
    `);
    if (!candidates.rows.length) return { outcome: 'NO_AVAILABLE_AGENT', callSessionId: session.id };

    const nowMs = Date.now();
    const agents = candidates.rows.map(r => ({
      agentId: r.agent_id,
      skills: r.skills || [],
      idleSinceMs: nowMs - new Date(r.updated_at).getTime(),
    }));
    const picked = selectAgent({ requiredSkill: session.required_skill }, agents);
    if (!picked) return { outcome: 'NO_AVAILABLE_AGENT', callSessionId: session.id };

    const waitSeconds = Math.max(0, (nowMs - new Date(session.started_at).getTime()) / 1000);

    const assigned = await client.query(
      `update call_sessions
       set status = 'assigned', assigned_agent_id = $1::uuid, assigned_at = now()
       where id = $2::uuid and tenant_id = fiberos_current_tenant_id() and status = 'queued'
         and xmin::text::bigint = $3::bigint
       returning xmin::text::bigint as xmin_version`,
      [picked.agentId, session.id, session.xmin_version]
    );
    if (!assigned.rowCount) throw Object.assign(new Error('QUEUE_VERSION_CONFLICT'), { code: 'QUEUE_VERSION_CONFLICT', statusCode: 409 });
    const assignmentVersion = assigned.rows[0] && assigned.rows[0].xmin_version;
    const assignedInsert = await client.query(
      `insert into call_queue_assignments(tenant_id, call_session_id, agent_id, matched_skill, wait_seconds)
       select tenant_id, $2::uuid, $1::uuid, $3, $4 from call_sessions where id = $2::uuid`,
      [picked.agentId, session.id, picked.matchedSkill, waitSeconds]
    );
    return {
      outcome: 'ASSIGNED',
      callSessionId: session.id,
      agentId: picked.agentId,
      matchedSkill: picked.matchedSkill,
      xminVersion: assignmentVersion,
      waitSeconds: Number(waitSeconds.toFixed(1)),
    };
  });
}

/**
 * Release an agent's active assignment (call ended, was abandoned, or the
 * agent dropped). Frees the agent for the next assignment pass.
 */
async function releaseAssignment(db, principal, { callSessionId, reason }, { withPrincipal } = require('../../db/src/session')) {
  if (!callSessionId) throw Object.assign(new TypeError('callSessionId is required'), { statusCode: 400 });
  const allowed = ['completed', 'abandoned', 'agent_dropped'];
  if (!allowed.includes(reason)) throw Object.assign(new TypeError('reason must be one of ' + allowed.join(',')), { statusCode: 400 });

  return withPrincipal(db, principal, async client => {
    const toStatus = reason === 'abandoned' ? 'abandoned' : 'completed';
    const upd = await client.query(
      `update call_sessions set status = $1, ended_at = now()
       where id = $2::uuid and status in ('assigned','in_progress')
       returning assigned_agent_id`,
      [toStatus, callSessionId]
    );
    if (!upd.rows[0]) return { outcome: 'NOT_ACTIVE' };
    await client.query(
      `update call_queue_assignments set released_at = now(), release_reason = $1
       where call_session_id = $2::uuid and released_at is null`,
      [reason, callSessionId]
    );
    return { outcome: 'RELEASED', agentId: upd.rows[0].assigned_agent_id };
  });
}

module.exports = { selectAgent, assignNextInQueue, releaseAssignment };
