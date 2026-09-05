/*
 * Schema additions that are in a migration but not yet in the generated types.
 *
 * `types.gen.ts` is produced from the LIVE database, so it necessarily lags a
 * migration that has been written but not yet applied. Rather than leave the
 * repo un-typecheckable in that window (or, worse, sprinkle `as any` through
 * money code), the new tables and columns are declared here and merged into
 * `Database`.
 *
 * This overlay is written to be IDEMPOTENT: once 0026 is applied and the types
 * are regenerated, every entry here becomes an intersection with an identical
 * generated one, so nothing breaks and the file can simply be deleted.
 *
 *   ▶ After applying migration 0026, run
 *       supabase gen types typescript --linked > lib/supabase/types.gen.ts
 *     and delete this file plus its re-export in types.ts.
 */

import type { Database as GeneratedDatabase } from './types.gen';

type PublicSchema = GeneratedDatabase['public'];
type GenTables = PublicSchema['Tables'];

/** Add columns to a generated table without restating the whole shape. */
type Augment<T extends { Row: unknown; Insert: unknown; Update: unknown }, Add> = Omit<
  T,
  'Row' | 'Insert' | 'Update'
> & {
  Row: T['Row'] & Add;
  Insert: T['Insert'] & Partial<Add>;
  Update: T['Update'] & Partial<Add>;
};

/** A brand-new table: Row/Insert/Update derived from one column map. */
type NewTable<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

// ---- 0026 additions -----------------------------------------------------

type CashPaymentRequestRow = {
  id: string;
  rider_id: string;
  contract_id: string;
  obligation_ids: string[];
  amount: number;
  payment_date: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  received_by: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  payment_id: string | null;
  created_at: string;
  updated_at: string;
};

type PhoneLoanRow = {
  id: string;
  rider_id: string;
  contract_id: string | null;
  principal: number;
  interest_bps: number;
  interest_amount: number;
  total_amount: number;
  term_months: number;
  device_description: string | null;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentAdditions = {
  received_by: string | null;
  note: string | null;
};

type ObligationAdditions = {
  kind: 'lease' | 'phone_loan';
  phone_loan_id: string | null;
};

type ContractAdditions = {
  daily_rate: number | null;
  payment_days_target: number | null;
  lease_start_date: string | null;
  phone_loan_id: string | null;
  last_edited_at: string | null;
  last_edited_by: string | null;
};

type ApplicationAdditions = {
  wants_phone_loan: boolean;
  phone_loan_amount: number | null;
};

type PendingTables = Omit<
  GenTables,
  'payments' | 'payment_obligations' | 'contracts' | 'rider_applications' | 'cash_payment_requests' | 'phone_loans'
> & {
  payments: Augment<GenTables['payments'], PaymentAdditions>;
  payment_obligations: Augment<GenTables['payment_obligations'], ObligationAdditions>;
  contracts: Augment<GenTables['contracts'], ContractAdditions>;
  rider_applications: Augment<GenTables['rider_applications'], ApplicationAdditions>;
  cash_payment_requests: NewTable<
    CashPaymentRequestRow,
    'rider_id' | 'contract_id' | 'obligation_ids' | 'amount' | 'payment_date' | 'received_by' | 'requested_by'
  >;
  phone_loans: NewTable<
    PhoneLoanRow,
    'rider_id' | 'principal' | 'interest_amount' | 'total_amount' | 'term_months'
  >;
};

export type DatabaseWithPending = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<PublicSchema, 'Tables'> & { Tables: PendingTables };
};
