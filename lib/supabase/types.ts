/*
 * Supabase schema types.
 *
 * The `Database` generic below is a valid structural placeholder so the typed
 * clients compile before a live database exists. Once Supabase is provisioned,
 * regenerate the precise types with:
 *
 *   supabase gen types typescript --local > lib/supabase/types.gen.ts
 *
 * and re-export them here. The hand-maintained enum unions are the source of
 * truth for the app layer and mirror the Postgres enums in
 * supabase/migrations/0001_enums.sql.
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

// ---- Structural placeholder for the typed clients -----------------------
type GenericTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: Record<string, GenericTable>;
    Views: Record<string, { Row: Record<string, unknown> }>;
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums: {
      user_role: UserRole;
      rider_status: RiderStatus;
      application_status: ApplicationStatus;
      motorcycle_status: MotorcycleStatus;
      contract_status: ContractStatus;
      schedule_type: ScheduleType;
      obligation_status: ObligationStatus;
      payment_status: PaymentStatus;
      payment_method: PaymentMethod;
      incident_category: IncidentCategory;
      exemption_status: ExemptionStatus;
      risk_level: RiskLevel;
      login_outcome: LoginOutcome;
    };
    CompositeTypes: Record<string, Record<string, unknown>>;
  };
};
