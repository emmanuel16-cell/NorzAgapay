-- NorzAgapay consolidated Supabase schema for a fresh installation.
-- Derived from the historical database scripts, with final enum definitions
-- and the current responder push schema applied in dependency order.
-- Requires Supabase auth/storage schemas, roles, and the supabase_realtime publication.
-- Existing installations with legacy user-role data need a separate data upgrade.

-- ===== Source section: database/migrations/migration.sql =====
-- NorzAgapay Complete Database Schema Migration
-- Run this in Supabase SQL Editor

-- ============================================
-- IDEMPOTENT TYPE CREATION (001_create_tables.sql)
-- ============================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('master_admin', 'admin', 'logistics', 'dispatcher', 'responder');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unit_type') THEN
        CREATE TYPE unit_type AS ENUM (
            'police', 'fire', 'medical',
            'Rescue Officer', 'Swift Water Rescue Officer', 'Mountain Rescue Officer',
            'Emergency Medical Responder (EMR)', 'Ambulance Officer / EMS Personnel',
            'Fire Response Officer', 'Evacuation Officer', 'Safety & Security Officer',
            'Traffic & Road Clearing Officer', 'Communications Officer',
            'Logistics Response Officer', 'Damage Assessment Officer'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
        CREATE TYPE user_status AS ENUM ('active', 'inactive', 'pending_verification', 'occupied', 'rejected');
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
        CREATE TYPE task_status AS ENUM ('pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'returning');
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
  role user_role NOT NULL DEFAULT 'responder',
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
  request_type TEXT NOT NULL, -- 'responders' or 'goods'
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
        CREATE POLICY "Admins view all users" ON users FOR SELECT USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;

    -- Incidents Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users view incidents') THEN
        CREATE POLICY "Authenticated users view incidents" ON incidents FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins create incidents') THEN
        CREATE POLICY "Admins create incidents" ON incidents FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;

    -- Tasks Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'View own tasks') THEN
        CREATE POLICY "View own tasks" ON tasks FOR SELECT USING (assigned_to = auth.uid() OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;

    -- Resource Requests policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own requests') THEN
        CREATE POLICY "Users can view own requests" ON resource_requests FOR SELECT USING (requested_by = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins view all requests') THEN
        CREATE POLICY "Admins view all requests" ON resource_requests FOR SELECT USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authorized users can create requests') THEN
        CREATE POLICY "Authorized users can create requests" ON resource_requests FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin', 'responder')));
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
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL; -- Skip if already added or publication doesn't exist
END $$;

-- ============================================
-- FUNCTIONS (001_create_tables.sql)
-- ============================================

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

CREATE TABLE IF NOT EXISTS public.respond_unit_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES public.respond_units(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES public.officers(id) ON DELETE RESTRICT,
  responder_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  member_role TEXT NOT NULL DEFAULT 'unassigned'
    CHECK (member_role IN ('team_leader', 'radio_operator', 'driver_responder', 'first_aider_responder', 'unassigned')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_id, officer_id),
  CHECK (member_role <> 'team_leader' OR responder_user_id IS NOT NULL),
  CHECK (member_role = 'team_leader' OR responder_user_id IS NULL)
);

CREATE TABLE IF NOT EXISTS public.respond_unit_daily_activations (
  unit_id UUID NOT NULL REFERENCES public.respond_units(id) ON DELETE CASCADE,
  activation_date DATE NOT NULL,
  activated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  activation_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (activation_mode IN ('manual', 'emergency')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (unit_id, activation_date)
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

-- RLS Policies
DO $$ BEGIN
    -- Officers Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view officers') THEN
        CREATE POLICY "Authenticated users can view officers" ON officers FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage officers') THEN
        CREATE POLICY "Admins can manage officers" ON officers FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;

    -- Respond Units Policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view respond units') THEN
        CREATE POLICY "Authenticated users can view respond units" ON respond_units FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage respond units') THEN
        CREATE POLICY "Admins can manage respond units" ON respond_units FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
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
        CREATE POLICY "Admins can manage storages" ON storages FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
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
        CREATE TYPE report_status AS ENUM ('pending', 'verified', 'rejected', 'responding', 'escalated', 'resolved');
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
  incident_type TEXT,
  severity TEXT,
  dispatch_incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  status report_status NOT NULL DEFAULT 'pending',
  client_submitted_at TIMESTAMPTZ,
  incident_occurred_at TIMESTAMPTZ,
  incident_time_precision TEXT NOT NULL DEFAULT 'unknown'
    CONSTRAINT incident_reports_time_precision_check
    CHECK (incident_time_precision IN ('exact', 'approximate', 'unknown')),
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

    -- Authenticated responders and staff can view their own reports
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own incident reports') THEN
        CREATE POLICY "Users can view own incident reports" ON incident_reports FOR SELECT USING (reporter_id = auth.uid());
    END IF;

    -- Admins and master admins can view and manage all reports
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins manage incident reports') THEN
        CREATE POLICY "Admins manage incident reports" ON incident_reports FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
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
        CREATE POLICY "Admins can manage advisories" ON weather_advisories FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;
    -- Hazard Zones
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view hazard zones') THEN
        CREATE POLICY "Authenticated users can view hazard zones" ON hazard_zones FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage hazard zones') THEN
        CREATE POLICY "Admins can manage hazard zones" ON hazard_zones FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
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
        CREATE POLICY "Admins can manage earthquakes" ON earthquakes FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;
    -- River Stations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view river stations') THEN
        CREATE POLICY "Authenticated users can view river stations" ON river_stations FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage river stations') THEN
        CREATE POLICY "Admins can manage river stations" ON river_stations FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;
    -- River Levels
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view river levels') THEN
        CREATE POLICY "Authenticated users can view river levels" ON river_levels FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage river levels') THEN
        CREATE POLICY "Admins can manage river levels" ON river_levels FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
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
        CREATE POLICY "Admins can manage dam stations" ON dam_stations FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
    END IF;
    -- Dam Levels
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view dam levels') THEN
        CREATE POLICY "Authenticated users can view dam levels" ON dam_levels FOR SELECT USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage dam levels') THEN
        CREATE POLICY "Admins can manage dam levels" ON dam_levels FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
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
        CREATE POLICY "Admins can manage alerts" ON alerts FOR ALL USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'master_admin')));
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


-- ===== Source section: database/migrations/evacuation_centers_migration.sql =====
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
        CREATE TYPE barangay_role AS ENUM ('admin', 'dispatcher', 'responder', 'staff');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS barangay_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID REFERENCES barangays(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE NOT NULL DEFAULT '',
  phone VARCHAR(15),
  password_hash TEXT NOT NULL DEFAULT '',
  role barangay_role NOT NULL DEFAULT 'staff',
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
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS role barangay_role NOT NULL DEFAULT 'staff';
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
-- 4. UPDATE INCIDENT_REPORTS TABLE
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
-- 5. UPDATED_AT TRIGGER for evacuation_centers
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
-- 6. RLS POLICIES
-- ============================================

ALTER TABLE barangays ENABLE ROW LEVEL SECURITY;
ALTER TABLE barangay_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE evacuation_centers ENABLE ROW LEVEL SECURITY;

-- Public read / write policies
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view barangays') THEN
        CREATE POLICY "Anyone can view barangays" ON barangays FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view active evac centers') THEN
        CREATE POLICY "Anyone can view active evac centers" ON evacuation_centers FOR SELECT USING (is_active = true);
    END IF;
END $$;

-- ===== Source section: database/migrations/co_response_migration.sql =====
-- ============================================
-- NorzAgapay Multi-Agency Co-Response Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- Add MDRRMO response tracking columns to incident_reports table
ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS mdrrmo_response_status TEXT DEFAULT 'pending', -- pending | responding | resolved
  ADD COLUMN IF NOT EXISTS mdrrmo_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_responder_name TEXT,
  ADD COLUMN IF NOT EXISTS mdrrmo_response_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_incident_reports_mdrrmo_status ON incident_reports(mdrrmo_response_status);

-- ===== Source section: database/migrations/dispatcher_verification_migration.sql =====
-- ==============================================================================
-- Migration: Create Barangay Dispatcher Verifications Table & Supporting Columns
-- Description: Enables Barangay Account Request tracking, prefilled PDF reference
--              linking, document upload storage, review status, and audit history.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS barangay_dispatcher_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, -- References the existing barangay administrator's barangay_users(id)
  barangay_id UUID NOT NULL REFERENCES barangays(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  phone VARCHAR(20),
  position_designation TEXT NOT NULL DEFAULT 'Barangay Dispatcher',
  punong_barangay_name TEXT NOT NULL DEFAULT '',
  punong_barangay_position TEXT NOT NULL DEFAULT 'Punong Barangay',
  reference_no VARCHAR(64) UNIQUE NOT NULL,
  document_url TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_document', -- pending_document | under_review | verified | rejected | needs_correction | activation_pending
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verification_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatcher_verifications_user_id ON barangay_dispatcher_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_dispatcher_verifications_barangay_id ON barangay_dispatcher_verifications(barangay_id);
CREATE INDEX IF NOT EXISTS idx_dispatcher_verifications_status ON barangay_dispatcher_verifications(status);
CREATE INDEX IF NOT EXISTS idx_dispatcher_verifications_ref_no ON barangay_dispatcher_verifications(reference_no);

ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32) DEFAULT 'pending_document';
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS verification_ref_no VARCHAR(64);
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS position_designation TEXT;
ALTER TABLE barangay_dispatcher_verifications ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE barangay_dispatcher_verifications ALTER COLUMN is_active SET DEFAULT false;

UPDATE barangay_users AS bu
SET position_designation = dv.position_designation
FROM barangay_dispatcher_verifications AS dv
WHERE dv.user_id = bu.id
  AND NULLIF(BTRIM(dv.position_designation), '') IS NOT NULL
  AND (
    bu.position_designation IS NULL
    OR BTRIM(bu.position_designation) = ''
    OR LOWER(BTRIM(bu.position_designation)) = 'barangay dispatcher'
  );

-- ===== Source section: database/migrations/fix_dispatcher_verification_fk.sql =====
-- ==============================================================================
-- Migration: Fix Barangay Dispatcher Verifications Foreign Key Constraint
-- Description:
--   Allows pending dispatcher accounts to be created in
--   `barangay_dispatcher_verifications` BEFORE they are approved by MDRRMO into
--   `barangay_users`.
--
-- Instructions: Run this script in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/xtbdzptngsullaxubded/sql/new
-- ==============================================================================

-- 1. Drop the foreign key constraint that blocks inserting unapproved dispatchers
ALTER TABLE barangay_dispatcher_verifications
  DROP CONSTRAINT IF EXISTS barangay_dispatcher_verifications_user_id_fkey;

-- 2. Make user_id nullable or unconstrained so new UUIDs can be inserted before approval
ALTER TABLE barangay_dispatcher_verifications
  ALTER COLUMN user_id DROP NOT NULL;

-- 3. Add password_hash column so pending dispatchers can log in from any client/server instance
ALTER TABLE barangay_dispatcher_verifications
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 4. Reload schema cache in Supabase PostgREST
NOTIFY pgrst, 'reload schema';

-- ===== Source section: database/migrations/add_multiple_proof_and_field_media.sql =====
-- Migration: Add multiple proof URLs and responder field media support
-- Run this in your Supabase SQL Editor to support multiple visual proofs and team leader field media

DO $$ BEGIN
    -- Add proof_urls array column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'incident_reports' AND column_name = 'proof_urls'
    ) THEN
        ALTER TABLE incident_reports ADD COLUMN proof_urls TEXT[];
    END IF;

    -- Add proof_types array column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'incident_reports' AND column_name = 'proof_types'
    ) THEN
        ALTER TABLE incident_reports ADD COLUMN proof_types TEXT[];
    END IF;

    -- Add responder_media JSONB column for field photos/videos uploaded by team leaders
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'incident_reports' AND column_name = 'responder_media'
    ) THEN
        ALTER TABLE incident_reports ADD COLUMN responder_media JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- ===== Source section: database/migrations/add_send_to_to_incident_reports.sql =====
-- ============================================
-- NorzAgapay Emergency Report Target Recipient Migration
-- Adds send_to column to incident_reports table
-- ('barangay' | 'mdrrmo' | 'all')
-- ============================================

ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS send_to TEXT DEFAULT 'all';

CREATE INDEX IF NOT EXISTS idx_incident_reports_send_to ON incident_reports(send_to);

-- ===== Source section: database/migrations/public_broadcasts_migration.sql =====
-- ============================================================================
-- Migration: Public Alerts / Broadcasts
-- Supports barangay posts, municipality-wide MDRRMO posts, and persistent reposts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID NOT NULL REFERENCES barangays(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES barangay_users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL DEFAULT 'safety_advisory',
  content TEXT NOT NULL,
  links JSONB DEFAULT '[]'::jsonb,
  media JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_broadcasts_barangay ON public_broadcasts(barangay_id);
CREATE INDEX IF NOT EXISTS idx_public_broadcasts_created_at ON public_broadcasts(created_at DESC);

-- MDRRMO-authored posts have no barangay owner or barangay-app author. The
-- dashboard author is stored separately so existing barangay foreign keys
-- and posts remain intact.
ALTER TABLE public_broadcasts ALTER COLUMN barangay_id DROP NOT NULL;
ALTER TABLE public_broadcasts ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS is_mdrrmo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS is_from_mdrrmo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS reposted_by TEXT;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS reposted_from_id UUID REFERENCES public_broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_public_broadcasts_municipal_feed
  ON public_broadcasts(created_at DESC) WHERE is_mdrrmo = true AND barangay_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_broadcasts_unique_barangay_repost
  ON public_broadcasts(barangay_id, reposted_from_id) WHERE reposted_from_id IS NOT NULL;

-- ===== Source section: database/migrations/resident_barangay_name_migration.sql =====
-- Legacy resident assignment column and user update timestamp.
-- New resident accounts are stored in resident_user; barangay_name on users
-- remains only for backwards compatibility with existing deployments.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS barangay_name TEXT;

-- Used by account updates and password changes in the backend.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ===== Source section: database/migrations/resident_user_table_migration.sql =====
-- Keep the three account groups in separate tables:
--   users         -> MDRRMO / response staff
--   barangay_users -> barangay staff
--   resident_user  -> resident app accounts
CREATE TABLE IF NOT EXISTS public.resident_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone VARCHAR(15),
  password_hash TEXT NOT NULL,
  barangay_name TEXT NOT NULL DEFAULT 'Poblacion',
  role TEXT NOT NULL DEFAULT 'resident' CHECK (role = 'resident'),
  status TEXT NOT NULL DEFAULT 'active',
  verified BOOLEAN NOT NULL DEFAULT false,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resident_user ENABLE ROW LEVEL SECURITY;

-- incident_reports.reporter_id is polymorphic: it may identify a staff user
-- or a resident_user. reporter_type distinguishes the account table.
ALTER TABLE public.incident_reports
  DROP CONSTRAINT IF EXISTS incident_reports_reporter_id_fkey;

-- ===== Source section: database/migrations/incident_reporter_email_migration.sql =====
-- Store the resident's email separately from their phone number on incident reports.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS reporter_email TEXT;

-- Repair legacy resident reports where an email was mistakenly saved as a phone.
UPDATE public.incident_reports
SET reporter_email = COALESCE(NULLIF(reporter_email, ''), reporter_phone),
    reporter_phone = NULL
WHERE reporter_phone LIKE '%@%';

-- Fill known reporter details from resident accounts when a report has a linked account.
UPDATE public.incident_reports AS report
SET reporter_name = COALESCE(NULLIF(report.reporter_name, ''), resident.full_name),
    reporter_email = COALESCE(NULLIF(report.reporter_email, ''), resident.email),
    reporter_phone = COALESCE(NULLIF(report.reporter_phone, ''), NULLIF(resident.phone, ''))
FROM public.resident_user AS resident
WHERE (report.reporter_type = 'resident' AND report.reporter_id = resident.id)
   OR lower(COALESCE(report.reporter_email, '')) = lower(resident.email);

-- ===== Source section: database/migrations/dashboard_roles_add.sql =====
-- The user_role enum is created with its final labels in the base schema.

-- ===== Source section: database/migrations/dashboard_roles_cleanup.sql =====
-- This is a fresh-install schema. Legacy account-role data conversion belongs
-- in an upgrade migration; final role values and constraints are defined here.

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'responder';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_allowed_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_allowed_check
  CHECK (role IN ('master_admin', 'admin', 'logistics', 'dispatcher', 'responder'));

-- ===== Source section: database/migrations/dashboard_roles_singleton.sql =====
-- Run separately after dashboard_roles_add.sql has committed.
-- Normalize pre-existing duplicate master accounts before enforcing the singleton.
WITH ranked_master_admins AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS account_number
  FROM users
  WHERE role = 'master_admin'
)
UPDATE users AS account
SET role = 'admin'
FROM ranked_master_admins AS ranked
WHERE account.id = ranked.id
  AND ranked.account_number > 1;

-- Prevent concurrent initial setup requests from creating multiple master admins.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_master_admin_idx
  ON users (role)
  WHERE role = 'master_admin';

-- ===== Source section: database/migrations/incident_classification_migration.sql =====
-- Store the dispatcher classification separately from the resident's report category.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS incident_type TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incident_reports_dispatch_incident_id
  ON public.incident_reports(dispatch_incident_id);

-- ===== Source section: database/migrations/municipality_boundary_migration.sql =====
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

-- ===== Source section: database/migrations/report_resolution_status_migration.sql =====
-- The report_status enum is created with its final labels in the base schema.

-- These fields were added by the barangay response migration. Repeat the
-- idempotent additions here so deployments that missed that migration can
-- still complete the close-report flow.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ===== Source section: database/migrations/report_response_timing_migration.sql =====
-- Report response lifecycle timestamps, arrival evidence, and acceptance-time distance.
-- Run in the Supabase SQL Editor before deploying the updated API/mobile app.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS travel_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_fix_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_method TEXT,
  ADD COLUMN IF NOT EXISTS arrival_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_distance_m DOUBLE PRECISION;

-- The MDRRMO task workflow records acceptance and arrival on tasks as well.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS travel_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_fix_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returning_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_method TEXT,
  ADD COLUMN IF NOT EXISTS arrival_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_distance_m DOUBLE PRECISION;

-- Backfill milestones only where an existing timestamp has the same meaning.
UPDATE public.incident_reports AS report
SET accepted_at = report.barangay_responded_at
WHERE report.accepted_at IS NULL
  AND report.barangay_response_status = 'responding'
  AND report.barangay_responded_at IS NOT NULL;

UPDATE public.incident_reports AS report
SET dispatched_at = report.barangay_responded_at
WHERE report.dispatched_at IS NULL
  AND report.barangay_response_status = 'pending'
  AND report.barangay_responded_at IS NOT NULL;

UPDATE public.incident_reports AS report
SET accepted_at = task.accepted_at
FROM public.tasks AS task
WHERE report.accepted_at IS NULL
  AND report.dispatch_incident_id = task.incident_id
  AND task.accepted_at IS NOT NULL;

UPDATE public.incident_reports AS report
SET travel_distance_m = task.travel_distance_m,
    travel_distance_accuracy_m = task.travel_distance_accuracy_m,
    travel_distance_fix_at = task.travel_distance_fix_at
FROM public.tasks AS task
WHERE report.travel_distance_m IS NULL
  AND report.dispatch_incident_id = task.incident_id
  AND task.travel_distance_m IS NOT NULL;

UPDATE public.incident_reports AS report
SET arrived_at = task.arrived_at,
    arrival_recorded_at = COALESCE(task.arrival_recorded_at, task.arrived_at),
    arrival_method = COALESCE(task.arrival_method, 'manual'),
    arrival_latitude = task.arrival_latitude,
    arrival_longitude = task.arrival_longitude,
    arrival_accuracy_m = task.arrival_accuracy_m,
    arrival_distance_m = task.arrival_distance_m
FROM public.tasks AS task
WHERE report.arrived_at IS NULL
  AND report.dispatch_incident_id = task.incident_id
  AND task.arrived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incident_reports_dispatched_at
  ON public.incident_reports(dispatched_at);
CREATE INDEX IF NOT EXISTS idx_incident_reports_arrived_at
  ON public.incident_reports(arrived_at);

-- Support barangay-origin report history, resolved lists, and resident timing estimates.
CREATE INDEX IF NOT EXISTS idx_incident_reports_barangay_created_at
  ON public.incident_reports(barangay_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_reports_barangay_resolved_at
  ON public.incident_reports(barangay_id, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incident_reports_barangay_timing_samples
  ON public.incident_reports(barangay_id, type, severity, created_at DESC)
  WHERE accepted_at IS NOT NULL
    AND arrived_at IS NOT NULL
    AND resolved_at IS NOT NULL;

-- ===== Source section: database/migrations/incident_report_review_migration.sql =====
-- Persist MDRRMO invalid-report decisions and enforce resident false-report strikes.
-- Run after resident_user_table_migration.sql.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS review_outcome TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incident_reports_review_outcome_check'
  ) THEN
    ALTER TABLE public.incident_reports
      ADD CONSTRAINT incident_reports_review_outcome_check
      CHECK (review_outcome IS NULL OR review_outcome IN ('inconclusive', 'false_report'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_incident_reports_review_outcome
  ON public.incident_reports(review_outcome)
  WHERE review_outcome IS NOT NULL;

ALTER TABLE public.resident_user
  ADD COLUMN IF NOT EXISTS false_report_count INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resident_user_false_report_count_check'
  ) THEN
    ALTER TABLE public.resident_user
      ADD CONSTRAINT resident_user_false_report_count_check CHECK (false_report_count >= 0);
  END IF;
END $$;

-- The report row and resident row are locked in one transaction so retries cannot
-- count the same report twice and concurrent marks cannot lose a strike.
CREATE OR REPLACE FUNCTION public.review_incident_report(
  p_report_id UUID,
  p_review_outcome TEXT,
  p_review_reason TEXT,
  p_reviewed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_false_report_count INTEGER;
  v_resident_status TEXT;
BEGIN
  IF p_review_outcome NOT IN ('inconclusive', 'false_report') THEN
    RAISE EXCEPTION 'Invalid review outcome' USING ERRCODE = '22023';
  END IF;
  IF p_reviewed_by IS NULL THEN
    RAISE EXCEPTION 'Reviewer is required' USING ERRCODE = '22023';
  END IF;
  IF p_review_outcome = 'inconclusive' AND NULLIF(BTRIM(p_review_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for an inconclusive report' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report
    FROM public.incident_reports
    WHERE id = p_report_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_report.review_outcome IS NOT NULL THEN
    IF v_report.review_outcome <> p_review_outcome THEN
      RAISE EXCEPTION 'Report has already received a different review decision' USING ERRCODE = 'P0001';
    END IF;
    IF v_report.reporter_type = 'resident' AND v_report.reporter_id IS NOT NULL THEN
      SELECT false_report_count, status INTO v_false_report_count, v_resident_status
        FROM public.resident_user WHERE id = v_report.reporter_id;
    END IF;
    RETURN jsonb_build_object(
      'report', to_jsonb(v_report),
      'false_report_count', v_false_report_count,
      'resident_status', v_resident_status,
      'already_reviewed', true
    );
  END IF;

  IF v_report.status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'Only pending reports can receive an invalid-report decision' USING ERRCODE = 'P0001';
  END IF;
  IF p_review_outcome = 'false_report' AND v_report.reporter_type <> 'resident' THEN
    RAISE EXCEPTION 'False-reporter marks can only be applied to resident reports' USING ERRCODE = '22023';
  END IF;

  IF p_review_outcome = 'false_report' AND v_report.reporter_id IS NOT NULL THEN
    UPDATE public.resident_user
      SET false_report_count = LEAST(COALESCE(false_report_count, 0) + 1, 3),
          status = CASE WHEN COALESCE(false_report_count, 0) + 1 >= 3 THEN 'inactive' ELSE status END,
          updated_at = NOW()
      WHERE id = v_report.reporter_id
      RETURNING false_report_count, status INTO v_false_report_count, v_resident_status;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked resident account was not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE public.incident_reports
    SET review_outcome = p_review_outcome,
        review_reason = NULLIF(BTRIM(p_review_reason), ''),
        reviewed_by = p_reviewed_by,
        reviewed_at = NOW(),
        status = 'rejected'
    WHERE id = p_report_id
    RETURNING * INTO v_report;

  RETURN jsonb_build_object(
    'report', to_jsonb(v_report),
    'false_report_count', v_false_report_count,
    'resident_status', v_resident_status,
    'already_reviewed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_incident_report(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_incident_report(UUID, TEXT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_incident_report(UUID, TEXT, TEXT, UUID) TO service_role;

-- ===== Source section: database/migrations/mdrrmo_report_cycle_migration.sql =====
-- Give MDRRMO incident reports a normalized responder assignment and notes.
-- Apply this migration before deploying the MDRRMO report-cycle API/mobile app.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatch_notes TEXT;

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  responder_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'responding', 'resolved', 'removed')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  UNIQUE (report_id, responder_id)
);

CREATE INDEX IF NOT EXISTS idx_mdrrmo_report_assignments_responder_status
  ON public.mdrrmo_report_assignments(responder_id, status, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_mdrrmo_report_assignments_report
  ON public.mdrrmo_report_assignments(report_id, status);

ALTER TABLE public.mdrrmo_report_assignments ENABLE ROW LEVEL SECURITY;

-- The backend uses the service role for these operations. Direct client access
-- remains unavailable; all role and assignment checks are enforced by the API.

-- ===== Source section: database/migrations/responder_returned_at_migration.sql =====
-- Track the responder's return-to-base completion separately from on-scene resolution.
-- Run this migration in Supabase before deploying the updated API/mobile app.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS returning_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

-- Do not backfill returned_at from completed_at. Historical completed_at values
-- represent the old on-scene completion action, not a confirmed return to base.

-- ===== Source section: database/migrations/incident_lifecycle_realtime_migration.sql =====
-- Durable, ordered lifecycle events for report changes. The trigger writes the
-- outbox row in the same transaction as the incident_reports change.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_time_precision TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'incident_reports_time_precision_check'
      AND conrelid = 'public.incident_reports'::regclass
  ) THEN
    ALTER TABLE public.incident_reports
      ADD CONSTRAINT incident_reports_time_precision_check
      CHECK (incident_time_precision IN ('exact', 'approximate', 'unknown'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS incident_reports_client_request_id_uidx
  ON public.incident_reports (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.incident_event_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (report_id, revision)
);

CREATE INDEX IF NOT EXISTS incident_event_outbox_pending_idx
  ON public.incident_event_outbox (available_at, id)
  WHERE published_at IS NULL;

ALTER TABLE public.incident_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.incident_event_outbox FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_incident_lifecycle_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_lifecycle JSONB;
  new_lifecycle JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.lifecycle_revision := GREATEST(COALESCE(NEW.lifecycle_revision, 0), 1);
    RETURN NEW;
  END IF;

  old_lifecycle := jsonb_build_object(
    'status', to_jsonb(OLD)->'status',
    'incident_occurred_at', to_jsonb(OLD)->'incident_occurred_at',
    'incident_time_precision', to_jsonb(OLD)->'incident_time_precision',
    'incident_type', to_jsonb(OLD)->'incident_type',
    'severity', to_jsonb(OLD)->'severity',
    'review_outcome', to_jsonb(OLD)->'review_outcome',
    'dispatcher_reviewed_at', to_jsonb(OLD)->'dispatcher_reviewed_at',
    'barangay_response_status', to_jsonb(OLD)->'barangay_response_status',
    'barangay_response_notes', to_jsonb(OLD)->'barangay_response_notes',
    'barangay_responder_name', to_jsonb(OLD)->'barangay_responder_name',
    'barangay_responded_by', to_jsonb(OLD)->'barangay_responded_by',
    'mdrrmo_response_status', to_jsonb(OLD)->'mdrrmo_response_status',
    'mdrrmo_response_notes', to_jsonb(OLD)->'mdrrmo_response_notes',
    'mdrrmo_dispatch_notes', to_jsonb(OLD)->'mdrrmo_dispatch_notes',
    'mdrrmo_responder_name', to_jsonb(OLD)->'mdrrmo_responder_name',
    'mdrrmo_responded_by', to_jsonb(OLD)->'mdrrmo_responded_by',
    'send_to', to_jsonb(OLD)->'send_to',
    'dispatch_incident_id', to_jsonb(OLD)->'dispatch_incident_id',
    'dispatched_at', to_jsonb(OLD)->'dispatched_at',
    'accepted_at', to_jsonb(OLD)->'accepted_at',
    'arrived_at', to_jsonb(OLD)->'arrived_at',
    'resolved_at', to_jsonb(OLD)->'resolved_at',
    'evidence_status', to_jsonb(OLD)->'evidence_status',
    'responder_media', to_jsonb(OLD)->'responder_media'
  );
  new_lifecycle := jsonb_build_object(
    'status', to_jsonb(NEW)->'status',
    'incident_occurred_at', to_jsonb(NEW)->'incident_occurred_at',
    'incident_time_precision', to_jsonb(NEW)->'incident_time_precision',
    'incident_type', to_jsonb(NEW)->'incident_type',
    'severity', to_jsonb(NEW)->'severity',
    'review_outcome', to_jsonb(NEW)->'review_outcome',
    'dispatcher_reviewed_at', to_jsonb(NEW)->'dispatcher_reviewed_at',
    'barangay_response_status', to_jsonb(NEW)->'barangay_response_status',
    'barangay_response_notes', to_jsonb(NEW)->'barangay_response_notes',
    'barangay_responder_name', to_jsonb(NEW)->'barangay_responder_name',
    'barangay_responded_by', to_jsonb(NEW)->'barangay_responded_by',
    'mdrrmo_response_status', to_jsonb(NEW)->'mdrrmo_response_status',
    'mdrrmo_response_notes', to_jsonb(NEW)->'mdrrmo_response_notes',
    'mdrrmo_dispatch_notes', to_jsonb(NEW)->'mdrrmo_dispatch_notes',
    'mdrrmo_responder_name', to_jsonb(NEW)->'mdrrmo_responder_name',
    'mdrrmo_responded_by', to_jsonb(NEW)->'mdrrmo_responded_by',
    'send_to', to_jsonb(NEW)->'send_to',
    'dispatch_incident_id', to_jsonb(NEW)->'dispatch_incident_id',
    'dispatched_at', to_jsonb(NEW)->'dispatched_at',
    'accepted_at', to_jsonb(NEW)->'accepted_at',
    'arrived_at', to_jsonb(NEW)->'arrived_at',
    'resolved_at', to_jsonb(NEW)->'resolved_at',
    'evidence_status', to_jsonb(NEW)->'evidence_status',
    'responder_media', to_jsonb(NEW)->'responder_media'
  );

  IF old_lifecycle IS DISTINCT FROM new_lifecycle THEN
    NEW.lifecycle_revision := COALESCE(OLD.lifecycle_revision, 0) + 1;
  ELSE
    NEW.lifecycle_revision := COALESCE(OLD.lifecycle_revision, 0);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_incident_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  event_payload JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.lifecycle_revision = OLD.lifecycle_revision THEN
    RETURN NEW;
  END IF;

  event_payload := jsonb_build_object(
    'status', to_jsonb(NEW)->'status',
    'incident_occurred_at', to_jsonb(NEW)->'incident_occurred_at',
    'incident_time_precision', to_jsonb(NEW)->'incident_time_precision',
    'created_at', to_jsonb(NEW)->'created_at',
    'review_outcome', to_jsonb(NEW)->'review_outcome',
    'barangay_response_status', to_jsonb(NEW)->'barangay_response_status',
    'mdrrmo_response_status', to_jsonb(NEW)->'mdrrmo_response_status',
    'dispatch_incident_id', to_jsonb(NEW)->'dispatch_incident_id',
    'send_to', to_jsonb(NEW)->'send_to',
    'dispatched_at', to_jsonb(NEW)->'dispatched_at',
    'accepted_at', to_jsonb(NEW)->'accepted_at',
    'arrived_at', to_jsonb(NEW)->'arrived_at',
    'resolved_at', to_jsonb(NEW)->'resolved_at',
    'evidence_status', to_jsonb(NEW)->'evidence_status',
    'updated_at', to_jsonb(NEW)->'updated_at'
  );

  INSERT INTO public.incident_event_outbox
    (report_id, revision, event_type, payload)
  VALUES
    (NEW.id, NEW.lifecycle_revision,
     CASE WHEN TG_OP = 'INSERT' THEN 'incident.created' ELSE 'incident.lifecycle_changed' END,
     event_payload)
  ON CONFLICT (report_id, revision) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incident_lifecycle_revision_before_write ON public.incident_reports;
CREATE TRIGGER incident_lifecycle_revision_before_write
  BEFORE INSERT OR UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_incident_lifecycle_revision();

DROP TRIGGER IF EXISTS incident_lifecycle_outbox_after_write ON public.incident_reports;
CREATE TRIGGER incident_lifecycle_outbox_after_write
  AFTER INSERT OR UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_incident_lifecycle_event();

-- Multiple backend instances can safely claim separate rows. Failed publishes
-- are released with a delay by the application and become claimable again.
CREATE OR REPLACE FUNCTION public.claim_incident_event_outbox(p_batch_size INTEGER DEFAULT 50)
RETURNS SETOF public.incident_event_outbox
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.incident_event_outbox
    WHERE published_at IS NULL
      AND available_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY id
    LIMIT LEAST(GREATEST(p_batch_size, 1), 200)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.incident_event_outbox AS events
  SET locked_until = now() + interval '30 seconds',
      attempts = events.attempts + 1
  FROM candidates
  WHERE events.id = candidates.id
  RETURNING events.*;
$$;

REVOKE ALL ON FUNCTION public.claim_incident_event_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_incident_event_outbox(INTEGER) TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.incident_event_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.incident_event_outbox_id_seq TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'incident_event_outbox'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_event_outbox;
  END IF;
END;
$$;

-- ===== Source section: database/migrations/incident_occurrence_time_migration.sql =====
-- Keep the resident-reported incident time distinct from server receipt time.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS incident_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_time_precision TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'incident_reports_time_precision_check'
      AND conrelid = 'public.incident_reports'::regclass
  ) THEN
    ALTER TABLE public.incident_reports
      ADD CONSTRAINT incident_reports_time_precision_check
      CHECK (incident_time_precision IN ('exact', 'approximate', 'unknown'));
  END IF;
END $$;

-- ===== Source section: database/migrations/resident_draft_metadata_migration.sql =====
-- Preserve the resident's first submit-attempt time separately from the
-- server-generated created_at value used for receipt time and response SLAs.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ;

-- ===== Source section: database/migrations/incident_resolution_documents_migration.sql =====
-- Preserve Barangay and MDRRMO closeouts independently and track the latest
-- generated incident PDF. The PDF bucket is private; downloads go through the
-- authenticated API.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS barangay_resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS barangay_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS mdrrmo_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS barangay_dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS barangay_dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS barangay_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS barangay_arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_pdf_status TEXT NOT NULL DEFAULT 'missing'
    CHECK (resolution_pdf_status IN ('missing', 'ready', 'failed'));

-- Backfill existing resolved reports to the response channel that most likely
-- owned the recorded resolution. Keep the existing shared resolution fields
-- intact for older clients.
UPDATE public.incident_reports
SET mdrrmo_response_status = 'resolved',
    mdrrmo_resolved_notes = COALESCE(mdrrmo_resolved_notes, resolved_notes),
    mdrrmo_resolved_at = COALESCE(mdrrmo_resolved_at, resolved_at),
    mdrrmo_dispatcher_reviewed_at = COALESCE(mdrrmo_dispatcher_reviewed_at, dispatcher_reviewed_at),
    mdrrmo_dispatched_at = COALESCE(mdrrmo_dispatched_at, dispatched_at),
    mdrrmo_accepted_at = COALESCE(mdrrmo_accepted_at, accepted_at),
    mdrrmo_arrived_at = COALESCE(mdrrmo_arrived_at, arrived_at)
WHERE status::text IN ('resolved', 'closed')
  AND (mdrrmo_responded_by IS NOT NULL OR send_to = 'mdrrmo'
       OR COALESCE(mdrrmo_response_notes, '') ILIKE '%escalated%');

UPDATE public.incident_reports
SET barangay_response_status = 'resolved',
    barangay_resolved_notes = COALESCE(barangay_resolved_notes, resolved_notes),
    barangay_resolved_at = COALESCE(barangay_resolved_at, resolved_at),
    barangay_dispatcher_reviewed_at = COALESCE(barangay_dispatcher_reviewed_at, dispatcher_reviewed_at),
    barangay_dispatched_at = COALESCE(barangay_dispatched_at, dispatched_at),
    barangay_accepted_at = COALESCE(barangay_accepted_at, accepted_at),
    barangay_arrived_at = COALESCE(barangay_arrived_at, arrived_at)
WHERE status::text IN ('resolved', 'closed')
  AND mdrrmo_response_status IS DISTINCT FROM 'resolved'
  AND (barangay_id IS NOT NULL OR barangay_responded_by IS NOT NULL);

UPDATE public.incident_reports
SET barangay_dispatcher_reviewed_at = COALESCE(barangay_dispatcher_reviewed_at, dispatcher_reviewed_at),
    barangay_dispatched_at = COALESCE(barangay_dispatched_at, dispatched_at),
    barangay_accepted_at = COALESCE(barangay_accepted_at, accepted_at),
    barangay_arrived_at = COALESCE(barangay_arrived_at, arrived_at)
WHERE barangay_response_status = 'responding';

UPDATE public.incident_reports
SET mdrrmo_dispatcher_reviewed_at = COALESCE(mdrrmo_dispatcher_reviewed_at, dispatcher_reviewed_at),
    mdrrmo_dispatched_at = COALESCE(mdrrmo_dispatched_at, dispatched_at),
    mdrrmo_accepted_at = COALESCE(mdrrmo_accepted_at, accepted_at),
    mdrrmo_arrived_at = COALESCE(mdrrmo_arrived_at, arrived_at)
WHERE mdrrmo_response_status = 'responding';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'incident-resolution-documents',
  'incident-resolution-documents',
  false,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ===== Source section: database/migrations/mdrrmo_report_lifecycle_strictness_migration.sql =====
-- Preserve actor attribution for the MDRRMO response cycle and keep an
-- append-only record of lifecycle transitions and resident content edits.
-- Apply after mdrrmo_report_cycle_migration.sql, incident_resolution_documents_migration.sql,
-- incident_report_review_migration.sql, report_resolution_status_migration.sql,
-- and incident_lifecycle_realtime_migration.sql.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatcher_reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatched_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_arrived_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_role TEXT;

ALTER TABLE public.mdrrmo_report_assignments
  ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS arrived_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by_role TEXT,
  ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.incident_report_lifecycle_history (
  id BIGSERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS incident_report_lifecycle_history_report_idx
  ON public.incident_report_lifecycle_history(report_id, occurred_at, id);

ALTER TABLE public.incident_report_lifecycle_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.incident_report_lifecycle_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.incident_report_lifecycle_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.incident_report_lifecycle_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.audit_incident_report_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type TEXT;
  v_actor_id UUID;
  v_actor_role TEXT;
  v_details JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'incident.received';
    v_actor_id := NEW.reporter_id;
    v_actor_role := NEW.reporter_type;
    v_details := jsonb_build_object(
      'send_to', NEW.send_to,
      'status', NEW.status,
      'created_at', NEW.created_at,
      'incident_occurred_at', NEW.incident_occurred_at,
      'incident_time_precision', NEW.incident_time_precision
    );
  ELSE
    IF NEW.review_outcome IS DISTINCT FROM OLD.review_outcome THEN
      v_event_type := 'incident.reviewed';
    ELSIF NEW.barangay_dispatched_at IS DISTINCT FROM OLD.barangay_dispatched_at THEN
      v_event_type := 'barangay.responders_assigned';
    ELSIF NEW.barangay_accepted_at IS DISTINCT FROM OLD.barangay_accepted_at THEN
      v_event_type := 'barangay.responder_accepted';
    ELSIF NEW.barangay_arrived_at IS DISTINCT FROM OLD.barangay_arrived_at THEN
      v_event_type := 'barangay.responder_arrived';
    ELSIF NEW.barangay_resolved_at IS DISTINCT FROM OLD.barangay_resolved_at THEN
      v_event_type := 'barangay.response_resolved';
    ELSIF NEW.mdrrmo_dispatched_at IS DISTINCT FROM OLD.mdrrmo_dispatched_at THEN
      v_event_type := 'mdrrmo.responders_assigned';
    ELSIF NEW.mdrrmo_accepted_at IS DISTINCT FROM OLD.mdrrmo_accepted_at THEN
      v_event_type := 'mdrrmo.responder_accepted';
    ELSIF NEW.mdrrmo_accepted_by IS DISTINCT FROM OLD.mdrrmo_accepted_by THEN
      v_event_type := 'mdrrmo.responder_accepted';
    ELSIF NEW.mdrrmo_arrived_at IS DISTINCT FROM OLD.mdrrmo_arrived_at THEN
      v_event_type := 'mdrrmo.responder_arrived';
    ELSIF NEW.mdrrmo_resolved_at IS DISTINCT FROM OLD.mdrrmo_resolved_at THEN
      v_event_type := 'mdrrmo.response_resolved';
    ELSIF NEW.mdrrmo_response_notes IS DISTINCT FROM OLD.mdrrmo_response_notes THEN
      v_event_type := 'mdrrmo.field_assessment_updated';
    ELSIF NEW.mdrrmo_coordination_notes IS DISTINCT FROM OLD.mdrrmo_coordination_notes THEN
      v_event_type := 'mdrrmo.coordination_updated';
    ELSIF to_jsonb(NEW)->'responder_media' IS DISTINCT FROM to_jsonb(OLD)->'responder_media' THEN
      v_event_type := 'response.field_media_added';
    ELSIF NEW.description IS DISTINCT FROM OLD.description
       OR NEW.specifics IS DISTINCT FROM OLD.specifics
       OR NEW.proof_url IS DISTINCT FROM OLD.proof_url
       OR NEW.proof_type IS DISTINCT FROM OLD.proof_type
       OR to_jsonb(NEW)->'proof_urls' IS DISTINCT FROM to_jsonb(OLD)->'proof_urls'
       OR to_jsonb(NEW)->'proof_types' IS DISTINCT FROM to_jsonb(OLD)->'proof_types' THEN
      v_event_type := 'incident.edited';
    ELSIF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.mdrrmo_response_status IS DISTINCT FROM OLD.mdrrmo_response_status
       OR NEW.barangay_response_status IS DISTINCT FROM OLD.barangay_response_status THEN
      v_event_type := 'incident.status_changed';
    END IF;

    IF v_event_type IS NULL THEN
      RETURN NEW;
    END IF;

    v_actor_id := COALESCE(
      NEW.lifecycle_actor_id,
      NEW.mdrrmo_resolved_by,
      NEW.mdrrmo_arrived_by,
      NEW.mdrrmo_accepted_by,
      NEW.mdrrmo_dispatched_by,
      NEW.mdrrmo_dispatcher_reviewed_by,
      NEW.reviewed_by,
      NEW.reporter_id
    );
    v_actor_role := COALESCE(
      NEW.lifecycle_actor_role,
      CASE
        WHEN v_event_type = 'incident.edited' AND NEW.reporter_type = 'resident' THEN 'resident'
        WHEN v_event_type = 'incident.reviewed' THEN 'dispatcher'
        WHEN v_event_type LIKE 'mdrrmo.%' THEN 'responder'
        ELSE 'operations'
      END
    );
    v_details := jsonb_build_object(
      'before', jsonb_build_object(
        'status', OLD.status,
        'review_outcome', OLD.review_outcome,
        'review_reason', OLD.review_reason,
        'reviewed_at', OLD.reviewed_at,
        'mdrrmo_response_status', OLD.mdrrmo_response_status,
        'barangay_response_status', OLD.barangay_response_status,
        'barangay_dispatched_at', OLD.barangay_dispatched_at,
        'barangay_accepted_at', OLD.barangay_accepted_at,
        'barangay_arrived_at', OLD.barangay_arrived_at,
        'barangay_resolved_at', OLD.barangay_resolved_at,
        'dispatcher_reviewed_at', OLD.dispatcher_reviewed_at,
        'dispatched_at', OLD.dispatched_at,
        'accepted_at', OLD.accepted_at,
        'arrived_at', OLD.arrived_at,
        'resolved_at', OLD.resolved_at,
        'mdrrmo_response_notes', OLD.mdrrmo_response_notes,
        'mdrrmo_coordination_notes', OLD.mdrrmo_coordination_notes,
        'responder_media', to_jsonb(OLD)->'responder_media',
        'description', OLD.description,
        'specifics', OLD.specifics,
        'proof_url', OLD.proof_url,
        'proof_type', OLD.proof_type,
        'proof_urls', to_jsonb(OLD)->'proof_urls',
        'proof_types', to_jsonb(OLD)->'proof_types'
      ),
      'after', jsonb_build_object(
        'status', NEW.status,
        'review_outcome', NEW.review_outcome,
        'review_reason', NEW.review_reason,
        'reviewed_at', NEW.reviewed_at,
        'mdrrmo_response_status', NEW.mdrrmo_response_status,
        'barangay_response_status', NEW.barangay_response_status,
        'barangay_dispatched_at', NEW.barangay_dispatched_at,
        'barangay_accepted_at', NEW.barangay_accepted_at,
        'barangay_arrived_at', NEW.barangay_arrived_at,
        'barangay_resolved_at', NEW.barangay_resolved_at,
        'dispatcher_reviewed_at', NEW.dispatcher_reviewed_at,
        'dispatched_at', NEW.dispatched_at,
        'accepted_at', NEW.accepted_at,
        'arrived_at', NEW.arrived_at,
        'resolved_at', NEW.resolved_at,
        'mdrrmo_response_notes', NEW.mdrrmo_response_notes,
        'mdrrmo_coordination_notes', NEW.mdrrmo_coordination_notes,
        'responder_media', to_jsonb(NEW)->'responder_media',
        'description', NEW.description,
        'specifics', NEW.specifics,
        'proof_url', NEW.proof_url,
        'proof_type', NEW.proof_type,
        'proof_urls', to_jsonb(NEW)->'proof_urls',
        'proof_types', to_jsonb(NEW)->'proof_types'
      )
    );
  END IF;

  INSERT INTO public.incident_report_lifecycle_history
    (report_id, event_type, actor_id, actor_role, details)
  VALUES
    (NEW.id, v_event_type, v_actor_id, v_actor_role, COALESCE(v_details, '{}'::jsonb));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incident_report_lifecycle_history_after_write ON public.incident_reports;
CREATE TRIGGER incident_report_lifecycle_history_after_write
  AFTER INSERT OR UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.audit_incident_report_lifecycle();

CREATE OR REPLACE FUNCTION public.audit_mdrrmo_assignment_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type TEXT;
  v_actor_id UUID;
  v_actor_role TEXT;
  v_before JSONB;
  v_after JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'mdrrmo.responder_assigned';
    v_actor_id := NEW.assigned_by;
    v_actor_role := 'dispatcher';
    v_before := NULL;
    v_after := to_jsonb(NEW);
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'responding' THEN
      v_event_type := 'mdrrmo.responder_accepted';
      v_actor_id := NEW.accepted_by;
      v_actor_role := 'responder';
    ELSIF NEW.arrived_at IS DISTINCT FROM OLD.arrived_at THEN
      v_event_type := 'mdrrmo.responder_arrived';
      v_actor_id := NEW.arrived_by;
      v_actor_role := 'responder';
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'resolved' THEN
      v_event_type := 'mdrrmo.response_resolved';
      v_actor_id := NEW.resolved_by;
      v_actor_role := COALESCE(NEW.resolved_by_role, 'responder');
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'removed' THEN
      v_event_type := 'mdrrmo.assignment_removed';
      v_actor_id := NEW.removed_by;
      v_actor_role := 'dispatcher';
    ELSIF NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
      v_event_type := 'mdrrmo.responder_assigned';
      v_actor_id := NEW.assigned_by;
      v_actor_role := 'dispatcher';
    END IF;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
  END IF;

  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.mdrrmo_report_lifecycle_history
    (report_id, event_type, actor_id, actor_role, details)
  VALUES
    (NEW.report_id, v_event_type, v_actor_id, v_actor_role,
     jsonb_build_object('before', v_before, 'after', v_after));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mdrrmo_assignment_lifecycle_history_after_write ON public.mdrrmo_report_assignments;
CREATE TRIGGER mdrrmo_assignment_lifecycle_history_after_write
  AFTER INSERT OR UPDATE ON public.mdrrmo_report_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_mdrrmo_assignment_lifecycle();

-- Serialize each MDRRMO transition with its responder assignment changes. The
-- backend still performs role, report-visibility, and evidence validation.
CREATE OR REPLACE FUNCTION public.dispatch_mdrrmo_report(
  p_report_id UUID,
  p_actor_id UUID,
  p_incident_type TEXT,
  p_severity TEXT,
  p_notes TEXT,
  p_responder_ids UUID[],
  p_responder_names TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_active_count INTEGER;
  v_dispatchable_count INTEGER;
BEGIN
  IF p_actor_id IS NULL OR p_incident_type IS NULL
     OR p_incident_type NOT IN ('flash_flood', 'fire', 'earthquake', 'medical_emergency', 'typhoon', 'other')
     OR p_severity IS NULL OR p_severity NOT IN ('low', 'moderate', 'high', 'critical')
     OR p_responder_ids IS NULL OR cardinality(p_responder_ids) < 1
     OR cardinality(p_responder_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_responder_ids) AS ids(id)) THEN
    RAISE EXCEPTION 'Invalid dispatch details' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.review_outcome IS NOT NULL
     OR v_report.mdrrmo_response_status NOT IN ('pending')
     OR (v_report.mdrrmo_response_status IS NULL
         AND NOT (v_report.status::TEXT = 'escalated' OR COALESCE(v_report.is_escalated, false)
           OR COALESCE(v_report.beyond_barangay_capability, false))
         AND v_report.status::TEXT IN ('resolved', 'closed'))
     OR v_report.mdrrmo_accepted_at IS NOT NULL
     OR v_report.mdrrmo_arrived_at IS NOT NULL
     OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Dispatch can only be changed before MDRRMO responder acceptance' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(DISTINCT id) INTO v_active_count
  FROM public.users
  WHERE id = ANY(p_responder_ids) AND role = 'responder' AND status = 'active';
  IF v_active_count <> cardinality(p_responder_ids) THEN
    RAISE EXCEPTION 'One or more selected MDRRMO responders are no longer active' USING ERRCODE = 'P0001';
  END IF;

  PERFORM units.id
  FROM public.respond_units AS units
  JOIN public.respond_unit_members AS leaders ON leaders.unit_id = units.id
  WHERE leaders.responder_user_id = ANY(p_responder_ids)
    AND leaders.member_role = 'team_leader'
    AND leaders.is_active
  ORDER BY units.id
  FOR SHARE OF units;

  SELECT count(DISTINCT selected.responder_id) INTO v_dispatchable_count
  FROM unnest(p_responder_ids) AS selected(responder_id)
  JOIN public.respond_unit_members AS leaders
    ON leaders.responder_user_id = selected.responder_id
   AND leaders.member_role = 'team_leader'
   AND leaders.is_active
  JOIN public.respond_units AS units
    ON units.id = leaders.unit_id
   AND units.status = 'available'
  JOIN public.respond_unit_daily_activations AS activations
    ON activations.unit_id = units.id
   AND activations.activation_date = timezone('Asia/Manila', v_now)::DATE
  JOIN public.users AS leader_accounts
    ON leader_accounts.id = leaders.responder_user_id
   AND leader_accounts.role::TEXT = 'responder'
   AND leader_accounts.status::TEXT = 'active'
  WHERE EXISTS (
    SELECT 1 FROM public.respond_unit_members AS drivers
    WHERE drivers.unit_id = units.id AND drivers.is_active
      AND drivers.member_role = 'driver_responder'
  )
    AND EXISTS (
      SELECT 1 FROM public.respond_unit_members AS first_aiders
      WHERE first_aiders.unit_id = units.id AND first_aiders.is_active
        AND first_aiders.member_role = 'first_aider_responder'
    );
  IF v_dispatchable_count <> cardinality(p_responder_ids) THEN
    RAISE EXCEPTION 'One or more selected responders do not belong to an available unit activated today with a complete roster' USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND status = 'responding'
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'Dispatch cannot be changed after a responder accepts the report' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.mdrrmo_report_assignments
  SET status = 'removed', removed_by = p_actor_id, removed_at = v_now
  WHERE report_id = p_report_id AND status = 'assigned';

  INSERT INTO public.mdrrmo_report_assignments (
    report_id, responder_id, assigned_by, status, assigned_at,
    accepted_at, arrived_at, resolved_at, accepted_by, arrived_by,
    resolved_by, resolved_by_role, removed_by, removed_at
  )
  SELECT p_report_id, selected.responder_id, p_actor_id, 'assigned', v_now,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM unnest(p_responder_ids) AS selected(responder_id)
  ON CONFLICT (report_id, responder_id) DO UPDATE SET
    assigned_by = EXCLUDED.assigned_by,
    status = 'assigned',
    assigned_at = EXCLUDED.assigned_at,
    accepted_at = NULL,
    arrived_at = NULL,
    resolved_at = NULL,
    accepted_by = NULL,
    arrived_by = NULL,
    resolved_by = NULL,
    resolved_by_role = NULL,
    removed_by = NULL,
    removed_at = NULL;

  UPDATE public.incident_reports
  SET incident_type = p_incident_type,
      severity = p_severity,
      status = (CASE
        WHEN status::TEXT = 'escalated'
          THEN 'escalated'
        ELSE 'verified'
      END)::public.report_status,
      mdrrmo_response_status = 'pending',
      mdrrmo_dispatch_notes = NULLIF(BTRIM(p_notes), ''),
      mdrrmo_responded_by = NULL,
      mdrrmo_responded_at = NULL,
      mdrrmo_accepted_by = NULL,
      mdrrmo_responder_name = p_responder_names,
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = 'dispatcher',
      mdrrmo_dispatcher_reviewed_by = p_actor_id,
      mdrrmo_dispatched_by = p_actor_id,
      dispatcher_reviewed_at = COALESCE(dispatcher_reviewed_at, v_now),
      mdrrmo_dispatcher_reviewed_at = v_now,
      dispatched_at = COALESCE(dispatched_at, v_now),
      mdrrmo_dispatched_at = v_now
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  RETURN to_jsonb(v_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_mdrrmo_report(
  p_report_id UUID,
  p_responder_id UUID,
  p_responder_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_responder_id IS NULL THEN
    RAISE EXCEPTION 'Responder is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.mdrrmo_dispatched_at IS NULL
     OR v_report.mdrrmo_response_status IS NULL
     OR v_report.mdrrmo_response_status NOT IN ('pending', 'responding')
     OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'A dispatcher must assign this report before responder acceptance' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_responder_id AND role = 'responder' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'MDRRMO responder account is not active' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND responder_id = p_responder_id AND status = 'assigned'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This report is not waiting for acceptance by your account' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.mdrrmo_report_assignments
  SET status = 'responding', accepted_at = v_now, accepted_by = p_responder_id
  WHERE id = v_assignment.id;

  UPDATE public.incident_reports
  SET status = 'responding',
      mdrrmo_response_status = 'responding',
      mdrrmo_responded_by = COALESCE(mdrrmo_responded_by, p_responder_id),
      mdrrmo_responder_name = COALESCE(mdrrmo_responder_name, p_responder_name),
      lifecycle_actor_id = p_responder_id,
      lifecycle_actor_role = 'responder',
      mdrrmo_accepted_by = COALESCE(mdrrmo_accepted_by, p_responder_id),
      mdrrmo_responded_at = COALESCE(mdrrmo_responded_at, v_now),
      accepted_at = COALESCE(accepted_at, v_now),
      mdrrmo_accepted_at = COALESCE(mdrrmo_accepted_at, v_now)
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  RETURN to_jsonb(v_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_mdrrmo_arrival(
  p_report_id UUID,
  p_responder_id UUID,
  p_arrival_at TIMESTAMPTZ,
  p_recorded_at TIMESTAMPTZ,
  p_method TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION,
  p_distance_m DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
BEGIN
  IF p_responder_id IS NULL OR p_arrival_at IS NULL OR p_recorded_at IS NULL
     OR p_method IS NULL OR p_method NOT IN ('manual', 'gps') THEN
    RAISE EXCEPTION 'Invalid arrival details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.mdrrmo_response_status IS DISTINCT FROM 'responding' OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Accept the report before recording arrival' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND responder_id = p_responder_id AND status = 'responding'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This report is not assigned to an active response for your account' USING ERRCODE = 'P0001';
  END IF;
  IF v_assignment.arrived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Arrival has already been recorded for this responder' USING ERRCODE = 'P0001';
  END IF;

  IF v_report.mdrrmo_arrived_at IS NULL THEN
    UPDATE public.incident_reports
    SET arrived_at = COALESCE(arrived_at, p_arrival_at),
        mdrrmo_arrived_at = p_arrival_at,
        arrival_recorded_at = CASE WHEN arrived_at IS NULL THEN p_recorded_at ELSE arrival_recorded_at END,
        arrival_method = CASE WHEN arrived_at IS NULL THEN p_method ELSE arrival_method END,
        arrival_latitude = CASE WHEN arrived_at IS NULL THEN p_latitude ELSE arrival_latitude END,
        arrival_longitude = CASE WHEN arrived_at IS NULL THEN p_longitude ELSE arrival_longitude END,
        arrival_accuracy_m = CASE WHEN arrived_at IS NULL THEN p_accuracy_m ELSE arrival_accuracy_m END,
        arrival_distance_m = CASE WHEN arrived_at IS NULL THEN p_distance_m ELSE arrival_distance_m END,
        lifecycle_actor_id = p_responder_id,
        lifecycle_actor_role = 'responder',
        mdrrmo_arrived_by = p_responder_id
    WHERE id = p_report_id
    RETURNING * INTO v_report;
  END IF;

  UPDATE public.mdrrmo_report_assignments
  SET arrived_at = p_arrival_at, arrived_by = p_responder_id
  WHERE id = v_assignment.id;

  RETURN to_jsonb(v_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_mdrrmo_report(
  p_report_id UUID,
  p_actor_id UUID,
  p_actor_role TEXT,
  p_resolved_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_is_escalated BOOLEAN;
  v_direct_to_mdrrmo BOOLEAN;
  v_barangay_engaged BOOLEAN;
  v_barangay_open BOOLEAN;
  v_overall_status TEXT;
  v_actor_role TEXT;
BEGIN
  IF p_actor_id IS NULL OR NULLIF(BTRIM(p_resolved_notes), '') IS NULL
     OR p_actor_role IS NULL OR p_actor_role NOT IN ('dispatcher', 'responder', 'admin', 'master_admin') THEN
    RAISE EXCEPTION 'A valid response summary and actor are required' USING ERRCODE = '22023';
  END IF;
  v_actor_role := CASE WHEN p_actor_role = 'responder' THEN 'responder' ELSE 'dispatcher' END;
  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.mdrrmo_response_status IS DISTINCT FROM 'responding' OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'The MDRRMO response is no longer active' USING ERRCODE = 'P0001';
  END IF;

  IF v_actor_role = 'responder' THEN
    SELECT * INTO v_assignment
    FROM public.mdrrmo_report_assignments
    WHERE report_id = p_report_id AND responder_id = p_actor_id AND status = 'responding'
      AND arrived_at IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Record arrival on an active assigned response before closing' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_report.mdrrmo_arrived_at IS NULL
     AND (v_report.barangay_arrived_at IS NOT NULL OR v_report.arrived_at IS NULL) THEN
    RAISE EXCEPTION 'A responder must record MDRRMO arrival before closing' USING ERRCODE = 'P0001';
  END IF;

  v_is_escalated := v_report.status::TEXT = 'escalated';
  v_direct_to_mdrrmo := COALESCE(LOWER(BTRIM(v_report.send_to)), '') = 'mdrrmo'
    OR LOWER(COALESCE(v_report.specifics, '') || ' ' || COALESCE(v_report.description, '')) ~ '\[send_to:mdrrmo\]';
  v_barangay_engaged := NOT v_direct_to_mdrrmo AND (
    v_is_escalated OR v_report.barangay_dispatched_at IS NOT NULL
    OR v_report.barangay_responded_by IS NOT NULL
    OR COALESCE(v_report.barangay_response_status, '') IN ('pending', 'responding', 'resolved')
  );
  v_barangay_open := COALESCE(v_barangay_engaged, false)
    AND COALESCE(v_report.barangay_response_status, '') <> 'resolved';
  v_overall_status := CASE
    WHEN NOT v_barangay_open THEN 'resolved'
    WHEN v_report.barangay_response_status = 'responding' THEN 'responding'
    WHEN v_is_escalated THEN 'escalated'
    WHEN v_report.status::TEXT IN ('resolved', 'closed') THEN
      CASE WHEN v_report.barangay_dispatched_at IS NOT NULL THEN 'verified' ELSE 'pending' END
    ELSE v_report.status::TEXT
  END;

  UPDATE public.incident_reports
  SET status = v_overall_status::public.report_status,
      mdrrmo_response_status = 'resolved',
      mdrrmo_resolved_notes = BTRIM(p_resolved_notes),
      mdrrmo_resolved_at = v_now,
      mdrrmo_resolved_by = p_actor_id,
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = v_actor_role,
      resolved_notes = CASE WHEN v_overall_status = 'resolved' THEN BTRIM(p_resolved_notes) ELSE NULL END,
      resolved_at = CASE WHEN v_overall_status = 'resolved' THEN v_now ELSE NULL END
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  UPDATE public.mdrrmo_report_assignments
  SET status = 'resolved', resolved_at = v_now, resolved_by = p_actor_id, resolved_by_role = v_actor_role
  WHERE report_id = p_report_id AND status <> 'removed';

  RETURN to_jsonb(v_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.append_mdrrmo_field_media(
  p_report_id UUID,
  p_actor_id UUID,
  p_actor_role TEXT,
  p_media_item JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_actor_role TEXT;
BEGIN
  IF p_actor_id IS NULL OR p_actor_role IS NULL
     OR p_actor_role NOT IN ('dispatcher', 'responder', 'admin', 'master_admin')
     OR p_media_item IS NULL OR jsonb_typeof(p_media_item) <> 'object' THEN
    RAISE EXCEPTION 'Invalid field media details' USING ERRCODE = '22023';
  END IF;
  v_actor_role := CASE WHEN p_actor_role = 'responder' THEN 'responder' ELSE 'dispatcher' END;
  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.mdrrmo_response_status IS DISTINCT FROM 'responding' OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Field media can only be added during an active MDRRMO response' USING ERRCODE = 'P0001';
  END IF;
  IF v_actor_role = 'responder' AND NOT EXISTS (
    SELECT 1 FROM public.mdrrmo_report_assignments
    WHERE report_id = p_report_id AND responder_id = p_actor_id AND status = 'responding'
  ) THEN
    RAISE EXCEPTION 'Field media can only be added during your active response' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.incident_reports
  SET responder_media = COALESCE(responder_media, '[]'::jsonb) || jsonb_build_array(p_media_item),
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = v_actor_role
  WHERE id = p_report_id
  RETURNING * INTO v_report;
  RETURN to_jsonb(v_report);
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_mdrrmo_report(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_mdrrmo_report(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_mdrrmo_arrival(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_mdrrmo_report(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_mdrrmo_field_media(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_mdrrmo_report(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_mdrrmo_report(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mdrrmo_arrival(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_mdrrmo_report(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_mdrrmo_field_media(UUID, UUID, TEXT, JSONB) TO service_role;

-- ===== Source section: database/migrations/separate_report_tables_phase1.sql =====
-- ============================================================
-- PHASE 1: SEPARATED REPORT TABLES MIGRATION
-- NorzAgapay — Barangay + MDRRMO Report Table Separation
-- 
-- Run in Supabase SQL Editor.
-- Safe to run while incident_reports still exists (additive only).
-- Old table and routes remain active until Phase 5.
-- ============================================================

-- Drop analytics view first so table column types can be altered without view dependency locks
DROP VIEW IF EXISTS public.v_all_reports CASCADE;

-- ============================================================
-- STEP 1: Create barangay_reports
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barangay_reports (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core report metadata
  type                      TEXT NOT NULL DEFAULT 'emergency',
  title                     TEXT NOT NULL,
  specifics                 TEXT,
  description               TEXT,
  latitude                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  longitude                 DOUBLE PRECISION NOT NULL DEFAULT 0,
  address                   TEXT,
  incident_occurred_at      TIMESTAMPTZ,
  incident_time_precision   TEXT NOT NULL DEFAULT 'unknown'
                              CHECK (incident_time_precision IN ('exact','approximate','unknown')),
  incident_type             TEXT,
  severity                  TEXT,

  -- Evidence
  proof_url                 TEXT,
  proof_urls                TEXT[] NOT NULL DEFAULT '{}',
  proof_type                TEXT NOT NULL DEFAULT 'image',
  proof_types               TEXT[] NOT NULL DEFAULT '{}',
  evidence_status           TEXT NOT NULL DEFAULT 'ready',
  responder_media           JSONB NOT NULL DEFAULT '[]',

  -- Reporter
  reporter_id               UUID REFERENCES public.resident_user(id) ON DELETE SET NULL,
  reporter_type             TEXT DEFAULT 'resident',
  reporter_name             TEXT,
  reporter_phone            TEXT,
  reporter_email            TEXT,

  -- Barangay routing
  barangay_id               UUID,

  -- Barangay lifecycle (clean column names, no prefix)
  response_status           TEXT NOT NULL DEFAULT 'pending'
                              CHECK (response_status IN ('pending','responding','resolved')),
  response_notes            TEXT,
  responder_name            TEXT,
  responded_by              UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  responded_at              TIMESTAMPTZ,

  -- Dispatcher timeline
  dispatcher_reviewed_by    UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  dispatcher_reviewed_at    TIMESTAMPTZ,
  dispatched_by             UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  dispatched_at             TIMESTAMPTZ,
  dispatch_notes            TEXT,

  -- Arrival
  accepted_at               TIMESTAMPTZ,
  arrived_at                TIMESTAMPTZ,
  arrival_recorded_at       TIMESTAMPTZ,
  arrival_method            TEXT,
  arrival_latitude          DOUBLE PRECISION,
  arrival_longitude         DOUBLE PRECISION,
  arrival_accuracy_m        DOUBLE PRECISION,
  arrival_distance_m        DOUBLE PRECISION,
  travel_distance_m         DOUBLE PRECISION,
  travel_distance_accuracy_m DOUBLE PRECISION,
  travel_distance_fix_at    TIMESTAMPTZ,

  -- Resolution
  resolved_at               TIMESTAMPTZ,
  resolved_by               UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  resolved_notes            TEXT,
  resolution_pdf_status     TEXT NOT NULL DEFAULT 'missing',
  resolution_pdf_path       TEXT,
  resolution_pdf_generated_at TIMESTAMPTZ,

  -- Dispatcher review / dismissal
  review_outcome            TEXT,
  review_reason             TEXT,
  reviewed_by               UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  reviewed_at               TIMESTAMPTZ,

  -- Escalation to MDRRMO
  escalated_to_mdrrmo       BOOLEAN NOT NULL DEFAULT false,
  escalated_at              TIMESTAMPTZ,
  mdrrmo_coordination_notes TEXT,

  -- Task linkage
  dispatch_incident_id      UUID,

  -- Lifecycle tracking
  lifecycle_revision        BIGINT NOT NULL DEFAULT 0,
  lifecycle_actor_id        UUID,
  lifecycle_actor_role      TEXT,
  client_request_id         UUID,
  client_submitted_at       TIMESTAMPTZ,

  -- Status (mirrors overall status for UX; separate from response_status lifecycle)
  status                    TEXT NOT NULL DEFAULT 'pending',

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all required columns exist in case barangay_reports already existed
ALTER TABLE public.barangay_reports
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'emergency',
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Incident Report',
  ADD COLUMN IF NOT EXISTS specifics TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS incident_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_time_precision TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS incident_type TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS proof_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS proof_type TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS proof_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS responder_media JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS reporter_id UUID,
  ADD COLUMN IF NOT EXISTS reporter_type TEXT DEFAULT 'resident',
  ADD COLUMN IF NOT EXISTS reporter_name TEXT,
  ADD COLUMN IF NOT EXISTS reporter_phone TEXT,
  ADD COLUMN IF NOT EXISTS reporter_email TEXT,
  ADD COLUMN IF NOT EXISTS barangay_id UUID,
  ADD COLUMN IF NOT EXISTS response_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS response_notes TEXT,
  ADD COLUMN IF NOT EXISTS responder_name TEXT,
  ADD COLUMN IF NOT EXISTS responded_by UUID,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_by UUID,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_notes TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_method TEXT,
  ADD COLUMN IF NOT EXISTS arrival_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_fix_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID,
  ADD COLUMN IF NOT EXISTS resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_status TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS resolution_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_outcome TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_to_mdrrmo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_coordination_notes TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_incident_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_role TEXT,
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Reconcile any pre-existing enum columns to TEXT safely
DO $$
BEGIN
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type TYPE TEXT USING type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type SET DEFAULT 'emergency'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_type TYPE TEXT USING incident_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type TYPE TEXT USING proof_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type SET DEFAULT 'image'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status TYPE TEXT USING evidence_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status SET DEFAULT 'ready'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type TYPE TEXT USING reporter_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type SET DEFAULT 'resident'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status TYPE TEXT USING resolution_pdf_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status SET DEFAULT 'missing'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision TYPE TEXT USING incident_time_precision::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision SET DEFAULT 'unknown'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS barangay_reports_client_request_id_uidx
  ON public.barangay_reports (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_barangay_reports_barangay_id
  ON public.barangay_reports (barangay_id, response_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_barangay_reports_created_at
  ON public.barangay_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_barangay_reports_response_status
  ON public.barangay_reports (response_status);

ALTER TABLE public.barangay_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.barangay_reports TO service_role;

-- ============================================================
-- STEP 2: Create barangay_report_assignments
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barangay_report_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES public.barangay_reports(id) ON DELETE CASCADE,
  responder_id  UUID NOT NULL REFERENCES public.barangay_users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'team_leader',
  status        TEXT NOT NULL DEFAULT 'assigned'
                  CHECK (status IN ('assigned','responding','resolved','removed')),
  assigned_by   UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ,
  arrived_at    TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  removed_at    TIMESTAMPTZ,
  removed_by    UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  UNIQUE (report_id, responder_id)
);

CREATE INDEX IF NOT EXISTS idx_barangay_report_assignments_responder
  ON public.barangay_report_assignments (responder_id, status, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_barangay_report_assignments_report
  ON public.barangay_report_assignments (report_id, status);

ALTER TABLE public.barangay_report_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_report_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.barangay_report_assignments TO service_role;

-- ============================================================
-- STEP 3: Create mdrrmo_reports
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mdrrmo_reports (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source tracking
  source_type                 TEXT NOT NULL DEFAULT 'direct'
                                CHECK (source_type IN ('direct','escalated')),
  source_barangay_report_id   UUID REFERENCES public.barangay_reports(id) ON DELETE SET NULL,

  -- Core report metadata
  type                        TEXT NOT NULL DEFAULT 'emergency',
  title                       TEXT NOT NULL,
  specifics                   TEXT,
  description                 TEXT,
  latitude                    DOUBLE PRECISION NOT NULL DEFAULT 0,
  longitude                   DOUBLE PRECISION NOT NULL DEFAULT 0,
  address                     TEXT,
  incident_occurred_at        TIMESTAMPTZ,
  incident_time_precision     TEXT NOT NULL DEFAULT 'unknown'
                                CHECK (incident_time_precision IN ('exact','approximate','unknown')),
  incident_type               TEXT,
  severity                    TEXT,

  -- Evidence
  proof_url                   TEXT,
  proof_urls                  TEXT[] NOT NULL DEFAULT '{}',
  proof_type                  TEXT NOT NULL DEFAULT 'image',
  proof_types                 TEXT[] NOT NULL DEFAULT '{}',
  evidence_status             TEXT NOT NULL DEFAULT 'ready',
  responder_media             JSONB NOT NULL DEFAULT '[]',

  -- Reporter (denormalized for display)
  reporter_id                 UUID,
  reporter_type               TEXT DEFAULT 'resident',
  reporter_name               TEXT,
  reporter_phone              TEXT,
  reporter_email              TEXT,

  -- Barangay context
  barangay_id                 UUID,
  barangay_name               TEXT,

  -- MDRRMO lifecycle (clean column names)
  response_status             TEXT NOT NULL DEFAULT 'pending'
                                CHECK (response_status IN ('pending','responding','resolved')),
  response_notes              TEXT,
  coordination_notes          TEXT,
  responder_name              TEXT,
  responded_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,
  responded_at                TIMESTAMPTZ,

  -- Dispatcher timeline
  dispatcher_reviewed_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  dispatcher_reviewed_at      TIMESTAMPTZ,
  dispatched_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,
  dispatched_at               TIMESTAMPTZ,
  dispatch_notes              TEXT,

  -- Arrival (tracked per-assignment in mdrrmo_report_assignments)
  accepted_at                 TIMESTAMPTZ,
  arrived_at                  TIMESTAMPTZ,

  -- Resolution
  resolved_at                 TIMESTAMPTZ,
  resolved_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_notes              TEXT,
  resolution_pdf_status       TEXT NOT NULL DEFAULT 'missing',
  resolution_pdf_path         TEXT,
  resolution_pdf_generated_at TIMESTAMPTZ,

  -- Task linkage
  dispatch_incident_id        UUID,

  -- Lifecycle tracking
  lifecycle_revision          BIGINT NOT NULL DEFAULT 0,
  lifecycle_actor_id          UUID,
  lifecycle_actor_role        TEXT,
  client_request_id           UUID,
  client_submitted_at         TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all required columns exist in case mdrrmo_reports already existed
ALTER TABLE public.mdrrmo_reports
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS source_barangay_report_id UUID,
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'emergency',
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Incident Report',
  ADD COLUMN IF NOT EXISTS specifics TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS incident_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_time_precision TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS incident_type TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS proof_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS proof_type TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS proof_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS responder_media JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS reporter_id UUID,
  ADD COLUMN IF NOT EXISTS reporter_type TEXT DEFAULT 'resident',
  ADD COLUMN IF NOT EXISTS reporter_name TEXT,
  ADD COLUMN IF NOT EXISTS reporter_phone TEXT,
  ADD COLUMN IF NOT EXISTS reporter_email TEXT,
  ADD COLUMN IF NOT EXISTS barangay_id UUID,
  ADD COLUMN IF NOT EXISTS barangay_name TEXT,
  ADD COLUMN IF NOT EXISTS response_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS response_notes TEXT,
  ADD COLUMN IF NOT EXISTS coordination_notes TEXT,
  ADD COLUMN IF NOT EXISTS responder_name TEXT,
  ADD COLUMN IF NOT EXISTS responded_by UUID,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_by UUID,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_notes TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID,
  ADD COLUMN IF NOT EXISTS resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_status TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS resolution_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_incident_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_role TEXT,
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Reconcile any pre-existing enum columns to TEXT safely
DO $$
BEGIN
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type TYPE TEXT USING type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type SET DEFAULT 'emergency'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_type TYPE TEXT USING incident_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type TYPE TEXT USING proof_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type SET DEFAULT 'image'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status TYPE TEXT USING evidence_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status SET DEFAULT 'ready'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type TYPE TEXT USING reporter_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type SET DEFAULT 'resident'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status TYPE TEXT USING resolution_pdf_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status SET DEFAULT 'missing'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type TYPE TEXT USING source_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type SET DEFAULT 'direct'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision TYPE TEXT USING incident_time_precision::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision SET DEFAULT 'unknown'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS mdrrmo_reports_client_request_id_uidx
  ON public.mdrrmo_reports (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mdrrmo_reports_response_status
  ON public.mdrrmo_reports (response_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mdrrmo_reports_created_at
  ON public.mdrrmo_reports (created_at DESC);

ALTER TABLE public.mdrrmo_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mdrrmo_reports TO service_role;

-- ============================================================
-- STEP 4: Lifecycle history tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barangay_report_lifecycle_history (
  id          BIGSERIAL PRIMARY KEY,
  report_id   UUID NOT NULL REFERENCES public.barangay_reports(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  actor_id    UUID,
  actor_role  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS barangay_report_lifecycle_history_report_idx
  ON public.barangay_report_lifecycle_history (report_id, occurred_at, id);

ALTER TABLE public.barangay_report_lifecycle_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_report_lifecycle_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.barangay_report_lifecycle_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.barangay_report_lifecycle_history_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_lifecycle_history (
  id          BIGSERIAL PRIMARY KEY,
  report_id   UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  actor_id    UUID,
  actor_role  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS mdrrmo_report_lifecycle_history_report_idx
  ON public.mdrrmo_report_lifecycle_history (report_id, occurred_at, id);

ALTER TABLE public.mdrrmo_report_lifecycle_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_report_lifecycle_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.mdrrmo_report_lifecycle_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mdrrmo_report_lifecycle_history_id_seq TO service_role;

-- ============================================================
-- STEP 5: Event outbox tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barangay_report_event_outbox (
  id           BIGSERIAL PRIMARY KEY,
  event_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  report_id    UUID NOT NULL REFERENCES public.barangay_reports(id) ON DELETE CASCADE,
  revision     BIGINT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error   TEXT,
  UNIQUE (report_id, revision)
);

CREATE INDEX IF NOT EXISTS barangay_report_event_outbox_pending_idx
  ON public.barangay_report_event_outbox (available_at, id)
  WHERE published_at IS NULL;

ALTER TABLE public.barangay_report_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_report_event_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.barangay_report_event_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.barangay_report_event_outbox_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_event_outbox (
  id           BIGSERIAL PRIMARY KEY,
  event_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  report_id    UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  revision     BIGINT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error   TEXT,
  UNIQUE (report_id, revision)
);

CREATE INDEX IF NOT EXISTS mdrrmo_report_event_outbox_pending_idx
  ON public.mdrrmo_report_event_outbox (available_at, id)
  WHERE published_at IS NULL;

ALTER TABLE public.mdrrmo_report_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_report_event_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mdrrmo_report_event_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mdrrmo_report_event_outbox_id_seq TO service_role;

-- ============================================================
-- STEP 6: Lifecycle revision triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_barangay_report_lifecycle_revision()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_snap JSONB; new_snap JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.lifecycle_revision := GREATEST(COALESCE(NEW.lifecycle_revision, 0), 1);
    RETURN NEW;
  END IF;
  old_snap := to_jsonb(OLD) - ARRAY['lifecycle_revision','updated_at'];
  new_snap := to_jsonb(NEW) - ARRAY['lifecycle_revision','updated_at'];
  IF old_snap IS DISTINCT FROM new_snap THEN
    NEW.lifecycle_revision := COALESCE(OLD.lifecycle_revision, 0) + 1;
    NEW.updated_at := now();
    INSERT INTO public.barangay_report_event_outbox (report_id, revision, event_type, payload)
    VALUES (NEW.id, NEW.lifecycle_revision, 'barangay_report.updated', to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS barangay_report_lifecycle_revision_before_write ON public.barangay_reports;
CREATE TRIGGER barangay_report_lifecycle_revision_before_write
  BEFORE INSERT OR UPDATE ON public.barangay_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_barangay_report_lifecycle_revision();

CREATE OR REPLACE FUNCTION public.set_mdrrmo_report_lifecycle_revision()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_snap JSONB; new_snap JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.lifecycle_revision := GREATEST(COALESCE(NEW.lifecycle_revision, 0), 1);
    RETURN NEW;
  END IF;
  old_snap := to_jsonb(OLD) - ARRAY['lifecycle_revision','updated_at'];
  new_snap := to_jsonb(NEW) - ARRAY['lifecycle_revision','updated_at'];
  IF old_snap IS DISTINCT FROM new_snap THEN
    NEW.lifecycle_revision := COALESCE(OLD.lifecycle_revision, 0) + 1;
    NEW.updated_at := now();
    INSERT INTO public.mdrrmo_report_event_outbox (report_id, revision, event_type, payload)
    VALUES (NEW.id, NEW.lifecycle_revision, 'mdrrmo_report.updated', to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mdrrmo_report_lifecycle_revision_before_write ON public.mdrrmo_reports;
CREATE TRIGGER mdrrmo_report_lifecycle_revision_before_write
  BEFORE INSERT OR UPDATE ON public.mdrrmo_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_mdrrmo_report_lifecycle_revision();

-- ============================================================
-- STEP 7: Outbox claim RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_mdrrmo_report_event_outbox(p_batch_size INT DEFAULT 50)
RETURNS SETOF public.mdrrmo_report_event_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '60 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.mdrrmo_report_event_outbox
  SET locked_until = v_lock_until, attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM public.mdrrmo_report_event_outbox
    WHERE published_at IS NULL
      AND available_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY available_at, id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_mdrrmo_report_event_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.claim_barangay_report_event_outbox(p_batch_size INT DEFAULT 50)
RETURNS SETOF public.barangay_report_event_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '60 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.barangay_report_event_outbox
  SET locked_until = v_lock_until, attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM public.barangay_report_event_outbox
    WHERE published_at IS NULL
      AND available_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY available_at, id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_barangay_report_event_outbox TO service_role;

-- ============================================================
-- STEP 8: New MDRRMO RPC functions (_v2 suffix, new table target)
-- ============================================================

CREATE OR REPLACE FUNCTION public.dispatch_mdrrmo_report_v2(
  p_report_id       UUID,
  p_actor_id        UUID,
  p_incident_type   TEXT,
  p_severity        TEXT,
  p_notes           TEXT,
  p_responder_ids   UUID[],
  p_responder_names TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_report public.mdrrmo_reports%ROWTYPE;
  v_now    TIMESTAMPTZ := clock_timestamp();
  v_active_count INTEGER;
  v_dispatchable_count INTEGER;
BEGIN
  IF p_actor_id IS NULL OR p_incident_type IS NULL
     OR p_incident_type NOT IN ('flash_flood','fire','earthquake','medical_emergency','typhoon','other')
     OR p_severity IS NULL OR p_severity NOT IN ('low','moderate','high','critical')
     OR p_responder_ids IS NULL OR cardinality(p_responder_ids) < 1
     OR cardinality(p_responder_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_responder_ids) AS ids(id))
  THEN
    RAISE EXCEPTION 'Invalid dispatch details' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report FROM public.mdrrmo_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MDRRMO report not found' USING ERRCODE = 'P0002'; END IF;
  IF v_report.response_status <> 'pending' THEN
    RAISE EXCEPTION 'Report already dispatched or resolved' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND status <> 'removed';
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Report already has active assignments' USING ERRCODE = '23514';
  END IF;

  -- Lock the unit rows after the report to serialize with activation and
  -- roster changes without reversing the report-to-unit lock order on accept.
  PERFORM units.id
  FROM public.respond_units AS units
  JOIN public.respond_unit_members AS leaders ON leaders.unit_id = units.id
  WHERE leaders.responder_user_id = ANY(p_responder_ids)
    AND leaders.member_role = 'team_leader'
    AND leaders.is_active
  ORDER BY units.id
  FOR SHARE OF units;

  SELECT count(DISTINCT selected.responder_id) INTO v_dispatchable_count
  FROM unnest(p_responder_ids) AS selected(responder_id)
  JOIN public.respond_unit_members AS leaders
    ON leaders.responder_user_id = selected.responder_id
   AND leaders.member_role = 'team_leader'
   AND leaders.is_active
  JOIN public.respond_units AS units
    ON units.id = leaders.unit_id
   AND units.status = 'available'
  JOIN public.respond_unit_daily_activations AS activations
    ON activations.unit_id = units.id
   AND activations.activation_date = timezone('Asia/Manila', v_now)::DATE
  JOIN public.users AS leader_accounts
    ON leader_accounts.id = leaders.responder_user_id
   AND leader_accounts.role::TEXT = 'responder'
   AND leader_accounts.status::TEXT = 'active'
  WHERE EXISTS (
    SELECT 1 FROM public.respond_unit_members AS drivers
    WHERE drivers.unit_id = units.id AND drivers.is_active
      AND drivers.member_role = 'driver_responder'
  )
    AND EXISTS (
      SELECT 1 FROM public.respond_unit_members AS first_aiders
      WHERE first_aiders.unit_id = units.id AND first_aiders.is_active
        AND first_aiders.member_role = 'first_aider_responder'
    );
  IF v_dispatchable_count <> cardinality(p_responder_ids) THEN
    RAISE EXCEPTION 'One or more selected responders do not belong to an available unit activated today with a complete roster' USING ERRCODE = '23514';
  END IF;

  UPDATE public.mdrrmo_reports SET
    incident_type        = p_incident_type,
    severity             = p_severity,
    dispatch_notes       = p_notes,
    responder_name       = p_responder_names,
    dispatched_by        = p_actor_id,
    dispatched_at        = v_now,
    lifecycle_actor_id   = p_actor_id,
    lifecycle_actor_role = 'dispatcher'
  WHERE id = p_report_id;

  INSERT INTO public.mdrrmo_report_assignments (report_id, responder_id, assigned_by, status, assigned_at)
  SELECT p_report_id, unnest(p_responder_ids), p_actor_id, 'assigned', v_now;

  RETURN jsonb_build_object('dispatched_at', v_now, 'responder_count', cardinality(p_responder_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_mdrrmo_report_v2 TO service_role;

-- --

CREATE OR REPLACE FUNCTION public.accept_mdrrmo_report_v2(
  p_report_id    UUID,
  p_responder_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE public.mdrrmo_report_assignments SET
    status      = 'responding',
    accepted_at = v_now,
    accepted_by = p_responder_id
  WHERE report_id = p_report_id AND responder_id = p_responder_id AND status = 'assigned';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or already accepted' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mdrrmo_reports SET
    response_status      = 'responding',
    accepted_at          = v_now,
    lifecycle_actor_id   = p_responder_id,
    lifecycle_actor_role = 'responder'
  WHERE id = p_report_id AND response_status = 'pending';

  RETURN jsonb_build_object('accepted_at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_mdrrmo_report_v2 TO service_role;

-- --

CREATE OR REPLACE FUNCTION public.record_mdrrmo_arrival_v2(
  p_report_id    UUID,
  p_responder_id UUID,
  p_arrived_at   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_arrived_at, clock_timestamp());
BEGIN
  UPDATE public.mdrrmo_report_assignments SET
    arrived_at = v_now, arrived_by = p_responder_id
  WHERE report_id = p_report_id AND responder_id = p_responder_id
    AND status IN ('assigned','responding') AND arrived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or arrival already recorded' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mdrrmo_reports SET
    arrived_at = v_now, lifecycle_actor_id = p_responder_id, lifecycle_actor_role = 'responder'
  WHERE id = p_report_id AND arrived_at IS NULL;

  RETURN jsonb_build_object('arrived_at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_mdrrmo_arrival_v2 TO service_role;

-- --

CREATE OR REPLACE FUNCTION public.append_mdrrmo_field_media_v2(
  p_report_id    UUID,
  p_responder_id UUID,
  p_media_items  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current JSONB;
BEGIN
  SELECT responder_media INTO v_current FROM public.mdrrmo_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MDRRMO report not found' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.mdrrmo_reports SET
    responder_media      = COALESCE(v_current,'[]'::jsonb) || p_media_items,
    lifecycle_actor_id   = p_responder_id,
    lifecycle_actor_role = 'responder'
  WHERE id = p_report_id;

  RETURN jsonb_build_object('appended', jsonb_array_length(p_media_items));
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_mdrrmo_field_media_v2 TO service_role;

-- --

CREATE OR REPLACE FUNCTION public.close_mdrrmo_report_v2(
  p_report_id        UUID,
  p_actor_id         UUID,
  p_actor_role       TEXT,
  p_resolution_notes TEXT,
  p_response_notes   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE public.mdrrmo_reports SET
    response_status      = 'resolved',
    resolved_at          = v_now,
    resolved_by          = p_actor_id,
    resolved_notes       = p_resolution_notes,
    response_notes       = COALESCE(p_response_notes, response_notes),
    lifecycle_actor_id   = p_actor_id,
    lifecycle_actor_role = p_actor_role
  WHERE id = p_report_id AND response_status IN ('pending','responding');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found or already resolved' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mdrrmo_report_assignments SET
    status = 'resolved', resolved_at = v_now,
    resolved_by = p_actor_id, resolved_by_role = p_actor_role
  WHERE report_id = p_report_id AND status IN ('assigned','responding');

  RETURN jsonb_build_object('resolved_at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_mdrrmo_report_v2 TO service_role;

-- ============================================================
-- STEP 9: Barangay review RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.review_barangay_report(
  p_report_id UUID,
  p_actor_id  UUID,
  p_outcome   TEXT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_outcome NOT IN ('approved','rejected','dismissed') THEN
    RAISE EXCEPTION 'Invalid review outcome' USING ERRCODE = '22023';
  END IF;

  UPDATE public.barangay_reports SET
    review_outcome       = p_outcome,
    review_reason        = p_reason,
    reviewed_by          = p_actor_id,
    reviewed_at          = v_now,
    lifecycle_actor_id   = p_actor_id,
    lifecycle_actor_role = 'dispatcher'
  WHERE id = p_report_id AND review_outcome IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found or already reviewed' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('reviewed_at', v_now, 'outcome', p_outcome);
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_barangay_report TO service_role;

-- ============================================================
-- STEP 10: Analytics UNION view
-- ============================================================

-- Drop view first so alter column types are never blocked by view dependencies
DROP VIEW IF EXISTS public.v_all_reports CASCADE;

-- Reconcile column types in case an older table had enum types
DO $$
BEGIN
  -- ── barangay_reports reconciliations ──
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type TYPE TEXT USING type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type SET DEFAULT 'emergency'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_type TYPE TEXT USING incident_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type TYPE TEXT USING proof_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type SET DEFAULT 'image'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status TYPE TEXT USING evidence_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status SET DEFAULT 'ready'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type TYPE TEXT USING reporter_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type SET DEFAULT 'resident'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status TYPE TEXT USING resolution_pdf_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status SET DEFAULT 'missing'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision TYPE TEXT USING incident_time_precision::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision SET DEFAULT 'unknown'; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── mdrrmo_reports reconciliations ──
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type TYPE TEXT USING type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type SET DEFAULT 'emergency'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_type TYPE TEXT USING incident_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type TYPE TEXT USING proof_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type SET DEFAULT 'image'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status TYPE TEXT USING evidence_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status SET DEFAULT 'ready'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type TYPE TEXT USING reporter_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type SET DEFAULT 'resident'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status TYPE TEXT USING resolution_pdf_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status SET DEFAULT 'missing'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type TYPE TEXT USING source_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type SET DEFAULT 'direct'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision TYPE TEXT USING incident_time_precision::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision SET DEFAULT 'unknown'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE OR REPLACE VIEW public.v_all_reports AS
  SELECT
    id,
    'barangay'::TEXT                 AS table_source,
    type::TEXT                       AS type,
    title::TEXT                      AS title,
    specifics::TEXT                  AS specifics,
    description::TEXT                AS description,
    latitude::DOUBLE PRECISION       AS latitude,
    longitude::DOUBLE PRECISION      AS longitude,
    address::TEXT                    AS address,
    incident_occurred_at             AS incident_occurred_at,
    incident_type::TEXT              AS incident_type,
    severity::TEXT                   AS severity,
    reporter_name::TEXT              AS reporter_name,
    reporter_phone::TEXT             AS reporter_phone,
    barangay_id                      AS barangay_id,
    response_status::TEXT            AS barangay_response_status,
    NULL::TEXT                       AS mdrrmo_response_status,
    review_outcome::TEXT             AS review_outcome,
    escalated_to_mdrrmo::BOOLEAN     AS is_escalated,
    created_at                       AS created_at
  FROM public.barangay_reports

  UNION ALL

  SELECT
    id,
    'mdrrmo'::TEXT                   AS table_source,
    type::TEXT                       AS type,
    title::TEXT                      AS title,
    specifics::TEXT                  AS specifics,
    description::TEXT                AS description,
    latitude::DOUBLE PRECISION       AS latitude,
    longitude::DOUBLE PRECISION      AS longitude,
    address::TEXT                    AS address,
    incident_occurred_at             AS incident_occurred_at,
    incident_type::TEXT              AS incident_type,
    severity::TEXT                   AS severity,
    reporter_name::TEXT              AS reporter_name,
    reporter_phone::TEXT             AS reporter_phone,
    barangay_id                      AS barangay_id,
    NULL::TEXT                       AS barangay_response_status,
    response_status::TEXT            AS mdrrmo_response_status,
    NULL::TEXT                       AS review_outcome,
    (source_type = 'escalated')::BOOLEAN AS is_escalated,
    created_at                       AS created_at
  FROM public.mdrrmo_reports;

GRANT SELECT ON public.v_all_reports TO service_role;

-- ============================================================
-- STEP 11: Backfill from incident_reports
-- Safe & dynamic: introspects existing columns in incident_reports
-- and casts enums to TEXT to avoid any type/value mismatch.
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.has_col(p_col TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incident_reports' AND column_name = p_col
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.col_text(p_col TEXT, p_fallback TEXT DEFAULT 'NULL')
RETURNS TEXT AS $$
BEGIN
  IF pg_temp.has_col(p_col) THEN
    IF p_fallback IS NOT NULL AND p_fallback <> 'NULL' THEN
      RETURN 'COALESCE(' || quote_ident(p_col) || '::TEXT, ' || p_fallback || ')';
    ELSE
      RETURN quote_ident(p_col) || '::TEXT';
    END IF;
  ELSE
    RETURN p_fallback;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.col_raw(p_col TEXT, p_fallback TEXT DEFAULT 'NULL')
RETURNS TEXT AS $$
BEGIN
  IF pg_temp.has_col(p_col) THEN
    IF p_fallback IS NOT NULL AND p_fallback <> 'NULL' THEN
      RETURN 'COALESCE(' || quote_ident(p_col) || ', ' || p_fallback || ')';
    ELSE
      RETURN quote_ident(p_col);
    END IF;
  ELSE
    RETURN p_fallback;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.coalesce_text(p_cols TEXT[], p_fallback TEXT DEFAULT 'NULL')
RETURNS TEXT AS $$
DECLARE
  c TEXT;
  existing TEXT[] := '{}';
BEGIN
  FOREACH c IN ARRAY p_cols LOOP
    IF pg_temp.has_col(c) THEN
      existing := array_append(existing, quote_ident(c) || '::TEXT');
    END IF;
  END LOOP;

  IF array_length(existing, 1) > 0 THEN
    RETURN 'COALESCE(' || array_to_string(existing, ', ') || ', ' || p_fallback || ')';
  ELSE
    RETURN p_fallback;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.coalesce_raw(p_cols TEXT[], p_fallback TEXT DEFAULT 'NULL')
RETURNS TEXT AS $$
DECLARE
  c TEXT;
  existing TEXT[] := '{}';
BEGIN
  FOREACH c IN ARRAY p_cols LOOP
    IF pg_temp.has_col(c) THEN
      existing := array_append(existing, quote_ident(c));
    END IF;
  END LOOP;

  IF array_length(existing, 1) > 0 THEN
    RETURN 'COALESCE(' || array_to_string(existing, ', ') || ', ' || p_fallback || ')';
  ELSE
    RETURN p_fallback;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_sql TEXT;
BEGIN
  -- Reconcile any pre-existing enum columns to TEXT to guarantee insert compatibility
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── 1. Backfill barangay_reports ───────────────────────────────────────────
  v_sql := 'INSERT INTO public.barangay_reports (
      id, type, title, specifics, description,
      latitude, longitude, address,
      incident_occurred_at, incident_time_precision, incident_type, severity,
      proof_url, proof_urls, proof_type, proof_types, evidence_status, responder_media,
      reporter_id, reporter_type, reporter_name, reporter_phone, reporter_email,
      barangay_id,
      response_status, response_notes, responder_name, responded_by,
      dispatcher_reviewed_at, dispatched_at, accepted_at, arrived_at,
      travel_distance_m, travel_distance_accuracy_m, travel_distance_fix_at,
      arrival_recorded_at, arrival_method,
      arrival_latitude, arrival_longitude, arrival_accuracy_m, arrival_distance_m,
      resolved_at, resolved_notes,
      resolution_pdf_status, resolution_pdf_path, resolution_pdf_generated_at,
      review_outcome, review_reason, reviewed_by, reviewed_at,
      escalated_to_mdrrmo, escalated_at, mdrrmo_coordination_notes,
      dispatch_incident_id,
      lifecycle_revision, lifecycle_actor_id, lifecycle_actor_role,
      client_request_id, client_submitted_at, status, created_at
    )
    SELECT
      id, '
      || pg_temp.col_text('type', '''emergency''') || ', '
      || pg_temp.col_text('title', '''Incident Report''') || ', '
      || pg_temp.col_text('specifics', 'NULL::TEXT') || ', '
      || pg_temp.col_text('description', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('latitude', '0::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('longitude', '0::DOUBLE PRECISION') || ', '
      || pg_temp.col_text('address', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('incident_occurred_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('incident_time_precision', '''unknown''') || ', '
      || pg_temp.col_text('incident_type', 'NULL::TEXT') || ', '
      || pg_temp.col_text('severity', 'NULL::TEXT') || ', '
      || pg_temp.col_text('proof_url', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('proof_urls', 'ARRAY[]::TEXT[]') || ', '
      || pg_temp.col_text('proof_type', '''image''') || ', '
      || pg_temp.col_raw('proof_types', 'ARRAY[]::TEXT[]') || ', '
      || pg_temp.col_text('evidence_status', '''ready''') || ', '
      || pg_temp.col_raw('responder_media', '''[]''::JSONB') || ', '
      || pg_temp.col_raw('reporter_id', 'NULL::UUID') || ', '
      || pg_temp.col_text('reporter_type', '''resident''') || ', '
      || pg_temp.col_text('reporter_name', 'NULL::TEXT') || ', '
      || pg_temp.col_text('reporter_phone', 'NULL::TEXT') || ', '
      || pg_temp.col_text('reporter_email', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('barangay_id', 'NULL::UUID') || ', '
      || 'CASE
        -- Escalated + received by barangay responder (accepted/responded) OR MDRRMO accepted/responding → barangay resolution complete
        WHEN (' ||
          CASE WHEN pg_temp.has_col('status') THEN 'status::TEXT = ''escalated''' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('is_escalated') THEN 'COALESCE(is_escalated, false) = true' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('beyond_barangay_capability') THEN 'COALESCE(beyond_barangay_capability, false) = true' ELSE 'FALSE' END || '
        ) AND (' ||
          CASE WHEN pg_temp.has_col('barangay_accepted_at') THEN 'barangay_accepted_at IS NOT NULL' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('accepted_at') THEN 'accepted_at IS NOT NULL' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('barangay_responded_by') THEN 'barangay_responded_by IS NOT NULL' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('mdrrmo_accepted_at') THEN 'mdrrmo_accepted_at IS NOT NULL' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('mdrrmo_response_status') THEN 'lower(COALESCE(mdrrmo_response_status::TEXT, '''')) IN (''responding'', ''resolved'')' ELSE 'FALSE' END || '
        ) THEN ''resolved''
        -- Standard resolved
        WHEN lower(COALESCE(' || pg_temp.col_text('barangay_response_status', '''pending''') || ', ''pending'')) IN (''resolved'', ''completed'')
          OR lower(COALESCE(' || pg_temp.col_text('status', '''pending''') || ', ''pending'')) IN (''resolved'', ''completed'') THEN ''resolved''
        -- Responding
        WHEN lower(COALESCE(' || pg_temp.col_text('barangay_response_status', '''pending''') || ', ''pending'')) IN (''responding'', ''in_progress'') THEN ''responding''
        ELSE ''pending''
      END, '
      || pg_temp.col_text('barangay_response_notes', 'NULL::TEXT') || ', '
      || pg_temp.col_text('barangay_responder_name', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('barangay_responded_by', 'NULL::UUID') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_dispatcher_reviewed_at', 'dispatcher_reviewed_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_dispatched_at', 'dispatched_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_accepted_at', 'accepted_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_arrived_at', 'arrived_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('travel_distance_m', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('travel_distance_accuracy_m', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('travel_distance_fix_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('arrival_recorded_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('arrival_method', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('arrival_latitude', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('arrival_longitude', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('arrival_accuracy_m', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('arrival_distance_m', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_resolved_at', 'resolved_at', 'mdrrmo_resolved_at', 'barangay_accepted_at', 'accepted_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_text(ARRAY['barangay_resolved_notes', 'resolved_notes'], 'NULL::TEXT') || ', '
      || pg_temp.col_text('resolution_pdf_status', '''missing''') || ', '
      || pg_temp.col_text('resolution_pdf_path', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('resolution_pdf_generated_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('review_outcome', 'NULL::TEXT') || ', '
      || pg_temp.col_text('review_reason', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('reviewed_by', 'NULL::UUID') || ', '
      || pg_temp.col_raw('reviewed_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['is_escalated', 'beyond_barangay_capability'], 'false') || ', '
      || pg_temp.coalesce_raw(ARRAY['escalated_at', 'mdrrmo_dispatched_at', 'barangay_responded_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('mdrrmo_coordination_notes', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('dispatch_incident_id', 'NULL::UUID') || ', '
      || pg_temp.col_raw('lifecycle_revision', '0') || ', '
      || pg_temp.col_raw('lifecycle_actor_id', 'NULL::UUID') || ', '
      || pg_temp.col_text('lifecycle_actor_role', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('client_request_id', 'NULL::UUID') || ', '
      || pg_temp.col_raw('client_submitted_at', 'NULL::TIMESTAMPTZ') || ', '
      || 'CASE
        WHEN (' ||
          CASE WHEN pg_temp.has_col('status') THEN 'status::TEXT = ''escalated''' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('is_escalated') THEN 'COALESCE(is_escalated, false) = true' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('beyond_barangay_capability') THEN 'COALESCE(beyond_barangay_capability, false) = true' ELSE 'FALSE' END || '
        ) THEN ''escalated''
        WHEN lower(COALESCE(' || pg_temp.col_text('barangay_response_status', '''pending''') || ', ''pending'')) IN (''resolved'', ''completed'')
          OR lower(COALESCE(' || pg_temp.col_text('status', '''pending''') || ', ''pending'')) IN (''resolved'', ''completed'') THEN ''resolved''
        WHEN lower(COALESCE(' || pg_temp.col_text('barangay_response_status', '''pending''') || ', ''pending'')) IN (''responding'', ''in_progress'') THEN ''responding''
        ELSE ''pending''
      END, '
      || pg_temp.col_raw('created_at', 'now()')
      || ' FROM public.incident_reports
         WHERE ' || CASE
           WHEN pg_temp.has_col('send_to') THEN '(send_to::TEXT IN (''barangay'', ''all'') OR send_to IS NULL)'
           ELSE 'TRUE'
         END || '
         ON CONFLICT (id) DO NOTHING;';

  EXECUTE v_sql;
  RAISE NOTICE 'barangay_reports backfill executed successfully.';

  -- ── 2. Backfill mdrrmo_reports ─────────────────────────────────────────────
  v_sql := 'INSERT INTO public.mdrrmo_reports (
      id, source_type,
      type, title, specifics, description,
      latitude, longitude, address,
      incident_occurred_at, incident_time_precision, incident_type, severity,
      proof_url, proof_urls, proof_type, proof_types, evidence_status, responder_media,
      reporter_id, reporter_type, reporter_name, reporter_phone, reporter_email,
      barangay_id,
      response_status, response_notes, coordination_notes,
      responder_name, responded_by,
      dispatched_at, dispatch_notes, accepted_at, arrived_at,
      resolved_at, resolved_notes,
      resolution_pdf_status, resolution_pdf_path, resolution_pdf_generated_at,
      dispatch_incident_id,
      lifecycle_revision, lifecycle_actor_id, lifecycle_actor_role,
      client_request_id, client_submitted_at, created_at
    )
    SELECT
      id,
      CASE
        WHEN ' ||
          CASE WHEN pg_temp.has_col('status') THEN 'status::TEXT = ''escalated''' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('is_escalated') THEN 'COALESCE(is_escalated, false) = true' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('beyond_barangay_capability') THEN 'COALESCE(beyond_barangay_capability, false) = true' ELSE 'FALSE' END || '
        THEN ''escalated'' ELSE ''direct''
      END, '
      || pg_temp.col_text('type', '''emergency''') || ', '
      || pg_temp.col_text('title', '''Incident Report''') || ', '
      || pg_temp.col_text('specifics', 'NULL::TEXT') || ', '
      || pg_temp.col_text('description', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('latitude', '0::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('longitude', '0::DOUBLE PRECISION') || ', '
      || pg_temp.col_text('address', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('incident_occurred_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('incident_time_precision', '''unknown''') || ', '
      || pg_temp.col_text('incident_type', 'NULL::TEXT') || ', '
      || pg_temp.col_text('severity', 'NULL::TEXT') || ', '
      || pg_temp.col_text('proof_url', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('proof_urls', 'ARRAY[]::TEXT[]') || ', '
      || pg_temp.col_text('proof_type', '''image''') || ', '
      || pg_temp.col_raw('proof_types', 'ARRAY[]::TEXT[]') || ', '
      || pg_temp.col_text('evidence_status', '''ready''') || ', '
      || pg_temp.col_raw('responder_media', '''[]''::JSONB') || ', '
      || pg_temp.col_raw('reporter_id', 'NULL::UUID') || ', '
      || pg_temp.col_text('reporter_type', '''resident''') || ', '
      || pg_temp.col_text('reporter_name', 'NULL::TEXT') || ', '
      || pg_temp.col_text('reporter_phone', 'NULL::TEXT') || ', '
      || pg_temp.col_text('reporter_email', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('barangay_id', 'NULL::UUID') || ', '
      || 'CASE
        WHEN lower(COALESCE(' || pg_temp.col_text('mdrrmo_response_status', '''pending''') || ', ''pending'')) IN (''responding'', ''in_progress'') THEN ''responding''
        WHEN lower(COALESCE(' || pg_temp.col_text('mdrrmo_response_status', '''pending''') || ', ''pending'')) IN (''resolved'', ''completed'') THEN ''resolved''
        ELSE ''pending''
      END, '
      || pg_temp.col_text('mdrrmo_response_notes', 'NULL::TEXT') || ', '
      || pg_temp.col_text('mdrrmo_coordination_notes', 'NULL::TEXT') || ', '
      || pg_temp.col_text('mdrrmo_responder_name', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('mdrrmo_responded_by', 'NULL::UUID') || ', '
      || pg_temp.coalesce_raw(ARRAY['mdrrmo_dispatched_at', 'dispatched_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('mdrrmo_dispatch_notes', 'NULL::TEXT') || ', '
      || pg_temp.coalesce_raw(ARRAY['mdrrmo_accepted_at', 'accepted_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['mdrrmo_arrived_at', 'arrived_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['mdrrmo_resolved_at', 'resolved_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_text(ARRAY['mdrrmo_resolved_notes', 'resolved_notes'], 'NULL::TEXT') || ', '
      || pg_temp.col_text('resolution_pdf_status', '''missing''') || ', '
      || pg_temp.col_text('resolution_pdf_path', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('resolution_pdf_generated_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('dispatch_incident_id', 'NULL::UUID') || ', '
      || pg_temp.col_raw('lifecycle_revision', '0') || ', '
      || pg_temp.col_raw('lifecycle_actor_id', 'NULL::UUID') || ', '
      || pg_temp.col_text('lifecycle_actor_role', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('client_request_id', 'NULL::UUID') || ', '
      || pg_temp.col_raw('client_submitted_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('created_at', 'now()')
      || ' FROM public.incident_reports
         WHERE (' ||
           CASE WHEN pg_temp.has_col('send_to') THEN 'send_to::TEXT = ''mdrrmo''' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('type') THEN 'type::TEXT = ''emergency''' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('status') THEN 'status::TEXT = ''escalated''' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('is_escalated') THEN 'COALESCE(is_escalated, false) = true' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('beyond_barangay_capability') THEN 'COALESCE(beyond_barangay_capability, false) = true' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('mdrrmo_response_status') THEN 'mdrrmo_response_status::TEXT IN (''responding'', ''resolved'')' ELSE 'FALSE' END || '
         )
         ON CONFLICT (id) DO NOTHING;';

  EXECUTE v_sql;
  RAISE NOTICE 'mdrrmo_reports backfill executed successfully.';

  -- Wire escalated mdrrmo_reports back to their barangay source
  UPDATE public.mdrrmo_reports mr
  SET source_barangay_report_id = br.id
  FROM public.barangay_reports br
  WHERE mr.id = br.id
    AND mr.source_type = 'escalated'
    AND mr.source_barangay_report_id IS NULL;

  RAISE NOTICE 'Source backlink wiring completed.';
END;
$$;

-- Clean up temporary helper functions
DROP FUNCTION IF EXISTS pg_temp.has_col(TEXT);
DROP FUNCTION IF EXISTS pg_temp.col_text(TEXT, TEXT);
DROP FUNCTION IF EXISTS pg_temp.col_raw(TEXT, TEXT);
DROP FUNCTION IF EXISTS pg_temp.coalesce_text(TEXT[], TEXT);
DROP FUNCTION IF EXISTS pg_temp.coalesce_raw(TEXT[], TEXT);

-- Verify row counts
SELECT 'incident_reports (old)' AS table_name, count(*) AS total_rows FROM public.incident_reports
UNION ALL SELECT 'barangay_reports (new)', count(*) FROM public.barangay_reports
UNION ALL SELECT 'mdrrmo_reports (new)',   count(*) FROM public.mdrrmo_reports;

-- ===== Source section: database/migrations/dispatcher_push_notifications_migration.sql =====
-- Dispatcher push notifications for new resident reports.
-- Run in the Supabase SQL editor after separate_report_tables_phase1.sql.

CREATE TABLE IF NOT EXISTS public.dispatcher_push_tokens (
  fcm_token   TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.barangay_users(id) ON DELETE CASCADE,
  barangay_id UUID NOT NULL,
  platform    TEXT NOT NULL CHECK (platform = 'android'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatcher_push_tokens_barangay_idx
  ON public.dispatcher_push_tokens (barangay_id, user_id);

ALTER TABLE public.dispatcher_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dispatcher_push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dispatcher_push_tokens TO service_role;

CREATE TABLE IF NOT EXISTS public.dispatcher_push_outbox (
  id           BIGSERIAL PRIMARY KEY,
  report_id    UUID NOT NULL UNIQUE REFERENCES public.barangay_reports(id) ON DELETE CASCADE,
  barangay_id  UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  delivered_tokens TEXT[] NOT NULL DEFAULT '{}',
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error   TEXT
);

ALTER TABLE public.dispatcher_push_outbox
  ADD COLUMN IF NOT EXISTS delivered_tokens TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS dispatcher_push_outbox_pending_idx
  ON public.dispatcher_push_outbox (available_at, id)
  WHERE processed_at IS NULL;

ALTER TABLE public.dispatcher_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dispatcher_push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dispatcher_push_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dispatcher_push_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_dispatcher_report_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reporter_type = 'resident' AND NEW.barangay_id IS NOT NULL THEN
    INSERT INTO public.dispatcher_push_outbox (report_id, barangay_id)
    VALUES (NEW.id, NEW.barangay_id)
    ON CONFLICT (report_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS barangay_report_push_after_insert ON public.barangay_reports;
CREATE TRIGGER barangay_report_push_after_insert
  AFTER INSERT ON public.barangay_reports
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_dispatcher_report_push();

CREATE OR REPLACE FUNCTION public.claim_dispatcher_push_outbox(p_batch_size INTEGER DEFAULT 25)
RETURNS SETOF public.dispatcher_push_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '90 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.dispatcher_push_outbox AS events
  SET locked_until = v_lock_until,
      attempts = events.attempts + 1
  WHERE events.id IN (
    SELECT pending.id
    FROM public.dispatcher_push_outbox AS pending
    WHERE pending.processed_at IS NULL
      AND pending.available_at <= now()
      AND (pending.locked_until IS NULL OR pending.locked_until < now())
    ORDER BY pending.available_at, pending.id
    LIMIT GREATEST(1, LEAST(p_batch_size, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING events.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dispatcher_push_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dispatcher_push_outbox(INTEGER) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'dispatcher_push_outbox'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatcher_push_outbox;
  END IF;
END $$;

-- ===== Source section: database/migrations/resident_report_status_push_migration.sql =====
-- Android push notifications for meaningful resident incident-report status changes.
-- Run after separate_report_tables_phase1.sql and resident_user_table_migration.sql.

ALTER TABLE public.barangay_reports
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.mdrrmo_reports
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.resident_push_tokens (
  fcm_token  TEXT PRIMARY KEY,
  resident_id UUID NOT NULL REFERENCES public.resident_user(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL CHECK (platform = 'android'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resident_push_tokens_resident_idx
  ON public.resident_push_tokens (resident_id);

ALTER TABLE public.resident_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resident_push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resident_push_tokens TO service_role;

CREATE TABLE IF NOT EXISTS public.resident_push_outbox (
  id               BIGSERIAL PRIMARY KEY,
  event_key        TEXT NOT NULL UNIQUE,
  report_id        UUID NOT NULL,
  resident_id      UUID NOT NULL REFERENCES public.resident_user(id) ON DELETE CASCADE,
  source_table     TEXT NOT NULL CHECK (source_table IN ('barangay_reports', 'mdrrmo_reports')),
  report_title     TEXT NOT NULL,
  display_status   TEXT NOT NULL,
  revision         BIGINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts         INTEGER NOT NULL DEFAULT 0,
  available_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until     TIMESTAMPTZ,
  delivered_tokens TEXT[] NOT NULL DEFAULT '{}',
  processed_at     TIMESTAMPTZ,
  last_error       TEXT
);

ALTER TABLE public.resident_push_outbox
  ADD COLUMN IF NOT EXISTS delivered_tokens TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS resident_push_outbox_pending_idx
  ON public.resident_push_outbox (available_at, id)
  WHERE processed_at IS NULL;

ALTER TABLE public.resident_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resident_push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.resident_push_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.resident_push_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_resident_report_status_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW);
  v_old JSONB;
  v_source_type TEXT;
  v_escalated BOOLEAN;
  v_is_status_change BOOLEAN := FALSE;
  v_display_status TEXT;
  v_revision BIGINT;
  v_event_key TEXT;
BEGIN
  v_source_type := COALESCE(v_new->>'source_type', 'direct');
  v_escalated := COALESCE((v_new->>'escalated_to_mdrrmo')::BOOLEAN, FALSE);

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_is_status_change :=
      (v_new->>'status') IS DISTINCT FROM (v_old->>'status') OR
      (v_new->>'response_status') IS DISTINCT FROM (v_old->>'response_status') OR
      (v_new->>'review_outcome') IS DISTINCT FROM (v_old->>'review_outcome') OR
      (v_new->>'dispatcher_reviewed_at') IS DISTINCT FROM (v_old->>'dispatcher_reviewed_at') OR
      (v_new->>'dispatched_at') IS DISTINCT FROM (v_old->>'dispatched_at') OR
      (v_new->>'accepted_at') IS DISTINCT FROM (v_old->>'accepted_at') OR
      (v_new->>'arrived_at') IS DISTINCT FROM (v_old->>'arrived_at') OR
      (v_new->>'resolved_at') IS DISTINCT FROM (v_old->>'resolved_at') OR
      (v_new->>'source_type') IS DISTINCT FROM (v_old->>'source_type') OR
      (v_new->>'escalated_to_mdrrmo') IS DISTINCT FROM (v_old->>'escalated_to_mdrrmo');
  ELSIF TG_TABLE_NAME = 'mdrrmo_reports' AND v_source_type = 'escalated' THEN
    -- Escalation can be the first insert into mdrrmo_reports. Direct report
    -- creation is intentionally not a status push.
    v_is_status_change := TRUE;
  END IF;

  IF NOT v_is_status_change OR
     COALESCE(v_new->>'reporter_type', '') <> 'resident' OR
     NULLIF(v_new->>'reporter_id', '') IS NULL THEN
    RETURN NEW;
  END IF;

  -- Once a barangay report is escalated, its MDRRMO copy is the canonical
  -- lifecycle source. Suppress the paired barangay update to prevent a double push.
  IF TG_TABLE_NAME = 'barangay_reports' AND v_escalated THEN
    RETURN NEW;
  END IF;

  IF NULLIF(v_new->>'review_outcome', '') = 'inconclusive' THEN
    v_display_status := 'marked inconclusive';
  ELSIF NULLIF(v_new->>'review_outcome', '') = 'false_report' THEN
    v_display_status := 'marked as a false report';
  ELSIF NULLIF(v_new->>'resolved_at', '') IS NOT NULL OR
        lower(COALESCE(v_new->>'response_status', '')) IN ('resolved', 'closed') OR
        lower(COALESCE(v_new->>'status', '')) IN ('resolved', 'closed') THEN
    v_display_status := 'resolved';
  ELSIF NULLIF(v_new->>'arrived_at', '') IS NOT NULL THEN
    v_display_status := 'responder arrived';
  ELSIF NULLIF(v_new->>'accepted_at', '') IS NOT NULL THEN
    v_display_status := 'responder accepted';
  ELSIF NULLIF(v_new->>'dispatched_at', '') IS NOT NULL THEN
    v_display_status := 'responder dispatched';
  ELSIF NULLIF(v_new->>'dispatcher_reviewed_at', '') IS NOT NULL THEN
    v_display_status := 'under review';
  ELSIF v_source_type = 'escalated' OR v_escalated THEN
    v_display_status := 'now being handled by MDRRMO';
  ELSIF lower(COALESCE(v_new->>'response_status', '')) = 'responding' THEN
    v_display_status := 'responding';
  ELSE
    v_display_status := COALESCE(NULLIF(v_new->>'status', ''), 'updated');
  END IF;

  v_revision := COALESCE(NULLIF(v_new->>'lifecycle_revision', '')::BIGINT, 0);
  v_event_key := TG_TABLE_NAME || ':' || (v_new->>'id') || ':' || v_revision::TEXT;

  INSERT INTO public.resident_push_outbox (
    event_key, report_id, resident_id, source_table, report_title,
    display_status, revision
  ) VALUES (
    v_event_key,
    (v_new->>'id')::UUID,
    (v_new->>'reporter_id')::UUID,
    TG_TABLE_NAME,
    COALESCE(NULLIF(v_new->>'title', ''), 'Incident report'),
    v_display_status,
    v_revision
  ) ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS barangay_report_resident_status_push ON public.barangay_reports;
CREATE TRIGGER barangay_report_resident_status_push
  AFTER UPDATE ON public.barangay_reports
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_resident_report_status_push();

DROP TRIGGER IF EXISTS mdrrmo_report_resident_status_push ON public.mdrrmo_reports;
CREATE TRIGGER mdrrmo_report_resident_status_push
  AFTER INSERT OR UPDATE ON public.mdrrmo_reports
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_resident_report_status_push();

CREATE OR REPLACE FUNCTION public.claim_resident_push_outbox(p_batch_size INTEGER DEFAULT 25)
RETURNS SETOF public.resident_push_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '90 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.resident_push_outbox AS events
  SET locked_until = v_lock_until,
      attempts = events.attempts + 1
  WHERE events.id IN (
    SELECT pending.id
    FROM public.resident_push_outbox AS pending
    WHERE pending.processed_at IS NULL
      AND pending.available_at <= now()
      AND (pending.locked_until IS NULL OR pending.locked_until < now())
    ORDER BY pending.available_at, pending.id
    LIMIT GREATEST(1, LEAST(p_batch_size, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING events.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_resident_push_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_resident_push_outbox(INTEGER) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'resident_push_outbox'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.resident_push_outbox;
  END IF;
END $$;

-- ===== Source section: database/migrations/mdrrmo_report_assignment_canonical_fk_migration.sql =====
-- MDRRMO reports now live in mdrrmo_reports. The original report-cycle
-- migration linked assignments to incident_reports, which blocks dispatching
-- newly submitted reports that exist only in the canonical table.
--
-- Apply after separate_report_tables_phase1.sql and
-- mdrrmo_report_cycle_migration.sql. NOT VALID preserves any historical rows
-- that have not been backfilled, while enforcing the canonical relation for
-- new and changed assignments.

BEGIN;

ALTER TABLE public.mdrrmo_report_assignments
  DROP CONSTRAINT IF EXISTS mdrrmo_report_assignments_report_id_fkey;

ALTER TABLE public.mdrrmo_report_assignments
  ADD CONSTRAINT mdrrmo_report_assignments_report_id_fkey
  FOREIGN KEY (report_id)
  REFERENCES public.mdrrmo_reports(id)
  ON DELETE CASCADE
  NOT VALID;

COMMIT;

-- ===== MDRRMO responder assignment push notifications =====
-- This block restores the responder push schema expected by the backend relay.

CREATE TABLE IF NOT EXISTS public.mdrrmo_responder_push_tokens (
  fcm_token   TEXT PRIMARY KEY,
  responder_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform = 'android'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mdrrmo_responder_push_tokens_responder_idx
  ON public.mdrrmo_responder_push_tokens (responder_id);

ALTER TABLE public.mdrrmo_responder_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_responder_push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mdrrmo_responder_push_tokens TO service_role;

CREATE TABLE IF NOT EXISTS public.mdrrmo_responder_push_outbox (
  id               BIGSERIAL PRIMARY KEY,
  assignment_id    UUID NOT NULL UNIQUE REFERENCES public.mdrrmo_report_assignments(id) ON DELETE CASCADE,
  report_id        UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  responder_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  report_title     TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts         INTEGER NOT NULL DEFAULT 0,
  delivered_tokens TEXT[] NOT NULL DEFAULT '{}',
  available_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until     TIMESTAMPTZ,
  processed_at     TIMESTAMPTZ,
  last_error       TEXT
);

CREATE INDEX IF NOT EXISTS mdrrmo_responder_push_outbox_pending_idx
  ON public.mdrrmo_responder_push_outbox (available_at, id)
  WHERE processed_at IS NULL;

ALTER TABLE public.mdrrmo_responder_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_responder_push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mdrrmo_responder_push_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mdrrmo_responder_push_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_mdrrmo_responder_assignment_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_title TEXT;
BEGIN
  IF NEW.status <> 'assigned' THEN
    RETURN NEW;
  END IF;

  SELECT title INTO v_report_title
  FROM public.mdrrmo_reports
  WHERE id = NEW.report_id;

  INSERT INTO public.mdrrmo_responder_push_outbox (
    assignment_id, report_id, responder_id, report_title
  ) VALUES (
    NEW.id, NEW.report_id, NEW.responder_id, COALESCE(v_report_title, 'Incident report')
  )
  ON CONFLICT (assignment_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_mdrrmo_responder_assignment_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mdrrmo_responder_assignment_push_after_insert ON public.mdrrmo_report_assignments;
CREATE TRIGGER mdrrmo_responder_assignment_push_after_insert
  AFTER INSERT ON public.mdrrmo_report_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_mdrrmo_responder_assignment_push();

CREATE OR REPLACE FUNCTION public.claim_mdrrmo_responder_push_outbox(p_batch_size INTEGER DEFAULT 25)
RETURNS SETOF public.mdrrmo_responder_push_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '90 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.mdrrmo_responder_push_outbox AS events
  SET locked_until = v_lock_until,
      attempts = events.attempts + 1
  WHERE events.id IN (
    SELECT pending.id
    FROM public.mdrrmo_responder_push_outbox AS pending
    WHERE pending.processed_at IS NULL
      AND pending.available_at <= now()
      AND (pending.locked_until IS NULL OR pending.locked_until < now())
    ORDER BY pending.available_at, pending.id
    LIMIT GREATEST(1, LEAST(p_batch_size, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING events.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_mdrrmo_responder_push_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mdrrmo_responder_push_outbox(INTEGER) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'mdrrmo_responder_push_outbox'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mdrrmo_responder_push_outbox;
  END IF;
END $$;

-- Harden the v2 RPCs used by the backend. PostgreSQL grants EXECUTE on new
-- functions to PUBLIC by default; only the service role should call these.
REVOKE ALL ON FUNCTION public.claim_mdrrmo_report_event_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mdrrmo_report_event_outbox(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.claim_barangay_report_event_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_barangay_report_event_outbox(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.dispatch_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.accept_mdrrmo_report_v2(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_mdrrmo_report_v2(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.record_mdrrmo_arrival_v2(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mdrrmo_arrival_v2(UUID, UUID, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.append_mdrrmo_field_media_v2(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_mdrrmo_field_media_v2(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.close_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.review_barangay_report(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_barangay_report(UUID, UUID, TEXT, TEXT) TO service_role;

-- Trigger functions are callable only through their owning triggers.
REVOKE ALL ON FUNCTION public.set_incident_lifecycle_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_incident_lifecycle_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_incident_report_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_mdrrmo_assignment_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_barangay_report_lifecycle_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_mdrrmo_report_lifecycle_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_dispatcher_report_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_resident_report_status_push() FROM PUBLIC, anon, authenticated;

-- Unit roster roles and the crew selected by a responder account when it
-- accepts an MDRRMO assignment. Legacy officer_ids remain available to the
-- existing task workflow while new roster writes use this normalized table.
CREATE INDEX IF NOT EXISTS idx_respond_unit_members_unit_active_role
  ON public.respond_unit_members(unit_id, is_active, member_role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_unit_one_active_team_leader
  ON public.respond_unit_members(unit_id)
  WHERE is_active AND member_role = 'team_leader';
CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_unit_one_active_radio_operator
  ON public.respond_unit_members(unit_id)
  WHERE is_active AND member_role = 'radio_operator';

ALTER TABLE public.respond_unit_members ENABLE ROW LEVEL SECURITY;

-- Preserve legacy roster names, but require Staff to classify positions and
-- explicitly link a responder account before the roster can accept dispatch.
INSERT INTO public.respond_unit_members (unit_id, officer_id, member_role, is_active)
SELECT units.id, officers.id, 'unassigned', officers.status = 'active'
FROM public.respond_units AS units
CROSS JOIN LATERAL unnest(COALESCE(units.officer_ids, '{}'::UUID[])) AS legacy(officer_id)
JOIN public.officers AS officers ON officers.id = legacy.officer_id
ON CONFLICT (unit_id, officer_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_respond_unit_member_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_existing INTEGER;
  v_user_role TEXT;
  v_user_status TEXT;
BEGIN
  PERFORM 1 FROM public.respond_units WHERE id = NEW.unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = '23503';
  END IF;

  IF NOT NEW.is_active OR NEW.member_role = 'unassigned' THEN
    RETURN NEW;
  END IF;

  IF NEW.member_role = 'team_leader' THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.responder_user_id::TEXT));
    SELECT role::TEXT, status::TEXT INTO v_user_role, v_user_status
    FROM public.users WHERE id = NEW.responder_user_id;
    IF NOT FOUND OR v_user_role <> 'responder' OR v_user_status <> 'active' THEN
      RAISE EXCEPTION 'Team Leader must have an active responder account' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE responder_user_id = NEW.responder_user_id
        AND member_role = 'team_leader'
        AND is_active
        AND id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'Responder account already leads an active unit' USING ERRCODE = '23505';
    END IF;
  END IF;

  v_limit := CASE NEW.member_role
    WHEN 'team_leader' THEN 1
    WHEN 'radio_operator' THEN 1
    WHEN 'driver_responder' THEN 3
    WHEN 'first_aider_responder' THEN 3
    ELSE 0
  END;
  IF v_limit = 0 THEN
    RAISE EXCEPTION 'Invalid active unit member role' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.respond_unit_members
  WHERE unit_id = NEW.unit_id
    AND member_role = NEW.member_role
    AND is_active
    AND id IS DISTINCT FROM NEW.id;
  IF v_existing >= v_limit THEN
    RAISE EXCEPTION 'Unit has reached the capacity for role %', NEW.member_role USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_respond_unit_member_role ON public.respond_unit_members;
CREATE TRIGGER trg_enforce_respond_unit_member_role
BEFORE INSERT OR UPDATE OF unit_id, responder_user_id, member_role, is_active
ON public.respond_unit_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_respond_unit_member_role();

CREATE OR REPLACE FUNCTION public.assign_respond_unit_team_leader_v1(
  p_unit_id UUID,
  p_officer_id UUID,
  p_responder_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_unit public.respond_units%ROWTYPE;
BEGIN
  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_responder_user_id;
  IF NOT FOUND OR v_user.role::TEXT <> 'responder' OR v_user.status::TEXT <> 'active' THEN
    RAISE EXCEPTION 'Team Leader must have an active responder account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.officers
    WHERE id = p_officer_id AND lower(email) = lower(v_user.email)
  ) THEN
    RAISE EXCEPTION 'Team Leader profile must match the responder account' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.respond_unit_members AS current_leader
    JOIN public.mdrrmo_report_assignments AS assignments
      ON assignments.responder_id = current_leader.responder_user_id
    WHERE current_leader.unit_id = p_unit_id
      AND current_leader.member_role = 'team_leader'
      AND current_leader.is_active
      AND current_leader.responder_user_id <> p_responder_user_id
      AND assignments.status IN ('assigned', 'responding')
  ) THEN
    RAISE EXCEPTION 'Cannot change Team Leader while the current leader has an active dispatch' USING ERRCODE = '23514';
  END IF;

  UPDATE public.respond_unit_members
  SET member_role = 'unassigned', responder_user_id = NULL
  WHERE unit_id = p_unit_id AND is_active AND member_role = 'team_leader'
    AND officer_id <> p_officer_id;

  INSERT INTO public.respond_unit_members (unit_id, officer_id, responder_user_id, member_role, is_active)
  VALUES (p_unit_id, p_officer_id, p_responder_user_id, 'team_leader', true)
  ON CONFLICT (unit_id, officer_id) DO UPDATE SET
    responder_user_id = EXCLUDED.responder_user_id,
    member_role = 'team_leader',
    is_active = true;

  UPDATE public.respond_units
  SET officer_ids = ARRAY(
    SELECT DISTINCT officer_id
    FROM unnest(COALESCE(officer_ids, '{}'::UUID[]) || ARRAY[p_officer_id]) AS ids(officer_id)
  )
  WHERE id = p_unit_id;

  RETURN jsonb_build_object('unit_id', p_unit_id, 'responder_user_id', p_responder_user_id);
END;
$$;

CREATE TABLE IF NOT EXISTS public.mdrrmo_assignment_crew_members (
  assignment_id UUID NOT NULL REFERENCES public.mdrrmo_report_assignments(id) ON DELETE CASCADE,
  unit_member_id UUID NOT NULL REFERENCES public.respond_unit_members(id) ON DELETE RESTRICT,
  member_name_snapshot TEXT NOT NULL,
  member_role_snapshot TEXT NOT NULL
    CHECK (member_role_snapshot IN ('team_leader', 'radio_operator', 'driver_responder', 'first_aider_responder')),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, unit_member_id)
);

CREATE OR REPLACE FUNCTION public.clear_respond_unit_team_leader_v1(p_unit_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit public.respond_units%ROWTYPE;
BEGIN
  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.respond_unit_members AS leaders
    JOIN public.mdrrmo_report_assignments AS assignments
      ON assignments.responder_id = leaders.responder_user_id
    WHERE leaders.unit_id = p_unit_id
      AND leaders.member_role = 'team_leader'
      AND leaders.is_active
      AND assignments.status IN ('assigned', 'responding')
  ) THEN
    RAISE EXCEPTION 'Cannot clear the Team Leader while they have an active dispatch' USING ERRCODE = '23514';
  END IF;

  UPDATE public.respond_unit_members
  SET is_active = false
  WHERE unit_id = p_unit_id AND member_role = 'team_leader' AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This unit has no active Team Leader to clear' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('unit_id', p_unit_id, 'team_leader_cleared', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_empty_respond_unit_v1(p_unit_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit public.respond_units%ROWTYPE;
BEGIN
  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.respond_unit_members
    WHERE unit_id = p_unit_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Remove all active roster members and clear the Team Leader before deleting this unit' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.respond_unit_members AS members
    JOIN public.mdrrmo_report_assignments AS assignments
      ON assignments.responder_id = members.responder_user_id
    WHERE members.unit_id = p_unit_id
      AND members.responder_user_id IS NOT NULL
      AND assignments.status IN ('assigned', 'responding')
  ) THEN
    RAISE EXCEPTION 'Cannot delete this unit while one of its responders has an active dispatch' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mdrrmo_assignment_crew_members AS crew
    JOIN public.respond_unit_members AS members ON members.id = crew.unit_member_id
    WHERE members.unit_id = p_unit_id
  ) THEN
    RAISE EXCEPTION 'This unit has response history and cannot be deleted. Set its status to unavailable instead.' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.respond_unit_members WHERE unit_id = p_unit_id;
  DELETE FROM public.respond_units WHERE id = p_unit_id;

  RETURN jsonb_build_object('unit_id', p_unit_id, 'deleted', true);
END;
$$;

ALTER TABLE public.mdrrmo_assignment_crew_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_respond_unit_daily_activations_date
  ON public.respond_unit_daily_activations(activation_date, unit_id);
ALTER TABLE public.respond_unit_daily_activations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_respond_unit_activation_today_v1(
  p_unit_id UUID,
  p_activated_by UUID,
  p_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit public.respond_units%ROWTYPE;
  v_date DATE := timezone('Asia/Manila', now())::DATE;
BEGIN
  IF p_active IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_activated_by
      AND role::TEXT IN ('logistics', 'master_admin')
      AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'An active Staff account is required to change unit activation' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_active THEN
    IF v_unit.status <> 'available' THEN
      RAISE EXCEPTION 'Only available response units can be activated' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.respond_unit_members AS leaders
      JOIN public.users AS leader_accounts ON leader_accounts.id = leaders.responder_user_id
      WHERE leaders.unit_id = p_unit_id AND leaders.is_active
        AND leaders.member_role = 'team_leader'
        AND leader_accounts.role::TEXT = 'responder'
        AND leader_accounts.status::TEXT = 'active'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE unit_id = p_unit_id AND is_active AND member_role = 'driver_responder'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE unit_id = p_unit_id AND is_active AND member_role = 'first_aider_responder'
    ) THEN
      RAISE EXCEPTION 'The unit needs an active Team Leader, a Driver Responder, and a First Aider Responder before activation' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.respond_unit_daily_activations (
      unit_id, activation_date, activated_by, activation_mode, activated_at
    ) VALUES (p_unit_id, v_date, p_activated_by, 'manual', now())
    ON CONFLICT (unit_id, activation_date) DO UPDATE SET
      activated_by = EXCLUDED.activated_by,
      activation_mode = 'manual',
      activated_at = EXCLUDED.activated_at;
  ELSE
    DELETE FROM public.respond_unit_daily_activations
    WHERE unit_id = p_unit_id AND activation_date = v_date;
  END IF;

  RETURN jsonb_build_object(
    'unit_id', p_unit_id,
    'activation_date', v_date,
    'is_active_today', p_active
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_activate_all_respond_units_today_v1(
  p_activated_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := timezone('Asia/Manila', now())::DATE;
  v_now TIMESTAMPTZ := now();
  v_activated_count INTEGER := 0;
  v_total_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_activated_by
      AND role::TEXT IN ('logistics', 'master_admin')
      AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'An active Staff account is required for emergency activation' USING ERRCODE = '42501';
  END IF;

  PERFORM id FROM public.respond_units ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_total_count FROM public.respond_units;

  INSERT INTO public.respond_unit_daily_activations (
    unit_id, activation_date, activated_by, activation_mode, activated_at
  )
  SELECT units.id, v_date, p_activated_by, 'emergency', v_now
  FROM public.respond_units AS units
  WHERE units.status = 'available'
    AND EXISTS (
      SELECT 1
      FROM public.respond_unit_members AS leaders
      JOIN public.users AS leader_accounts ON leader_accounts.id = leaders.responder_user_id
      WHERE leaders.unit_id = units.id AND leaders.is_active
        AND leaders.member_role = 'team_leader'
        AND leader_accounts.role::TEXT = 'responder'
        AND leader_accounts.status::TEXT = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE unit_id = units.id AND is_active AND member_role = 'driver_responder'
    )
    AND EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE unit_id = units.id AND is_active AND member_role = 'first_aider_responder'
    )
  ON CONFLICT (unit_id, activation_date) DO UPDATE SET
    activated_by = EXCLUDED.activated_by,
    activation_mode = 'emergency',
    activated_at = EXCLUDED.activated_at;
  GET DIAGNOSTICS v_activated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'activation_date', v_date,
    'activated_count', v_activated_count,
    'skipped_count', GREATEST(v_total_count - v_activated_count, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_respond_unit_activation_today_v1(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_respond_unit_activation_today_v1(UUID, UUID, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.emergency_activate_all_respond_units_today_v1(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emergency_activate_all_respond_units_today_v1(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_mdrrmo_report_with_crew_v1(
  p_report_id UUID,
  p_responder_id UUID,
  p_member_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_report public.mdrrmo_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
  v_unit_id UUID;
  v_leader_member_id UUID;
  v_valid_count INTEGER;
  v_has_driver BOOLEAN;
  v_has_first_aider BOOLEAN;
BEGIN
  IF p_report_id IS NULL OR p_responder_id IS NULL OR p_member_ids IS NULL
     OR cardinality(p_member_ids) < 2 OR cardinality(p_member_ids) > 7
     OR cardinality(p_member_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_member_ids) AS selected(id)) THEN
    RAISE EXCEPTION 'Choose at least one Driver Responder and one First Aider Responder' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report
  FROM public.mdrrmo_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_report.response_status, 'pending') NOT IN ('pending', 'responding') OR v_report.dispatched_at IS NULL THEN
    RAISE EXCEPTION 'Report is not available for responder acceptance' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, unit_id INTO v_leader_member_id, v_unit_id
  FROM public.respond_unit_members
  WHERE responder_user_id = p_responder_id
    AND member_role = 'team_leader'
    AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Responder account is not assigned as an active Team Leader' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_responder_id AND role::TEXT = 'responder' AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'Team Leader responder account is not active' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.respond_units WHERE id = v_unit_id FOR SHARE;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND responder_id = p_responder_id
  FOR UPDATE;
  IF NOT FOUND OR v_assignment.status <> 'assigned' THEN
    RAISE EXCEPTION 'Assignment not found or already accepted' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*),
         COALESCE(bool_or(member_role = 'driver_responder'), false),
         COALESCE(bool_or(member_role = 'first_aider_responder'), false)
    INTO v_valid_count, v_has_driver, v_has_first_aider
  FROM public.respond_unit_members
  WHERE id = ANY(p_member_ids)
    AND unit_id = v_unit_id
    AND is_active
    AND member_role IN ('radio_operator', 'driver_responder', 'first_aider_responder');

  IF v_valid_count <> cardinality(p_member_ids) OR NOT v_has_driver OR NOT v_has_first_aider THEN
    RAISE EXCEPTION 'Selected crew must be active members of your unit and include a Driver Responder and a First Aider Responder' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mdrrmo_report_assignments SET
    status = 'responding',
    accepted_at = v_now,
    accepted_by = p_responder_id
  WHERE id = v_assignment.id AND status = 'assigned';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment was accepted by another responder' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mdrrmo_reports SET
    response_status = 'responding',
    accepted_at = COALESCE(accepted_at, v_now),
    lifecycle_actor_id = p_responder_id,
    lifecycle_actor_role = 'responder'
  WHERE id = p_report_id AND response_status IN ('pending', 'responding');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report status changed before acceptance' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.mdrrmo_assignment_crew_members (
    assignment_id, unit_member_id, member_name_snapshot, member_role_snapshot, selected_at
  )
  SELECT v_assignment.id, members.id, officers.name, members.member_role, v_now
  FROM public.respond_unit_members AS members
  JOIN public.officers AS officers ON officers.id = members.officer_id
  WHERE members.id = v_leader_member_id OR members.id = ANY(p_member_ids);

  RETURN jsonb_build_object('accepted_at', v_now, 'unit_id', v_unit_id, 'crew_count', cardinality(p_member_ids) + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_respond_unit_member_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_respond_unit_team_leader_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_respond_unit_team_leader_v1(UUID, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.clear_respond_unit_team_leader_v1(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_respond_unit_team_leader_v1(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.delete_empty_respond_unit_v1(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_empty_respond_unit_v1(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.accept_mdrrmo_report_with_crew_v1(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_mdrrmo_report_with_crew_v1(UUID, UUID, UUID[]) TO service_role;

-- ============================================
-- Barangay assistance requests
-- ============================================
-- Responders submit these requests from an assigned barangay incident.
-- The backend uses the named requested_by/decided_by foreign keys for its
-- embedded barangay_users lookups.
CREATE TABLE IF NOT EXISTS public.barangay_assistance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL,
  incident_report_id UUID REFERENCES public.barangay_reports(id) ON DELETE SET NULL,
  incident_title TEXT,
  needs_more_manpower BOOLEAN NOT NULL DEFAULT false,
  needs_resources BOOLEAN NOT NULL DEFAULT false,
  needs_equipment BOOLEAN NOT NULL DEFAULT false,
  beyond_barangay_capability BOOLEAN NOT NULL DEFAULT false,
  explanation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'actioned', 'rejected', 'fulfilled', 'cancelled')),
  decision TEXT
    CHECK (decision IS NULL OR decision IN ('provide_barangay_assistance', 'coordinate_mdrrmo')),
  dispatcher_notes TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  team_acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT requested_by
    FOREIGN KEY (requested_by) REFERENCES public.barangay_users(id) ON DELETE CASCADE,
  CONSTRAINT decided_by
    FOREIGN KEY (decided_by) REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  CONSTRAINT barangay_assistance_requests_explanation_length_check
    CHECK (char_length(btrim(explanation)) >= 10)
);

CREATE INDEX IF NOT EXISTS idx_barangay_assistance_requests_barangay_created
  ON public.barangay_assistance_requests (barangay_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_barangay_assistance_requests_requested_by
  ON public.barangay_assistance_requests (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_barangay_assistance_requests_incident_report
  ON public.barangay_assistance_requests (incident_report_id)
  WHERE incident_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_barangay_assistance_requests_status
  ON public.barangay_assistance_requests (status, created_at DESC);

ALTER TABLE public.barangay_assistance_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_assistance_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.barangay_assistance_requests TO service_role;

-- MDRRMO responder assistance requests reference mdrrmo_reports directly.
-- Keep resource_requests.incident_id for legacy requests linked to incidents.
ALTER TABLE public.resource_requests
  ADD COLUMN IF NOT EXISTS mdrrmo_report_id UUID;

UPDATE public.resource_requests AS request
SET mdrrmo_report_id = request.incident_id,
    incident_id = NULL
FROM public.mdrrmo_reports AS report
WHERE request.incident_id = report.id
  AND request.mdrrmo_report_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'resource_requests_mdrrmo_report_id_fkey'
      AND conrelid = 'public.resource_requests'::regclass
  ) THEN
    ALTER TABLE public.resource_requests
      ADD CONSTRAINT resource_requests_mdrrmo_report_id_fkey
      FOREIGN KEY (mdrrmo_report_id)
      REFERENCES public.mdrrmo_reports(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_resource_requests_mdrrmo_report_id
  ON public.resource_requests (mdrrmo_report_id, created_at DESC)
  WHERE mdrrmo_report_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
