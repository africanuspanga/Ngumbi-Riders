/*
 * The end-of-contract chain (client feedback 2026-09-11 #6).
 *
 * "When a rider finishes a contract, the rider should not be marked complete
 *  automatically without review."
 *
 * PURE and dependency-free, so every legal move is unit tested. This module is
 * the readable half of a control that exists in two places: migration 0034's
 * `guard_completion_transition` enforces the two rules that must hold even if
 * this file is wrong — finance clearance cannot be skipped, and the Director's
 * approval and sign-off cannot be skipped — because the client asked for a
 * control, and a control that lives only in application code is an assumption.
 *
 * WHY TWELVE STATES AND NOT FOUR
 *
 * Each one names a different person's desk. The alternative — a couple of
 * booleans and a "stage" number — makes "where is this request?" a question you
 * answer by reading code, and this chain crosses three roles and an outside
 * process (the registration transfer) that takes days. The statuses ARE the
 * handover protocol.
 */

export type CompletionStatus =
  | 'requested'
  | 'finance_review'
  | 'finance_cleared'
  | 'director_review'
  | 'director_approved'
  | 'certificate_issued'
  | 'transfer_in_progress'
  | 'transfer_uploaded'
  | 'final_review'
  | 'completed'
  | 'rejected'
  | 'returned';

export const COMPLETION_STATUSES: readonly CompletionStatus[] = [
  'requested',
  'finance_review',
  'finance_cleared',
  'director_review',
  'director_approved',
  'certificate_issued',
  'transfer_in_progress',
  'transfer_uploaded',
  'final_review',
  'completed',
  'rejected',
  'returned',
] as const;

/** Still moving. A request in one of these is on somebody's desk. */
export const OPEN_COMPLETION_STATUSES: readonly CompletionStatus[] = COMPLETION_STATUSES.filter(
  (s) => s !== 'completed' && s !== 'rejected',
);

export const STATUS_LABELS: Record<CompletionStatus, string> = {
  requested: 'Completion requested',
  finance_review: 'Under finance review',
  finance_cleared: 'Finance cleared',
  director_review: 'Sent to director',
  director_approved: 'Director approved completion',
  certificate_issued: 'Certificate generated',
  transfer_in_progress: 'Ownership transfer in progress',
  transfer_uploaded: 'Transfer document uploaded',
  final_review: 'Final director review',
  completed: 'Completed and signed off',
  rejected: 'Rejected',
  returned: 'Returned for correction',
};

export const STATUS_LABELS_SW: Record<CompletionStatus, string> = {
  requested: 'Ombi limewasilishwa',
  finance_review: 'Linapitiwa na uhasibu',
  finance_cleared: 'Uhasibu wamethibitisha hakuna deni',
  director_review: 'Limepelekwa kwa Mkurugenzi',
  director_approved: 'Mkurugenzi ameidhinisha',
  certificate_issued: 'Cheti kimetolewa',
  transfer_in_progress: 'Uhamisho wa umiliki unaendelea',
  transfer_uploaded: 'Hati ya uhamisho imewekwa',
  final_review: 'Ukaguzi wa mwisho wa Mkurugenzi',
  completed: 'Umekamilisha mkataba',
  rejected: 'Halikukubaliwa',
  returned: 'Limerudishwa kwa marekebisho',
};

/** What the rider should understand, in Swahili. */
export const STATUS_HELP_SW: Record<CompletionStatus, string> = {
  requested: 'Ombi lako limepokelewa. Uhasibu wataangalia kama umemaliza kulipa.',
  finance_review: 'Uhasibu wanahakiki malipo yako yote.',
  finance_cleared: 'Uhasibu wamethibitisha kuwa hauna deni.',
  director_review: 'Ombi lako liko kwa Mkurugenzi kwa idhini.',
  director_approved: 'Mkurugenzi ameidhinisha kuwa umekamilisha mkataba.',
  certificate_issued: 'Cheti chako kimetolewa. Unaweza kukipakua.',
  transfer_in_progress: 'Uhasibu wanaandaa uhamisho wa umiliki wa pikipiki.',
  transfer_uploaded: 'Hati ya uhamisho imeandaliwa na kuwekwa kwenye mfumo.',
  final_review: 'Mkurugenzi anafanya ukaguzi wa mwisho.',
  completed: 'Hongera! Mkataba wako umekamilika na umesainiwa.',
  rejected: 'Ombi lako halikukubaliwa. Angalia sababu hapa chini.',
  returned: 'Ombi lako limerudishwa kwa marekebisho.',
};

export type CompletionActor = 'rider' | 'accountant' | 'owner' | 'nobody';

/**
 * WHOSE DESK. Printed on every queue row so nobody has to infer it from the
 * status name — the mistake both earlier approval queues in this codebase made.
 */
export const NEXT_ACTOR: Record<CompletionStatus, CompletionActor> = {
  requested: 'accountant',
  finance_review: 'accountant',
  finance_cleared: 'accountant',
  director_review: 'owner',
  director_approved: 'owner',
  certificate_issued: 'accountant',
  transfer_in_progress: 'accountant',
  transfer_uploaded: 'accountant',
  final_review: 'owner',
  completed: 'nobody',
  rejected: 'nobody',
  returned: 'accountant',
};

export const NEXT_ACTION: Record<CompletionStatus, string> = {
  requested: 'Start the finance review',
  finance_review: 'Confirm whether the rider still owes anything',
  finance_cleared: 'Send the request to the Managing Director',
  director_review: 'Approve completion, or reject it',
  director_approved: 'Issue the certificate of accomplishment',
  certificate_issued: 'Begin the ownership transfer',
  transfer_in_progress: 'Upload the signed ownership-transfer document',
  transfer_uploaded: 'Send it back to the Managing Director for final review',
  final_review: 'Confirm the transfer and sign off completion',
  completed: '',
  rejected: '',
  returned: 'Correct the request and send it back through finance',
};

/*
 * Legal transitions.
 *
 * Read the two absences carefully, because they are the client's requirement:
 *
 *   • NOTHING reaches 'director_approved' except from 'director_review', and
 *     nothing reaches 'director_review' except from 'finance_cleared'. Finance
 *     clearance therefore cannot be skipped.
 *   • NOTHING reaches 'completed' except from 'final_review'. The Director's
 *     sign-off cannot be skipped.
 *
 * 'rejected' is reachable from every open state (a request can be refused at
 * any point before sign-off) and is terminal. 'returned' is the softer version:
 * it goes back to finance to be corrected and tried again.
 */
const TRANSITIONS: Record<CompletionStatus, readonly CompletionStatus[]> = {
  requested: ['finance_review', 'rejected', 'returned'],
  finance_review: ['finance_cleared', 'rejected', 'returned'],
  finance_cleared: ['director_review', 'rejected', 'returned'],
  director_review: ['director_approved', 'rejected', 'returned'],
  director_approved: ['certificate_issued', 'rejected'],
  certificate_issued: ['transfer_in_progress', 'rejected'],
  transfer_in_progress: ['transfer_uploaded', 'rejected', 'returned'],
  transfer_uploaded: ['final_review', 'rejected', 'returned'],
  final_review: ['completed', 'rejected', 'returned'],
  completed: [],
  rejected: [],
  // A returned request re-enters at finance review, never further along: the
  // thing that was wrong has to be re-checked by the person who checks things.
  returned: ['finance_review', 'rejected'],
};

export function canTransition(from: CompletionStatus, to: CompletionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: CompletionStatus): readonly CompletionStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function isClosed(status: CompletionStatus): boolean {
  return status === 'completed' || status === 'rejected';
}

export function isOpen(status: CompletionStatus): boolean {
  return !isClosed(status);
}

/** True once the Director has approved completion (the certificate exists). */
export function hasCertificate(status: CompletionStatus): boolean {
  return (
    status === 'certificate_issued' ||
    status === 'transfer_in_progress' ||
    status === 'transfer_uploaded' ||
    status === 'final_review' ||
    status === 'completed'
  );
}

/** True once the ownership-transfer document is on file. */
export function hasTransferDocument(status: CompletionStatus): boolean {
  return status === 'transfer_uploaded' || status === 'final_review' || status === 'completed';
}

/**
 * How far along the chain a request is, 0..1, for a progress bar.
 *
 * Rejected returns 0 rather than a partial figure: a refused request has made
 * no progress towards completion, whatever stage it reached first, and drawing
 * it as 60% complete would be actively misleading.
 */
export function progressOf(status: CompletionStatus): number {
  if (status === 'rejected') return 0;
  if (status === 'completed') return 1;
  const ORDER: CompletionStatus[] = [
    'requested',
    'finance_review',
    'finance_cleared',
    'director_review',
    'director_approved',
    'certificate_issued',
    'transfer_in_progress',
    'transfer_uploaded',
    'final_review',
  ];
  const i = ORDER.indexOf(status === 'returned' ? 'requested' : status);
  return i < 0 ? 0 : (i + 1) / (ORDER.length + 1);
}

/**
 * Can a rider ask to complete this contract?
 *
 * The answer is deliberately NOT "only when the balance is zero". A rider whose
 * term has ended but who still owes two days should be able to raise the
 * request — that is exactly the conversation finance needs to have with them,
 * and blocking it would leave them with no way to start it. What cannot happen
 * is the request being APPROVED with money outstanding, and that is enforced at
 * approval and again at sign-off (0034 rule 2b).
 */
export type EligibilityInput = {
  contractStatus: string;
  /** Ledger-derived outstanding amount, integer TZS. */
  outstanding: number;
  /** Obligations still scheduled in the future (the term has not run out). */
  futureObligations: number;
  hasOpenRequest: boolean;
  contractEndDate: string | null;
  today: string;
};

export type Eligibility =
  | { ok: true; warning: string | null }
  | { ok: false; reason: CompletionBlockReason };

export type CompletionBlockReason =
  | 'no_contract'
  | 'contract_not_active'
  | 'already_requested'
  | 'already_completed';

export function canRequestCompletion(input: EligibilityInput): Eligibility {
  if (input.hasOpenRequest) return { ok: false, reason: 'already_requested' };
  if (input.contractStatus === 'completed' || input.contractStatus === 'completed_early') {
    return { ok: false, reason: 'already_completed' };
  }
  // 'active' and 'paused' both allow it: a paused contract is one the owner
  // suspended, and a rider who has finished paying should still be able to ask.
  if (input.contractStatus !== 'active' && input.contractStatus !== 'paused') {
    return { ok: false, reason: 'contract_not_active' };
  }

  // Warnings, not refusals — the rider may raise the request anyway and finance
  // will tell them where they stand.
  if (input.outstanding > 0) {
    return {
      ok: true,
      warning: 'outstanding_balance',
    };
  }
  if (input.futureObligations > 0) {
    return { ok: true, warning: 'term_not_finished' };
  }
  return { ok: true, warning: null };
}

export const BLOCK_REASONS_SW: Record<CompletionBlockReason, string> = {
  no_contract: 'Hauna mkataba unaoendelea.',
  contract_not_active: 'Mkataba wako hauko katika hali inayoruhusu ombi hili.',
  already_requested: 'Una ombi la kumaliza mkataba linaendelea.',
  already_completed: 'Mkataba wako umekamilika tayari.',
};

export const WARNINGS_SW: Record<string, string> = {
  outstanding_balance:
    'Bado unadaiwa. Unaweza kutuma ombi, lakini uhasibu wataomba umalize kwanza.',
  term_not_finished:
    'Mkataba wako bado una siku zilizosalia. Unaweza kutuma ombi, lakini uhasibu wataangalia.',
};
