'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

test('migration 115 fail-closes nullable technician activity before enforcing NOT NULL', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'sql/migrations/115_enforce_technician_active_not_null.sql'), 'utf8');
  assert.match(migration, /UPDATE public\.technicians[\s\S]*SET is_active = false[\s\S]*WHERE is_active IS NULL/i);
  assert.match(migration, /ALTER COLUMN is_active SET DEFAULT true[\s\S]*ALTER COLUMN is_active SET NOT NULL/i);
  assert.match(migration, /LOCK TABLE public\.technicians IN SHARE ROW EXCLUSIVE MODE/i);
});
