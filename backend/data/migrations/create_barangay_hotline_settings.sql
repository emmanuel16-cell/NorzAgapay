-- Shared, dispatcher-managed hotline entries for resident and barangay apps.
CREATE TABLE IF NOT EXISTS barangay_hotline_settings (
  barangay_id UUID PRIMARY KEY REFERENCES barangays(id) ON DELETE CASCADE,
  hotlines JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES barangay_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT barangay_hotline_settings_array_check CHECK (jsonb_typeof(hotlines) = 'array')
);

ALTER TABLE barangay_hotline_settings ENABLE ROW LEVEL SECURITY;
