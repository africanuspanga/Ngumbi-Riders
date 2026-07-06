-- =========================================================================
-- 0001_enums.sql — Extensions and enumerated types (spec §22)
-- These mirror lib/supabase/types.ts. Adding a value later requires a new
-- migration (never edit this file after it has been applied).
-- =========================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid(), digest()
create extension if not exists "citext";         -- case-insensitive email

-- Roles: owner and rider are the ONLY roles (spec §1.62, §4).
create type user_role as enum ('owner', 'rider');

create type rider_status as enum (
  'onboarding', 'active', 'suspended', 'terminated', 'inactive'
);

create type application_status as enum (
  'draft', 'submitted', 'under_review', 'interview', 'verification',
  'approved', 'rejected', 'waitlisted', 'withdrawn', 'converted_to_rider'
);

create type motorcycle_status as enum ('available', 'assigned', 'inactive');

create type contract_status as enum (
  'draft', 'awaiting_signatures', 'scheduled', 'active', 'paused',
  'completed', 'completed_early', 'terminated', 'cancelled'
);

create type schedule_type as enum ('daily', 'selected_weekdays');

create type obligation_status as enum (
  'scheduled', 'due', 'overdue', 'paid', 'paid_in_advance',
  'exempted', 'postponed', 'cancelled'
);

create type payment_status as enum (
  'created', 'pending', 'completed', 'failed', 'expired', 'cancelled', 'reversed'
);

create type payment_method as enum ('mobile_money', 'cash');

create type incident_category as enum (
  'breakdown', 'accident', 'theft', 'police_issue',
  'maintenance_request', 'personal_emergency'
);

create type exemption_status as enum (
  'submitted', 'under_review', 'approved_waived', 'approved_postponed',
  'rejected', 'cancelled'
);

create type risk_level as enum ('low', 'medium', 'high', 'critical');

create type login_outcome as enum (
  'success', 'invalid_credentials', 'weak_pin', 'locked',
  'rate_limited', 'unknown_phone'
);
