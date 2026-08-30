-- ============================================
-- NorzAgapay Evacuation & Barangay Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. BARANGAYS TABLE (Safe & Idempotent)
-- ============================================

CREATE TABLE IF NOT EXISTS barangays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  municipality TEXT NOT NULL DEFAULT 'Norzagaray',
  province TEXT NOT NULL DEFAULT 'Bulacan',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all columns exist
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS municipality TEXT NOT NULL DEFAULT 'Norzagaray';
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS province TEXT NOT NULL DEFAULT 'Bulacan';
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Seed Norzagaray barangays (safely inserts only if not already present)
INSERT INTO barangays (name, municipality, province, latitude, longitude)
SELECT v.name, v.municipality, v.province, v.latitude, v.longitude
FROM (VALUES
  ('Bigte', 'Norzagaray', 'Bulacan', 14.9196, 121.0480),
  ('Bintog', 'Norzagaray', 'Bulacan', 14.9080, 121.0361),
  ('Bulac', 'Norzagaray', 'Bulacan', 14.9312, 121.0523),
  ('Cacarong Bata', 'Norzagaray', 'Bulacan', 14.9150, 121.0400),
  ('Cacarong Matanda', 'Norzagaray', 'Bulacan', 14.9100, 121.0350),
  ('Ca-impugan', 'Norzagaray', 'Bulacan', 14.9250, 121.0550),
  ('Kaybuklod', 'Norzagaray', 'Bulacan', 14.9200, 121.0450),
  ('Liciada', 'Norzagaray', 'Bulacan', 14.9050, 121.0300),
  ('Mabalon', 'Norzagaray', 'Bulacan', 14.9350, 121.0600),
  ('Matictic', 'Norzagaray', 'Bulacan', 14.8960, 121.0600),
  ('Minuyan', 'Norzagaray', 'Bulacan', 14.9000, 121.0250),
  ('Norzagaray (Poblacion)', 'Norzagaray', 'Bulacan', 14.9133, 121.0436),
  ('Partida', 'Norzagaray', 'Bulacan', 14.9300, 121.0500),
  ('Pinagtulayan', 'Norzagaray', 'Bulacan', 14.9400, 121.0650),
  ('San Matteo', 'Norzagaray', 'Bulacan', 14.9450, 121.0700),
  ('Tigbe', 'Norzagaray', 'Bulacan', 14.9500, 121.0750)
) AS v(name, municipality, province, latitude, longitude)
WHERE NOT EXISTS (
  SELECT 1 FROM barangays b WHERE b.name = v.name AND b.municipality = v.municipality
);

-- ============================================
-- 2. BARANGAY USERS TABLE
-- ============================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'barangay_role') THEN
        CREATE TYPE barangay_role AS ENUM ('captain', 'team_leader', 'volunteer');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS barangay_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID REFERENCES barangays(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE NOT NULL DEFAULT '',
  phone VARCHAR(15),
  password_hash TEXT NOT NULL DEFAULT '',
  role barangay_role NOT NULL DEFAULT 'volunteer',
  added_by UUID REFERENCES barangay_users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all columns exist
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS barangay_id UUID REFERENCES barangays(id) ON DELETE CASCADE;
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS phone VARCHAR(15);
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS role barangay_role NOT NULL DEFAULT 'volunteer';
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES barangay_users(id) ON DELETE SET NULL;
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_barangay_users_barangay_id ON barangay_users(barangay_id);
CREATE INDEX IF NOT EXISTS idx_barangay_users_email ON barangay_users(email);
CREATE INDEX IF NOT EXISTS idx_barangay_users_role ON barangay_users(role);

-- ============================================
-- 3. EVACUATION CENTERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS evacuation_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID REFERENCES barangays(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL DEFAULT 14.9133,
  longitude DOUBLE PRECISION NOT NULL DEFAULT 121.0436,
  max_capacity INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES barangay_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all columns exist
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS barangay_id UUID REFERENCES barangays(id) ON DELETE CASCADE;
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION NOT NULL DEFAULT 14.9133;
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION NOT NULL DEFAULT 121.0436;
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS max_capacity INTEGER NOT NULL DEFAULT 100;
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES barangay_users(id) ON DELETE SET NULL;
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE evacuation_centers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_evacuation_centers_barangay_id ON evacuation_centers(barangay_id);
CREATE INDEX IF NOT EXISTS idx_evacuation_centers_active ON evacuation_centers(is_active);
CREATE INDEX IF NOT EXISTS idx_evacuation_centers_location ON evacuation_centers(latitude, longitude);

-- ============================================
-- 4. EVACUEE REGISTRATIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS evacuee_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evac_center_id UUID REFERENCES evacuation_centers(id) ON DELETE CASCADE,
  contact_number VARCHAR(15) NOT NULL DEFAULT '',
  person_count INTEGER NOT NULL DEFAULT 1,
  has_infants BOOLEAN NOT NULL DEFAULT false,
  has_elderly BOOLEAN NOT NULL DEFAULT false,
  has_pwd BOOLEAN NOT NULL DEFAULT false,
  has_pregnant BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all columns exist
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS evac_center_id UUID REFERENCES evacuation_centers(id) ON DELETE CASCADE;
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS contact_number VARCHAR(15) NOT NULL DEFAULT '';
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS person_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS has_infants BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS has_elderly BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS has_pwd BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS has_pregnant BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE evacuee_registrations ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_evacuee_registrations_evac_center_id ON evacuee_registrations(evac_center_id);
CREATE INDEX IF NOT EXISTS idx_evacuee_registrations_contact ON evacuee_registrations(contact_number);

-- ============================================
-- 5. UPDATE INCIDENT_REPORTS TABLE
-- Add barangay_id and workflow response columns
-- ============================================

ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS barangay_id UUID REFERENCES barangays(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS barangay_response_status TEXT DEFAULT 'pending', -- pending | responding | resolved
  ADD COLUMN IF NOT EXISTS barangay_response_notes TEXT,
  ADD COLUMN IF NOT EXISTS barangay_responded_by UUID REFERENCES barangay_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS barangay_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_coordination_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_incident_reports_barangay_id ON incident_reports(barangay_id);

-- ============================================
-- 6. UPDATED_AT TRIGGER for evacuation_centers
-- ============================================

CREATE OR REPLACE FUNCTION update_evac_center_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'evac_center_updated_at') THEN
        CREATE TRIGGER evac_center_updated_at
            BEFORE UPDATE ON evacuation_centers
            FOR EACH ROW EXECUTE FUNCTION update_evac_center_timestamp();
    END IF;
END $$;

-- ============================================
-- 7. RLS POLICIES
-- ============================================

ALTER TABLE barangays ENABLE ROW LEVEL SECURITY;
ALTER TABLE barangay_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE evacuation_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE evacuee_registrations ENABLE ROW LEVEL SECURITY;

-- Public read / write policies
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view barangays') THEN
        CREATE POLICY "Anyone can view barangays" ON barangays FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view active evac centers') THEN
        CREATE POLICY "Anyone can view active evac centers" ON evacuation_centers FOR SELECT USING (is_active = true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can register as evacuee') THEN
        CREATE POLICY "Anyone can register as evacuee" ON evacuee_registrations FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view registrations') THEN
        CREATE POLICY "Anyone can view registrations" ON evacuee_registrations FOR SELECT USING (true);
    END IF;
END $$;
