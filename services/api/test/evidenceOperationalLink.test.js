'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

test('operational event to Evidence Vault linkage is tenant-bound and append-only', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'sql/migrations/155_operational_event_evidence_links.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS operational_event_evidence_links/);
  assert.match(migration, /REFERENCES outbox_events\(event_id\) ON DELETE RESTRICT/);
  assert.match(migration, /REFERENCES evidence_vault_objects\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /tenant_id=fiberos_current_tenant_id\(\)/);
  assert.match(migration, /TENANT_MISMATCH_OPERATIONAL_EVENT/);
  assert.match(migration, /TENANT_MISMATCH_EVIDENCE_VAULT/);
  assert.match(migration, /OPERATIONAL_EVENT_EVIDENCE_LINK_APPEND_ONLY/);
  assert.match(migration, /UNIQUE\(tenant_id,event_id,evidence_vault_id,link_role\)/);
});

test('application linkage requires a canonical event and never fabricates evidence', () => {
  const helper = fs.readFileSync(path.join(ROOT, 'packages/operational-context/src/evidenceLink.js'), 'utf8');
  assert.match(helper, /OPERATIONAL_EVENT_NOT_FOUND/);
  assert.match(helper, /OPERATIONAL_EVENT_NOT_CANONICAL/);
  assert.match(helper, /EVIDENCE_VAULT_OBJECT_NOT_FOUND/);
  assert.match(helper, /on conflict \(tenant_id,event_id,evidence_vault_id,link_role\) do nothing/);
  assert.doesNotMatch(helper, /insert into evidence_vault_objects/);
});

test('evidence submission exposes an optional real event-to-vault linkage boundary', () => {
  const route = fs.readFileSync(path.join(ROOT, 'services/api/src/routes/evidence.js'), 'utf8');
  assert.match(route, /linkOperationalEventToEvidence/);
  assert.match(route, /EVIDENCE_EVENT_LINK_REQUIRES_BOTH_IDS/);
  assert.match(route, /tenantId: ticket\.rows\[0\]\.tenant_id/);
  assert.match(route, /eventIntegritySha256/);
  assert.match(route, /evidenceContentSha256/);
});

test('link helper is idempotent and requires canonical event metadata', async () => {
  const { linkOperationalEventToEvidence } = require(path.join(ROOT, 'packages/operational-context/src/evidenceLink.js'));
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('select event_id,tenant_id')) {
        return { rows: [{ event_id: params[0], tenant_id: params[1], canonical_event_version: 'fiberos.operational-event.v1', correlation_id: 'cc:test', integrity_sha256: 'a'.repeat(64) }] };
      }
      if (sql.includes('select id,tenant_id,content_sha256,storage_status')) {
        return { rows: [{ id: params[0], tenant_id: params[1], content_sha256: 'b'.repeat(64), storage_status: 'STORAGE_UNVERIFIED' }] };
      }
      if (sql.includes('insert into operational_event_evidence_links')) {
        return { rows: [{ id: 'link-1', tenant_id: params[0], event_id: params[1], evidence_vault_id: params[2], link_role: params[3], created_by: params[4], created_at: '2026-10-08T00:00:00.000Z' }] };
      }
      throw new Error('UNEXPECTED_QUERY');
    }
  };
  const result = await linkOperationalEventToEvidence(client, {
    tenantId: 'tenant-1',
    eventId: 'event-1',
    evidenceVaultId: 'evidence-1',
    actorId: 'actor-1'
  });
  assert.equal(result.replayed, false);
  assert.equal(result.link.event_id, 'event-1');
  assert.equal(calls.length, 3);
});

test('evidence linker treats exact replay as idempotent and rejects an absent vault object', async () => {
  const { linkOperationalEventToEvidence } = require(path.join(ROOT, 'packages/operational-context/src/evidenceLink.js'));
  const replayClient = {
    async query(sql, params) {
      if (sql.includes('select event_id,tenant_id')) return { rows: [{ event_id: params[0], tenant_id: params[1], canonical_event_version: 'fiberos.operational-event.v1', correlation_id: 'cc:test', integrity_sha256: 'a'.repeat(64) }] };
      if (sql.includes('select id,tenant_id,content_sha256,storage_status')) return { rows: [{ id: params[0], tenant_id: params[1], content_sha256: 'b'.repeat(64), storage_status: 'STORAGE_UNVERIFIED' }] };
      if (sql.includes('insert into operational_event_evidence_links')) return { rows: [] };
      if (sql.includes('select id,tenant_id,event_id,evidence_vault_id,link_role')) return { rows: [{ id: 'link-existing', tenant_id: params[0], event_id: params[1], evidence_vault_id: params[2], link_role: params[3], created_by: null, created_at: '2026-10-08T00:00:00.000Z' }] };
      throw new Error('UNEXPECTED_QUERY');
    }
  };
  const replay = await linkOperationalEventToEvidence(replayClient, { tenantId: 'tenant-1', eventId: 'event-1', evidenceVaultId: 'evidence-1' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.link.id, 'link-existing');

  const missingEvidenceClient = {
    async query(sql, params) {
      if (sql.includes('select event_id,tenant_id')) return { rows: [{ event_id: params[0], tenant_id: params[1], canonical_event_version: 'fiberos.operational-event.v1', correlation_id: 'cc:test', integrity_sha256: 'a'.repeat(64) }] };
      if (sql.includes('select id,tenant_id,content_sha256,storage_status')) return { rows: [] };
      throw new Error('UNEXPECTED_QUERY');
    }
  };
  await assert.rejects(
    () => linkOperationalEventToEvidence(missingEvidenceClient, { tenantId: 'tenant-1', eventId: 'event-1', evidenceVaultId: 'missing-evidence' }),
    e => e && e.code === 'EVIDENCE_VAULT_OBJECT_NOT_FOUND'
  );
});
