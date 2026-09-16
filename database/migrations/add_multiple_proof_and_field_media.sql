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
