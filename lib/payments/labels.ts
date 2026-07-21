// Rider-facing Swahili labels for payment_status — rider UI must never render
// raw status enums (spec §36.11). Keep in sync with the payment_status enum
// in supabase/migrations/0001_enums.sql.
export const PAYMENT_STATUS_LABELS_SW: Record<string, string> = {
  created: 'Inasubiri',
  pending: 'Inasubiri',
  completed: 'Imekamilika',
  failed: 'Imeshindikana',
  expired: 'Imeisha muda',
  cancelled: 'Imeghairiwa',
  reversed: 'Imerejeshwa',
};

// Owner-facing English labels for payment_status (owner UI is English).
export const PAYMENT_STATUS_LABELS_EN: Record<string, string> = {
  created: 'Awaiting',
  pending: 'Pending',
  completed: 'Completed',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  reversed: 'Reversed',
};
