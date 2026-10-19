'use strict';

/**
 * Formal interface contract registry — aligned with HTML lab INTERFACE_CONTRACTS.
 * Metadata only. Does not perform network I/O or claim production readiness.
 */

const SOVEREIGN_BOUNDARIES = require('./sovereignBoundaries');

const PORTS = Object.freeze({
  SouthboundPort: Object.freeze({
    phase: 'A_B',
    responsibility: 'Read-only optical/inventory observation from OLT/EMS',
    writeStatus: 'DEFERRED',
    writeRequires: Object.freeze(['Approval', 'SigningPort', 'audit']),
    implementation: Object.freeze({
      package: '@fiberos/adapters + @fiberos/southbound-contract',
      status: 'IMPLEMENTED_READ_ONLY'
    }),
    nonGoals: Object.freeze(['browser direct SSH', 'client-held credentials', 'silent network write'])
  }),
  EvidenceGate: Object.freeze({
    phase: 'B',
    responsibility: 'Allow or block final ticket close',
    rules: Object.freeze([
      'ai_simulated|proxy never finalClose',
      'missing geo or field evidence => awaiting_evidence',
      'requiresSignature without signatureRef => pending_signature fail-closed'
    ]),
    implementation: Object.freeze({
      package: '@fiberos/ftth-measurements + fieldClose.applyAuthoritativeCloseGate',
      status: 'IMPLEMENTED'
    })
  }),
  OutboxPublisher: Object.freeze({
    phase: 'A_B',
    responsibility: 'Reliable event publish after local DB commit',
    implementation: Object.freeze({
      package: 'services/worker + outboxDelivery',
      status: 'IMPLEMENTED_FAIL_CLOSED'
    }),
    nonGoals: Object.freeze(['fire-and-forget without delivered:true'])
  }),
  SigningPort: Object.freeze({
    phase: 'F',
    responsibility: 'Sign sensitive closes / topology / financial ops',
    implementation: Object.freeze({
      package: '@fiberos/signing-port',
      status: 'IMPLEMENTED_HMAC',
      hsm: 'NOT_IMPLEMENTED'
    }),
    rules: Object.freeze(['browser never sees keys', 'fail-closed blocks finalClose', 'HSM optional behind port'])
  }),
  VrpEngine: Object.freeze({
    phase: 'E',
    responsibility: 'Deterministic field assignment ranking',
    deterministic: true,
    authority: 'ADVISORY_SCORE_ONLY',
    implementation: Object.freeze({
      package: '@fiberos/dispatch',
      status: 'IMPLEMENTED'
    })
  }),
  WebIntelligenceCore: Object.freeze({
    phase: 'SOVEREIGN',
    responsibility: 'Website-only self-hosted AI orchestration',
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false,
    implementation: Object.freeze({
      package: '@fiberos/web-intelligence-core',
      status: 'IMPLEMENTED_CONTRACT_ONLY'
    })
  }),
  SovereignGIS: Object.freeze({
    phase: 'SOVEREIGN',
    responsibility: 'FiberOS-authoritative GIS, Digital Twin and routing abstraction',
    sourceOfTruth: 'FIBEROS_DATABASE',
    implementation: Object.freeze({
      package: '@fiberos/sovereign-gis',
      status: 'IMPLEMENTED_RUNTIME_READ_ONLY'
    })
  }),
  SovereignContactCenter: Object.freeze({
    phase: 'SOVEREIGN',
    responsibility: 'Distributed control/media contact-center boundary',
    authority: 'FIBEROS_POLICY',
    implementation: Object.freeze({
      package: '@fiberos/sovereign-contact-center',
      status: 'IMPLEMENTED_CONTRACT_ONLY'
    })
  }),
  AiBoundary: Object.freeze({
    phase: 'C',
    responsibility: 'Advisory inference only',
    implementation: Object.freeze({
      package: '@fiberos/ai-boundary',
      status: 'IMPLEMENTED',
      executionAuthorized: false
    })
  })
});

function listPorts() {
  return Object.keys(PORTS).sort();
}

function getPort(name) {
  return PORTS[name] || null;
}

function summary() {
  return Object.freeze({
    schemaVersion: 'fiberos-interface-contracts-v1',
    productionClaim: 'PROHIBITED_UNTIL_MATRIX_EVIDENCE',
    ports: listPorts().map(function (name) {
      const p = PORTS[name];
      return Object.freeze({
        name: name,
        phase: p.phase,
        status: p.implementation && p.implementation.status,
        package: p.implementation && p.implementation.package
      });
    })
  });
}

module.exports = {
  PORTS,
  SOVEREIGN_BOUNDARIES,
  listPorts,
  getPort,
  summary
};
