-- Shared, optional Norzagaray boundary configuration.
-- When no boundary is enabled, client maps remain unrestricted.

CREATE TABLE IF NOT EXISTS municipality_boundary_config (
  municipality_key TEXT PRIMARY KEY,
  geometry JSONB,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO municipality_boundary_config (municipality_key, geometry, is_enabled, revision)
VALUES ('norzagaray', NULL, false, 0)
ON CONFLICT (municipality_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS municipality_boundary_history (
  municipality_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  geometry JSONB NOT NULL,
  is_enabled BOOLEAN NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (municipality_key, revision)
);
