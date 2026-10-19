'use strict';

/*
 * FiberOS Buyer Evaluation Mode
 *
 * This layer is deliberately opt-in via ?mode=evaluation. It never affects
 * ordinary/live mode. Its purpose is to make the buyer-facing static preview
 * demonstrable without claiming that PostgreSQL/OIDC/Redis/NMS/PSTN or other
 * external services are connected. Every dataset returned here is explicitly
 * marked as demonstration data.
 */
(() => {
  const params = new URL(location.href).searchParams;
  if (params.get('mode') !== 'evaluation' && !location.pathname.endsWith('/evaluation.html')) return;

  const originalFetch = window.fetch.bind(window);
  const EVALUATION_DAYS = 30;
  const STORAGE_KEY = 'fiberos_buyer_evaluation_started_at_v1';
  const now = Date.now();
  let startedAt = now;
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0 && saved <= now) startedAt = saved;
    else localStorage.setItem(STORAGE_KEY, String(now));
  } catch (_) {
    // A private/restricted browser may deny localStorage. The evaluation then
    // remains a session-scoped convenience mode, never a security boundary.
  }
  const expiresAt = startedAt + EVALUATION_DAYS * 86400000;
  const state = {
    sequence: 1000,
    calls: [
      { id: 'DEMO-CALL-1001', status: 'queued', direction: 'inbound', callerNumber: '+0000000001', customerRef: 'DEMO-CUST-01', action: null },
      { id: 'DEMO-CALL-1002', status: 'queued', direction: 'inbound', callerNumber: '+0000000002', customerRef: 'DEMO-CUST-02', action: null },
      { id: 'DEMO-CALL-1003', status: 'active', direction: 'inbound', callerNumber: '+0000000003', customerRef: 'DEMO-CUST-03', action: 'agent' }
    ],
    incidents: [
      { severity: 'P1', title: 'Demo core aggregation outage', state: 'investigating', affected_customers: 420 },
      { severity: 'P2', title: 'Demo access node degradation', state: 'monitoring', affected_customers: 96 }
    ],
    fleet: [
      { name: 'DEMO-TECH-01', technician_id: 'DEMO-TECH-01', latitude: 25.0000, longitude: 55.0000, source: 'demo_fixture' },
      { name: 'DEMO-TECH-02', technician_id: 'DEMO-TECH-02', latitude: 25.0120, longitude: 55.0160, source: 'demo_fixture' },
      { name: 'DEMO-TECH-03', technician_id: 'DEMO-TECH-03', latitude: 24.9880, longitude: 55.0260, source: 'demo_fixture' }
    ],
    tickets: [
      { id: 'DEMO-T-101', ticketId: 'DEMO-T-101', status: 'open', type: 'LOS', latitude: 25.0060, longitude: 55.0100 },
      { id: 'DEMO-T-102', ticketId: 'DEMO-T-102', status: 'in_progress', type: 'low_power', latitude: 25.0180, longitude: 55.0020 },
      { id: 'DEMO-T-103', ticketId: 'DEMO-T-103', status: 'open', type: 'ONT_offline', latitude: 24.9940, longitude: 55.0190 },
      { id: 'DEMO-T-104', ticketId: 'DEMO-T-104', status: 'open', type: 'fiber_cut', latitude: 25.0040, longitude: 55.0310 }
    ],
    evidence: [],
    positions: []
  };

  const capabilities = [
    ['FTTH engineering workflows', 'REAL'],
    ['Optical measurement handling', 'REAL'],
    ['Field dispatch ranking', 'REAL'],
    ['Server-authoritative field closure', 'INTEGRATION_REQUIRED'],
    ['GIS / Digital Twin surfaces', 'INTEGRATION_REQUIRED'],
    ['Multi-tenant database isolation', 'INTEGRATION_REQUIRED'],
    ['Contact-center queue logic', 'REAL'],
    ['Crisis command surfaces', 'REAL'],
    ['Production OIDC/JWKS', 'INTEGRATION_REQUIRED'],
    ['Vendor NMS / OTDR adapters', 'INTEGRATION_REQUIRED'],
    ['External telephony/PSTN', 'INTEGRATION_REQUIRED'],
    ['Autonomous financial execution', 'UNIMPLEMENTED']
  ].map(([name, status], i) => ({
    id: `DEMO-CAP-${String(i + 1).padStart(3, '0')}`,
    name,
    status,
    notes: 'Demonstration classification only; verify the production boundary before deployment.',
    serverSurfaces: []
  }));

  const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });

  const bodyJson = async (input, init) => {
    try {
      if (init && typeof init.body === 'string') return JSON.parse(init.body);
      if (input instanceof Request) return JSON.parse(await input.clone().text());
    } catch (_) {}
    return {};
  };

  const pathOf = (input) => {
    try { return new URL(typeof input === 'string' ? input : input.url, location.href).pathname; }
    catch (_) { return ''; }
  };

  const route = async (path, method, body) => {
    const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));
    if (Date.now() >= expiresAt) {
      return jsonResponse({
        error: 'EVALUATION_WINDOW_EXPIRED',
        evaluationMode: true,
        evaluationWindowDays: EVALUATION_DAYS,
        note: 'The buyer evaluation window has expired. This client-side window is not a license-security boundary.'
      }, 410);
    }

    if (path === '/health' && method === 'GET') return jsonResponse({
      status: 'ok', service: 'fiberos-evaluation-gateway', evaluationMode: true,
      evaluationDays: EVALUATION_DAYS, evaluationDaysRemaining: daysLeft,
      externalRuntimeConnected: false, syntheticData: true,
      authority: 'DEMO_EVALUATION_WORKSPACE'
    });

    if (path === '/v1/command/rooms/overview' && method === 'GET') {
      const queued = state.calls.filter(c => c.status === 'queued').length;
      const active = state.calls.filter(c => c.status === 'active').length;
      const openTickets = state.tickets.filter(t => t.status !== 'completed').length;
      const p1 = state.incidents.filter(x => x.severity === 'P1').length;
      return jsonResponse({
        authority: 'DEMO_EVALUATION_WORKSPACE', syntheticData: true, dataDegraded: false,
        externalRuntimeConnected: false, evaluationMode: true,
        rooms: {
          contactCenter: { queued, active, abandoned: 2, agents: { available: 7 } },
          network: { assets: 42, mapped_assets: 39, active_incidents: state.incidents.length, open_tickets: openTickets },
          fieldOperations: { technicians: 28, tracked_technicians: state.positions.length || 23, unassigned_tickets: 6, pending_dispatch: 4 },
          supplyChain: { active_warehouses: 3, active_bins: 142, items: 1842, activeReservations: 17, pendingTransfers: 4 },
          crisisExecutive: { active_incidents: state.incidents.length, p1_incidents: p1, affected_customers: 516 }
        }
      });
    }

    if (path === '/v1/gis/fusion/layers' && method === 'GET') return jsonResponse({
      authority: 'DEMO_EVALUATION_WORKSPACE', syntheticData: true, externalRuntimeConnected: false,
      evaluationMode: true, layers: { assets: [
        { id: 'A-01', asset_code: 'DEMO-OLT-01', latitude: 25.020, longitude: 55.012 },
        { id: 'A-02', asset_code: 'DEMO-ODF-02', latitude: 24.995, longitude: 55.004 },
        { id: 'A-03', asset_code: 'DEMO-SPL-03', latitude: 25.006, longitude: 55.028 }
      ], technicians: state.fleet, tickets: state.tickets }
    });

    if (path === '/v1/gis/fleet' && method === 'GET') return jsonResponse({ fleet: state.fleet });

    if (path === '/v1/gis/positions' && method === 'POST') {
      const p = body || {};
      const row = { technician_id: String(p.technicianId || 'DEMO-TECH'), name: String(p.technicianId || 'DEMO-TECH'), latitude: Number(p.lat), longitude: Number(p.lon), source: 'demo_device' };
      if (Number.isFinite(row.latitude) && Number.isFinite(row.longitude)) state.positions.push(row);
      return jsonResponse({ accepted: true, persisted: false, demo: true, evaluationMode: true, position: row });
    }

    if (path === '/v1/call-center/sessions' && method === 'POST') {
      const id = `DEMO-CALL-${++state.sequence}`;
      const row = { id, status: 'queued', direction: body?.direction || 'inbound', callerNumber: body?.callerNumber || '+0000000000', customerRef: body?.customerRef || null, action: null };
      state.calls.push(row);
      return jsonResponse({ session: row, queuePosition: state.calls.filter(c => c.status === 'queued').length, demo: true, evaluationMode: true });
    }

    const ivr = path.match(/^\/v1\/call-center\/sessions\/([^/]+)\/ivr$/);
    if (ivr && method === 'POST') {
      const row = state.calls.find(c => c.id === decodeURIComponent(ivr[1]));
      if (!row) return jsonResponse({ error: 'DEMO_CALL_NOT_FOUND' }, 404);
      const prompts = { '1': 'Demo IVR: fault workflow selected.', '2': 'Demo IVR: appointment workflow selected.', '3': 'Demo IVR: agent transfer workflow selected.' };
      row.action = String(body?.action || '');
      return jsonResponse({ sessionId: row.id, action: row.action, nextPrompt: prompts[row.action] || 'Demo IVR: continue.', demo: true, evaluationMode: true });
    }

    if (path === '/v1/call-center/queue/assign' && method === 'POST') {
      const row = state.calls.find(c => c.status === 'queued');
      if (!row) return jsonResponse({ assigned: false, message: 'Demo queue is empty.', demo: true, evaluationMode: true });
      row.status = 'active'; row.agent = 'DEMO-AGENT-01';
      return jsonResponse({ assigned: true, sessionId: row.id, agentId: row.agent, demo: true, evaluationMode: true });
    }

    if (path === '/v1/call-center/queue/release' && method === 'POST') {
      const row = state.calls.find(c => c.id === String(body?.callSessionId || ''));
      if (!row) return jsonResponse({ error: 'DEMO_CALL_NOT_FOUND' }, 404);
      row.status = 'completed'; row.releaseReason = String(body?.reason || 'completed');
      return jsonResponse({ released: true, sessionId: row.id, reason: row.releaseReason, demo: true, evaluationMode: true });
    }

    if (path === '/v1/crisis/command-state' && method === 'GET') return jsonResponse({
      mode: 'DEMO_EVALUATION', affectedCustomers: 516, incidents: state.incidents, demo: true, evaluationMode: true
    });

    if (path === '/v1/crisis/incidents' && method === 'POST') {
      const incident = {
        severity: String(body?.severity || 'P3'), title: String(body?.title || 'Demo incident'), state: 'declared',
        affected_customers: Math.max(0, Number(body?.affectedCustomers || 0)), incidentKey: String(body?.incidentKey || `DEMO-${Date.now()}`)
      };
      state.incidents.unshift(incident);
      return jsonResponse({ incident, demo: true, evaluationMode: true });
    }

    if (path === '/v1/assurance/capabilities' && method === 'GET') return jsonResponse({
      evaluationMode: true, demo: true, summary: {
        total: capabilities.length,
        counts: { REAL: capabilities.filter(x => x.status === 'REAL').length }
      }, capabilities
    });

    if (path === '/v1/dispatch/rank' && method === 'POST') {
      const required = String(body?.requiredSkill || 'fiber').toLowerCase();
      const deadline = body?.slaDeadline ? String(body.slaDeadline) : null;
      const ranked = [
        { technicianId: 'DEMO-TECH-01', skillMatch: required === 'fiber', distanceKm: 1.2, workload: 2, rank: 1 },
        { technicianId: 'DEMO-TECH-02', skillMatch: true, distanceKm: 3.7, workload: 1, rank: 2 },
        { technicianId: 'DEMO-TECH-03', skillMatch: true, distanceKm: 5.1, workload: 4, rank: 3 }
      ];
      return jsonResponse({ ticketId: body?.ticketId || 'DEMO-T-101', requiredSkill: required, slaDeadline: deadline, ranking: ranked, authority: 'DEMO_EVALUATION_WORKSPACE', demo: true });
    }

    if (path === '/v1/ftth-advisory/exception-board' && method === 'POST') {
      const tickets = Array.isArray(body?.tickets) ? body.tickets : [];
      const result = tickets.map((t, i) => {
        const reasons = [];
        if (t.slaBreached) reasons.push('SLA breached');
        if (t.openConflict) reasons.push('open conflict');
        if (t.evidenceStale) reasons.push('stale evidence');
        const severity = reasons.length >= 2 ? 'HIGH' : reasons.length === 1 ? 'MEDIUM' : 'LOW';
        return { ticketId: String(t.ticketId || `DEMO-T-${i + 1}`), severity, reasons };
      }).sort((a, b) => ({HIGH:0,MEDIUM:1,LOW:2}[a.severity] - {HIGH:0,MEDIUM:1,LOW:2}[b.severity]));
      return jsonResponse({ result, demo: true, evaluationMode: true });
    }

    if (path === '/v1/operations/realtime/snapshot' && method === 'GET') return jsonResponse({
      snapshot: { tickets: state.tickets.map(x => ({ id: x.id, status: x.status, type: x.type })) }, demo: true, evaluationMode: true
    });

    if (path === '/v1/executive/financial-snapshot' && method === 'GET') return jsonResponse({
      financial: { issuedAmountMinor: 12500000 }, operations: { openTickets: state.tickets.length }, demo: true, evaluationMode: true,
      note: 'Demonstration values only; not connected to financial systems.'
    });

    if (path === '/v1/evidence/submit' && method === 'POST') {
      const item = { id: `DEMO-EVIDENCE-${++state.sequence}`, ticketId: String(body?.ticketId || ''), capturedAt: body?.payload?.capturedAt || new Date().toISOString() };
      state.evidence.push(item);
      return jsonResponse({ accepted: true, persisted: false, demo: true, evaluationMode: true, evidenceId: item.id, note: 'Stored only in this browser session; no external DB write occurred.' });
    }

    if (path === '/v1/tickets/close-field' && method === 'POST') return jsonResponse({
      ok: true, persisted: false, demo: true, evaluationMode: true,
      ticketId: String(body?.ticketId || ''), toStatus: 'completed',
      note: 'Demonstration transition only. No production ticket was closed.'
    });

    return jsonResponse({ error: 'DEMO_ROUTE_NOT_IMPLEMENTED', path, method, evaluationMode: true }, 404);
  };

  window.__FIBEROS_EVALUATION_MODE__ = Object.freeze({ enabled: true, startedAt, expiresAt, days: EVALUATION_DAYS });
  window.__FIBEROS_DEMO_API__ = location.origin;
  window.fetch = async (input, init = {}) => {
    const path = pathOf(input);
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!path.startsWith('/v1/') && path !== '/health') return originalFetch(input, init);
    const body = await bodyJson(input, init);
    return route(path, method, body);
  };

  const rewriteEvaluationCopy = () => {
    const textBySelector = [
      ['.badge', 'BUYER EVALUATION MODE'],
      ['header .muted', 'Buyer evaluation workspace — deterministic local demonstration data only'],
      ['#truth', 'Evaluation workspace. All displayed metrics are deterministic local fixtures; no production data is being claimed.'],
      ['h2 + .muted', 'Evaluation spatial fixtures — not live operational coordinates.'],
      ['#connection-title + p', 'Demo capture workflow. Camera/GPS/OCR can run locally; submissions stay inside this browser session.'],
      ['#status-title ~ div .pill:last-child', 'demo close — no production ticket closure']
    ];
    for (const [selector, value] of textBySelector) {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    }
    document.querySelectorAll('[data-action=loadMap]').forEach((el) => { el.textContent = 'Load Demo Fleet'; });
    document.querySelectorAll('[data-action=startGps]').forEach((el) => { el.textContent = 'Record Demo GPS'; });
    document.querySelectorAll('[data-action=submitEvidence]').forEach((el) => { el.textContent = 'Store Demo Evidence'; });
  };

  const mountBanner = () => {
    if (document.querySelector('.fiberos-eval-banner')) return;
    rewriteEvaluationCopy();
    const banner = document.createElement('div');
    banner.className = 'fiberos-eval-banner';
    const remaining = Math.max(1, Math.ceil((expiresAt - Date.now()) / 86400000));
    banner.innerHTML = `<div class="eval-main"><span class="fiberos-eval-badge">BUYER EVALUATION MODE</span><span class="fiberos-eval-copy">${remaining}-day browser evaluation · demonstration data only · no external runtime is claimed</span></div><div class="fiberos-eval-nav"><a href="/ops/?mode=evaluation">Operations</a><a href="/ops/enterprise-command.html?mode=evaluation">Command Center</a><a href="/field/?mode=evaluation">Field</a><span class="fiberos-eval-boundary">Not a production/license security boundary</span></div>`;
    document.body.prepend(banner);

    const note = document.createElement('div');
    note.className = 'fiberos-eval-local-note';
    note.textContent = 'Buyer Evaluation Mode: controls below exercise deterministic local demo fixtures. No PostgreSQL, Redis, OIDC, NMS, PSTN, storage, or external production system is being contacted from this mode.';
    const target = document.querySelector('main') || document.querySelector('.wrap') || document.body;
    target.insertBefore(note, target.firstChild);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBanner, { once: true });
  else mountBanner();
})();
