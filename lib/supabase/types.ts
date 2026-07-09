/*
 * Supabase schema types.
 *
 * `Database` is the precise type generated from the live database
 * (lib/supabase/types.gen.ts). Regenerate after every migration with:
 *
 *   supabase gen types typescript --linked > lib/supabase/types.gen.ts
 *
 * The hand-maintained enum unions remain the source of truth for the app
 * layer and mirror the Postgres enums in supabase/migrations/0001_enums.sql.
 */

// ---- Enum unions (mirror 0001_enums.sql) --------------------------------
export type UserRole = 'owner' | 'rider';

export type RiderStatus =
  | 'onboarding'
  | 'active'
  | 'suspended'
  | 'terminated'
  | 'inactive';

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'interview'
  | 'verification'
  | 'approved'
  | 'rejected'
  | 'waitlisted'
  | 'withdrawn'
  | 'converted_to_rider';

export type MotorcycleStatus = 'available' | 'assigned' | 'inactive';

export type ContractStatus =
  | 'draft'
  | 'awaiting_signatures'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'completed_early'
  | 'terminated'
  | 'cancelled';

export type ScheduleType = 'daily' | 'selected_weekdays';

export type ObligationStatus =
  | 'scheduled'
  | 'due'
  | 'overdue'
  | 'paid'
  | 'paid_in_advance'
  | 'exempted'
  | 'postponed'
  | 'cancelled';

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'reversed';

export type PaymentMethod = 'mobile_money' | 'cash';

export type IncidentCategory =
  | 'breakdown'
  | 'accident'
  | 'theft'
  | 'police_issue'
  | 'maintenance_request'
  | 'personal_emergency';

export type ExemptionStatus =
  | 'submitted'
  | 'under_review'
  | 'approved_waived'
  | 'approved_postponed'
  | 'rejected'
  | 'cancelled';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type LoginOutcome =
  | 'success'
  | 'invalid_credentials'
  | 'weak_pin'
  | 'locked'
  | 'rate_limited'
  | 'unknown_phone';

// ---- Precise generated types (from the live database) -------------------
export type { Database, Json } from './types.gen';
