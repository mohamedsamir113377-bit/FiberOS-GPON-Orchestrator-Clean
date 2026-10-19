-- Optional organizational units (from global track). Safe additive.
CREATE TABLE IF NOT EXISTS org_units (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES org_units(id),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  unit_level    INT NOT NULL CHECK (unit_level >= 0),
  org_tenant_id TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);
