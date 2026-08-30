-- NorzAgapay Complete Database Schema Migration
-- Run this in Supabase SQL Editor

-- ============================================
-- IDEMPOTENT TYPE CREATION (001_create_tables.sql)
-- ============================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'commander', 'volunteer_specialist', 'volunteer_general', 'professional_unit');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unit_type') THEN
        CREATE TYPE unit_type AS ENUM ('police', 'fire', 'medical');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
        CREATE TYPE user_status AS ENUM ('active', 'inactive', 'pending_verification', 'occupied');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_type') THEN
        CREATE TYPE incident_type AS ENUM ('flash_flood', 'fire', 'earthquake', 'medical_emergency', 'typhoon', 'other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'severity_level') THEN
        CREATE TYPE severity_level AS ENUM ('low', 'moderate', 'high', 'critical');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_status') THEN
        CREATE TYPE incident_status AS ENUM ('open', 'in_progress', 'resolved');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_type') THEN
        CREATE TYPE task_type AS ENUM ('specialist', 'general_labor');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
        CREATE TYPE task_status AS ENUM ('pending', 'accepted', 'in_progress', 'completed', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipment_status') THEN
        CREATE TYPE shipment_status AS ENUM ('loading', 'in_transit', 'delivered');
    END IF;
END $$;

-- ============================================
-- TABLES (001_create_tables.sql)
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone VARCHAR(15),
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'volunteer_general',
  unit_type unit_type,
  status user_status NOT NULL DEFAULT 'active',
  verified BOOLEAN NOT NULL DEFAULT false,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Certifications table
CREATE TABLE IF NOT EXISTS certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cert_type TEXT NOT NULL,
  cert_number TEXT,
  file_url TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Incidents table
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type incident_type NOT NULL,
  severity severity_level NOT NULL DEFAULT 'moderate',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  address TEXT,
  status incident_status NOT NULL DEFAULT 'open',
  reported_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  task_type task_type NOT NULL DEFAULT 'general_labor',
  required_skill TEXT,
  assigned_to UUID REFERENCES users(id),
  status task_status NOT NULL DEFAULT 'pending',
  proof_photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Task Volunteers junction table (for open tasks)
CREATE TABLE IF NOT EXISTS task_volunteers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  volunteer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'joined', -- 'joined', 'left', 'completed'
  UNIQUE(task_id, volunteer_id)
);

-- Inventory table
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'packs',
  location TEXT,
  incident_id UUID REFERENCES incidents(id),
  donated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relief Shipments table
CREATE TABLE IF NOT EXISTS relief_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES inventory(id),
  quantity_sent INTEGER NOT NULL,
  driver_user_id UUID REFERENCES users(id),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  qr_code TEXT UNIQUE NOT NULL,
  status shipment_status NOT NULL DEFAULT 'loading',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

-- Blocked Routes table
CREATE TABLE IF NOT EXISTS blocked_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_by UUID REFERENCES users(id),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resource Requests table
CREATE TABLE IF NOT EXISTS resource_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL, -- 'volunteers' or 'goods'
  sub_type TEXT,
  details TEXT NOT NULL,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'fulfilled'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- INDEXES (001_create_tables.sql)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_location ON users(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE INDEX IF NOT EXISTS idx_certifications_user_id ON certifications(user_id);
CREATE INDEX IF NOT EXISTS idx_certifications_verified ON certifications(verified);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(type);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents(latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_tasks_incident_id ON tasks(incident_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE INDEX IF NOT EXISTS idx_inventory_incident_id ON inventory(incident_id);
CREATE INDEX IF NOT EXISTS idx_relief_shipments_status ON relief_shipments(status);
CREATE INDEX IF NOT EXISTS idx_blocked_routes_active ON blocked_routes(active);

CREATE INDEX IF NOT EXISTS idx_resource_requests_status ON resource_requests(status);
CREATE INDEX IF NOT EXISTS idx_resource_requests_requested_by ON resource_requests(requested_by);

-- ============================================
-- ROW LEVEL SECURITY (RLS) (001_create_tables.sql)
-- ============================================

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'users' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'resource_requests' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE resource_requests ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'certifications' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'incidents' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'tasks' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'inventory' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'relief_shipments' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE relief_shipments ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'blocked_routes' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE blocked_routes ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- Basic RLS policies (service role bypasses these)
DO $$ BEGIN
    -- Users Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own profile') THEN
        CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (auth.uid() = id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins view all users') THEN
        CREATE POLICY "Admins view all users" ON users FOR SELECT USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;

    -- Incidents Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users view incidents') THEN
        CREATE POLICY "Authenticated users view incidents" ON incidents FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins create incidents') THEN
        CREATE POLICY "Admins create incidents" ON incidents FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;

    -- Tasks Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'View own tasks') THEN
        CREATE POLICY "View own tasks" ON tasks FOR SELECT USING (assigned_to = auth.uid() OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;

    -- Resource Requests policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own requests') THEN
        CREATE POLICY "Users can view own requests" ON resource_requests FOR SELECT USING (requested_by = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins view all requests') THEN
        CREATE POLICY "Admins view all requests" ON resource_requests FOR SELECT USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authorized users can create requests') THEN
        CREATE POLICY "Authorized users can create requests" ON resource_requests FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander', 'professional_unit')));
    END IF;
END $$;

-- ============================================
-- REALTIME SUBSCRIPTIONS (001_create_tables.sql)
-- ============================================

-- Note: Realtime setup usually requires manual intervention or specific extensions in Supabase
-- but we ensure the tables are added to the publication if possible.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE incidents;
        ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
        ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
        ALTER PUBLICATION supabase_realtime ADD TABLE relief_shipments;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL; -- Skip if already added or publication doesn't exist
END $$;

-- ============================================
-- FUNCTIONS (001_create_tables.sql)
-- ============================================

-- Function to update inventory timestamp on change
CREATE OR REPLACE FUNCTION update_inventory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for inventory
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_updated_at') THEN
        CREATE TRIGGER inventory_updated_at
          BEFORE UPDATE ON inventory
          FOR EACH ROW
          EXECUTE FUNCTION update_inventory_timestamp();
    END IF;
END $$;

-- ============================================
-- STORAGE BUCKETS (001_create_tables.sql)
-- ============================================

-- Create a storage bucket for files (if not exists)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('norzagapay-files', 'norzagapay-files', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for the bucket
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Read Access' AND tablename = 'objects') THEN
        CREATE POLICY "Public Read Access" ON storage.objects FOR SELECT USING ( bucket_id = 'norzagapay-files' );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated Upload Access' AND tablename = 'objects') THEN
        CREATE POLICY "Authenticated Upload Access" ON storage.objects FOR INSERT WITH CHECK ( bucket_id = 'norzagapay-files' AND auth.role() = 'authenticated' );
    END IF;
END $$;

-- ============================================
-- 002_add_new_features.sql
-- ============================================

-- Officers table
CREATE TABLE IF NOT EXISTS officers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  specialization TEXT NOT NULL,
  rank TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Respond Units table (Teams of officers)
CREATE TABLE IF NOT EXISTS respond_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_name TEXT NOT NULL,
  specialization TEXT NOT NULL,
  officer_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Volunteer Dispatches table
CREATE TABLE IF NOT EXISTS volunteer_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  dispatch_date DATE NOT NULL,
  dispatch_time TIME NOT NULL,
  meetup_location TEXT NOT NULL,
  destination TEXT NOT NULL,
  mission_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  volunteer_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'officers' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE officers ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'respond_units' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE respond_units ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'volunteer_dispatches' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE volunteer_dispatches ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- RLS Policies
DO $$ BEGIN
    -- Officers Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view officers') THEN
        CREATE POLICY "Authenticated users can view officers" ON officers FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage officers') THEN
        CREATE POLICY "Admins can manage officers" ON officers FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;

    -- Respond Units Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view respond units') THEN
        CREATE POLICY "Authenticated users can view respond units" ON respond_units FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage respond units') THEN
        CREATE POLICY "Admins can manage respond units" ON respond_units FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;

    -- Volunteer Dispatches Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view dispatches') THEN
        CREATE POLICY "Authenticated users can view dispatches" ON volunteer_dispatches FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage dispatches') THEN
        CREATE POLICY "Admins can manage dispatches" ON volunteer_dispatches FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
END $$;

-- ============================================
-- 003_add_storages.sql
-- ============================================

-- Storages table
CREATE TABLE IF NOT EXISTS storages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  capacity TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'storages' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE storages ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- RLS Policies
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view storages') THEN
        CREATE POLICY "Authenticated users can view storages" ON storages FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage storages') THEN
        CREATE POLICY "Admins can manage storages" ON storages FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
END $$;

-- ============================================
-- 004_add_storage_coords.sql
-- ============================================

ALTER TABLE storages 
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- ============================================
-- 005_add_task_coords.sql
-- ============================================

ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS address TEXT;

-- ============================================
-- 005_create_incident_reports.sql
-- ============================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
        CREATE TYPE report_status AS ENUM ('pending', 'verified', 'rejected');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS incident_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'emergency' or 'community'
  title TEXT NOT NULL, -- Category
  specifics TEXT,
  description TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  proof_url TEXT,
  proof_type TEXT NOT NULL DEFAULT 'image',
  reporter_type TEXT NOT NULL DEFAULT 'resident', -- 'resident' or 'volunteer'
  reporter_id UUID REFERENCES users(id),
  reporter_name TEXT,
  reporter_phone TEXT,
  reporter_photo_url TEXT,
  address TEXT,
  status report_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'incident_reports' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- RLS Policies
DO $$ BEGIN
    -- Everyone can create reports (including anonymous residents via service role or public policy)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public can create reports') THEN
        CREATE POLICY "Public can create reports" ON incident_reports FOR INSERT WITH CHECK (true);
    END IF;

    -- Authenticated users (volunteers/staff) can view their own reports
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own incident reports') THEN
        CREATE POLICY "Users can view own incident reports" ON incident_reports FOR SELECT USING (reporter_id = auth.uid());
    END IF;

    -- Admins and Commanders can view and manage all reports
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins manage incident reports') THEN
        CREATE POLICY "Admins manage incident reports" ON incident_reports FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
END $$;

-- Add to Realtime publication
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE incident_reports;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ============================================
-- 006_update_enums.sql
-- ============================================

-- Add new values to unit_type enum
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Rescue Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Swift Water Rescue Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Mountain Rescue Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Emergency Medical Responder (EMR)';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Ambulance Officer / EMS Personnel';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Fire Response Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Evacuation Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Safety & Security Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Traffic & Road Clearing Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Communications Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Logistics Response Officer';
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'Damage Assessment Officer';

-- Add rejected to user_status enum
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'rejected';

-- ============================================
-- 007_add_weather_tables.sql
-- ============================================

-- Create weather data types
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_level') THEN
        CREATE TYPE alert_level AS ENUM ('normal', 'warning', 'critical');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_type') THEN
        CREATE TYPE alert_type AS ENUM ('weather', 'flood', 'earthquake', 'dam');
    END IF;
END $$;

-- Weather data table (stores current and historical weather)
CREATE TABLE IF NOT EXISTS weather_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name TEXT NOT NULL DEFAULT 'Norzagaray',
  latitude DOUBLE PRECISION NOT NULL DEFAULT 14.9042,
  longitude DOUBLE PRECISION NOT NULL DEFAULT 121.0430,
  temperature DOUBLE PRECISION,
  humidity DOUBLE PRECISION,
  wind_speed DOUBLE PRECISION,
  wind_direction DOUBLE PRECISION,
  rainfall DOUBLE PRECISION,
  weather_condition TEXT,
  pressure DOUBLE PRECISION,
  visibility DOUBLE PRECISION,
  uv_index DOUBLE PRECISION,
  data_source TEXT NOT NULL DEFAULT 'open-meteo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Weather alerts/advisories table
CREATE TABLE IF NOT EXISTS weather_advisories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type alert_type NOT NULL,
  level alert_level NOT NULL DEFAULT 'normal',
  message TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  external_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hazard zones table (for flood, landslide, etc.)
CREATE TABLE IF NOT EXISTS hazard_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'flood', 'landslide', 'storm_surge'
  severity alert_level NOT NULL,
  geometry JSONB, -- GeoJSON geometry (for mapping)
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS for new tables
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'weather_data' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE weather_data ENABLE ROW LEVEL SECURITY;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'weather_advisories' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE weather_advisories ENABLE ROW LEVEL SECURITY;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'hazard_zones' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE hazard_zones ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- RLS Policies for weather tables
DO $$ BEGIN
    -- Weather Data
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view weather data') THEN
        CREATE POLICY "Authenticated users can view weather data" ON weather_data FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    -- Weather Advisories
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view advisories') THEN
        CREATE POLICY "Authenticated users can view advisories" ON weather_advisories FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage advisories') THEN
        CREATE POLICY "Admins can manage advisories" ON weather_advisories FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
    -- Hazard Zones
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view hazard zones') THEN
        CREATE POLICY "Authenticated users can view hazard zones" ON hazard_zones FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage hazard zones') THEN
        CREATE POLICY "Admins can manage hazard zones" ON hazard_zones FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
END $$;

-- Add weather tables to realtime publication
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE weather_advisories;
        ALTER PUBLICATION supabase_realtime ADD TABLE weather_data;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Indexes for weather tables
CREATE INDEX IF NOT EXISTS idx_weather_data_created_at ON weather_data(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weather_advisories_active ON weather_advisories(active);
CREATE INDEX IF NOT EXISTS idx_hazard_zones_active ON hazard_zones(active);

-- ============================================
-- 008_add_earthquake_river_tables.sql
-- ============================================

-- Earthquakes table (PHIVOLCS data)
CREATE TABLE IF NOT EXISTS earthquakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phivolcs_id TEXT, -- Unique ID from PHIVOLCS
  magnitude DOUBLE PRECISION NOT NULL,
  depth DOUBLE PRECISION, -- in km
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location TEXT NOT NULL,
  intensity TEXT, -- PEIS intensity (I to X)
  occurred_at TIMESTAMPTZ NOT NULL,
  felt BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'phivolcs',
  external_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- River level monitoring stations (PAGASA Hydromet)
CREATE TABLE IF NOT EXISTS river_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_name TEXT NOT NULL,
  station_code TEXT NOT NULL,
  river_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  warning_level DOUBLE PRECISION NOT NULL, -- in meters
  critical_level DOUBLE PRECISION NOT NULL, -- in meters
  status alert_level NOT NULL DEFAULT 'normal',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- River level readings
CREATE TABLE IF NOT EXISTS river_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES river_stations(id) ON DELETE CASCADE,
  water_level DOUBLE PRECISION NOT NULL, -- in meters
  trend TEXT, -- 'rising', 'falling', 'steady'
  level alert_level NOT NULL DEFAULT 'normal',
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default river stations for Norzagaray
INSERT INTO river_stations (
  station_name, 
  station_code, 
  river_name, 
  latitude, 
  longitude, 
  warning_level, 
  critical_level
) VALUES (
  'Angat River - Norzagaray', 
  'ANG-NOR', 
  'Angat River', 
  14.9123, 
  121.0456, 
  19.0, 
  19.5
), (
  'Ipo Dam Tailwater', 
  'IPO-TW', 
  'Angat River', 
  14.9087, 
  121.0521, 
  18.5, 
  19.0
), (
  'Bustos Dam Tailwater', 
  'BST-TW', 
  'Angat River', 
  14.8954, 
  121.0389, 
  17.5, 
  18.0
) ON CONFLICT DO NOTHING;

-- Enable RLS
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'earthquakes' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE earthquakes ENABLE ROW LEVEL SECURITY;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'river_stations' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE river_stations ENABLE ROW LEVEL SECURITY;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'river_levels' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE river_levels ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- RLS Policies
DO $$ BEGIN
    -- Earthquakes
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view earthquakes') THEN
        CREATE POLICY "Authenticated users can view earthquakes" ON earthquakes FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage earthquakes') THEN
        CREATE POLICY "Admins can manage earthquakes" ON earthquakes FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
    -- River Stations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view river stations') THEN
        CREATE POLICY "Authenticated users can view river stations" ON river_stations FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage river stations') THEN
        CREATE POLICY "Admins can manage river stations" ON river_stations FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
    -- River Levels
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view river levels') THEN
        CREATE POLICY "Authenticated users can view river levels" ON river_levels FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage river levels') THEN
        CREATE POLICY "Admins can manage river levels" ON river_levels FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
END $$;

-- Add new tables to realtime publication
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE earthquakes;
        ALTER PUBLICATION supabase_realtime ADD TABLE river_levels;
        ALTER PUBLICATION supabase_realtime ADD TABLE river_stations;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ============================================
-- 009_add_dam_tables.sql
-- ============================================

-- Dam monitoring stations
CREATE TABLE IF NOT EXISTS dam_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dam_name TEXT NOT NULL,
  dam_code TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  warning_level DOUBLE PRECISION NOT NULL, -- in meters (reservoir level
  critical_level DOUBLE PRECISION NOT NULL, -- in meters
  normal_water_level DOUBLE PRECISION NOT NULL, -- normal operating level
  status alert_level NOT NULL DEFAULT 'normal',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dam level readings
CREATE TABLE IF NOT EXISTS dam_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dam_id UUID NOT NULL REFERENCES dam_stations(id) ON DELETE CASCADE,
  water_level DOUBLE PRECISION NOT NULL, -- current reservoir level in meters
  discharge_rate DOUBLE PRECISION, -- water release rate in cubic meters per second
  trend TEXT, -- 'rising', 'falling', 'steady'
  level alert_level NOT NULL DEFAULT 'normal',
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default dam stations for Angat and Ipo
INSERT INTO dam_stations (
  dam_name,
  dam_code,
  latitude,
  longitude,
  warning_level,
  critical_level,
  normal_water_level
) VALUES (
  'Angat Dam',
  'ANGAT',
  14.9123,
  121.0567,
  212.0,
  217.0,
  210.0
), (
  'Ipo Dam',
  'IPO',
  14.9234,
  121.0678,
  100.0,
  101.0,
  99.0
) ON CONFLICT DO NOTHING;

-- Enable RLS
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'dam_stations' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE dam_stations ENABLE ROW LEVEL SECURITY;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'dam_levels' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE dam_levels ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- RLS Policies
DO $$ BEGIN
    -- Dam Stations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view dam stations') THEN
        CREATE POLICY "Authenticated users can view dam stations" ON dam_stations FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage dam stations') THEN
        CREATE POLICY "Admins can manage dam stations" ON dam_stations FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
    -- Dam Levels
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view dam levels') THEN
        CREATE POLICY "Authenticated users can view dam levels" ON dam_levels FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage dam levels') THEN
        CREATE POLICY "Admins can manage dam levels" ON dam_levels FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
END $$;

-- Add new tables to realtime publication
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE dam_stations;
        ALTER PUBLICATION supabase_realtime ADD TABLE dam_levels;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_earthquakes_occurred_at ON earthquakes(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_river_levels_station_id ON river_levels(station_id);
CREATE INDEX IF NOT EXISTS idx_river_levels_recorded_at ON river_levels(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_dam_levels_dam_id ON dam_levels(dam_id);
CREATE INDEX IF NOT EXISTS idx_dam_levels_recorded_at ON dam_levels(recorded_at DESC);

-- ============================================
-- 010_add_early_warning_subsystem.sql
-- ============================================

-- Add new enum types
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_status') THEN
        CREATE TYPE alert_status AS ENUM ('active', 'acknowledged', 'resolved');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level') THEN
        CREATE TYPE risk_level AS ENUM ('low', 'moderate', 'high', 'critical');
    END IF;
END $$;

-- Alerts table (generated by the subsystem)
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL, -- weather, earthquake, flood, landslide, typhoon
    severity risk_level NOT NULL,
    affected_area TEXT,
    data_source TEXT NOT NULL,
    status alert_status NOT NULL DEFAULT 'active',
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Activity feed items for dashboard
CREATE TABLE IF NOT EXISTS activity_feed (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL, -- weather_update, advisory, earthquake, alert, etc.
    title TEXT NOT NULL,
    description TEXT,
    severity risk_level,
    data_source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Barangays table with hazard info
CREATE TABLE IF NOT EXISTS barangays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    flood_risk risk_level,
    landslide_risk risk_level,
    geometry JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evacuation centers
CREATE TABLE IF NOT EXISTS evacuation_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    capacity INTEGER,
    current_occupancy INTEGER DEFAULT 0,
    barangay_id UUID REFERENCES barangays(id),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hospitals & medical facilities
CREATE TABLE IF NOT EXISTS hospitals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    contact TEXT,
    barangay_id UUID REFERENCES barangays(id),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schools (can be used as evacuation centers)
CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    barangay_id UUID REFERENCES barangays(id),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Weather forecast (hourly & daily)
CREATE TABLE IF NOT EXISTS weather_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forecast_type TEXT NOT NULL, -- hourly, daily
    forecast_time TIMESTAMPTZ NOT NULL,
    temperature DOUBLE PRECISION,
    humidity DOUBLE PRECISION,
    wind_speed DOUBLE PRECISION,
    wind_direction DOUBLE PRECISION,
    rainfall_probability DOUBLE PRECISION,
    weather_condition TEXT,
    data_source TEXT NOT NULL DEFAULT 'open-meteo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Municipality info
CREATE TABLE IF NOT EXISTS municipality_info (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT 'Norzagaray',
    latitude DOUBLE PRECISION NOT NULL DEFAULT 14.9042,
    longitude DOUBLE PRECISION NOT NULL DEFAULT 121.0430,
    current_risk risk_level NOT NULL DEFAULT 'low',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default municipality info
INSERT INTO municipality_info (name) 
VALUES ('Norzagaray')
ON CONFLICT DO NOTHING;

-- Insert default barangays
INSERT INTO barangays (name, latitude, longitude, flood_risk, landslide_risk)
VALUES
    ('Poblacion', 14.9050, 121.0430, 'moderate', 'low'),
    ('Baraka', 14.9200, 121.0500, 'high', 'moderate'),
    ('Bigte', 14.9100, 121.0600, 'moderate', 'low'),
    ('Camachile', 14.8950, 121.0350, 'high', 'high'),
    ('Halang', 14.9150, 121.0300, 'moderate', 'low')
ON CONFLICT DO NOTHING;

-- Enable RLS for all new tables
DO $$ BEGIN
    -- Alerts
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'alerts' AND rowsecurity = true) THEN
        ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
    END IF;
    -- Activity Feed
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activity_feed' AND rowsecurity = true) THEN
        ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;
    END IF;
    -- Barangays
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'barangays' AND rowsecurity = true) THEN
        ALTER TABLE barangays ENABLE ROW LEVEL SECURITY;
    END IF;
    -- Evacuation Centers
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'evacuation_centers' AND rowsecurity = true) THEN
        ALTER TABLE evacuation_centers ENABLE ROW LEVEL SECURITY;
    END IF;
    -- Hospitals
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'hospitals' AND rowsecurity = true) THEN
        ALTER TABLE hospitals ENABLE ROW LEVEL SECURITY;
    END IF;
    -- Schools
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schools' AND rowsecurity = true) THEN
        ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
    END IF;
    -- Weather Forecasts
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'weather_forecasts' AND rowsecurity = true) THEN
        ALTER TABLE weather_forecasts ENABLE ROW LEVEL SECURITY;
    END IF;
    -- Municipality Info
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'municipality_info' AND rowsecurity = true) THEN
        ALTER TABLE municipality_info ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- RLS Policies
DO $$ BEGIN
    -- Alerts
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view alerts') THEN
        CREATE POLICY "Authenticated users can view alerts" ON alerts FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage alerts') THEN
        CREATE POLICY "Admins can manage alerts" ON alerts FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'commander')));
    END IF;
    
    -- Activity Feed
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view activity feed') THEN
        CREATE POLICY "Authenticated users can view activity feed" ON activity_feed FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- Barangays
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view barangays') THEN
        CREATE POLICY "Authenticated users can view barangays" ON barangays FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- Evacuation Centers
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view evacuation centers') THEN
        CREATE POLICY "Authenticated users can view evacuation centers" ON evacuation_centers FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- Hospitals
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view hospitals') THEN
        CREATE POLICY "Authenticated users can view hospitals" ON hospitals FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- Schools
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view schools') THEN
        CREATE POLICY "Authenticated users can view schools" ON schools FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- Weather Forecasts
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view weather forecasts') THEN
        CREATE POLICY "Authenticated users can view weather forecasts" ON weather_forecasts FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- Municipality Info
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view municipality info') THEN
        CREATE POLICY "Authenticated users can view municipality info" ON municipality_info FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
END $$;

-- Add to realtime publication
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
        ALTER PUBLICATION supabase_realtime ADD TABLE activity_feed;
        ALTER PUBLICATION supabase_realtime ADD TABLE weather_forecasts;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_feed_created_at ON activity_feed(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weather_forecasts_forecast_type ON weather_forecasts(forecast_type);
CREATE INDEX IF NOT EXISTS idx_weather_forecasts_forecast_time ON weather_forecasts(forecast_time DESC);

