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

/*
 * OBLIGATION status, rider-facing (Swahili) and staff-facing (English).
 *
 * Previously these lived inline in app/rider/calendar/page.tsx. Moved here
 * because a second surface now needs them (the phone-loan instalment list), and
 * a second copy is how "Imeahirishwa" ends up meaning two different things on
 * two screens. A plain lib/ module so a SERVER page may import it — a
 * 'use client' module's exports are client references on the server (spec
 * rule 16).
 */
export const OBLIGATION_STATUS_LABELS_SW: Record<string, string> = {
  scheduled: 'Ijayo',
  due: 'Ya leo',
  overdue: 'Deni',
  paid: 'Imelipwa',
  paid_in_advance: 'Malipo ya awali',
  exempted: 'Msamaha',
  postponed: 'Imeahirishwa',
  cancelled: 'Imeghairiwa',
};

export const OBLIGATION_STATUS_LABELS_EN: Record<string, string> = {
  scheduled: 'Scheduled',
  due: 'Due today',
  overdue: 'Overdue',
  paid: 'Paid',
  paid_in_advance: 'Paid in advance',
  exempted: 'Waived',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
};
