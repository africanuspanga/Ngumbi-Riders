/*
 * Phone-loan request vocabulary (client feedback 2026-09-11 #11, #12).
 *
 * PURE and dependency-free: the rider's page, the accountant's queue, the
 * Director's queue and the notifications all read these labels, so a status
 * can never render as a raw enum in one place and a sentence in another (the
 * leak fixed across the app on 2026-07-11).
 *
 * The Swahili strings are the RIDER-facing ones. Riders see Swahili (spec rule
 * 11); staff screens are English, like the rest of the back office.
 */

export type PhoneLoanRequestStatus =
  | 'submitted'
  | 'under_review'
  | 'requisition_raised'
  | 'requisition_approved'
  | 'purchased'
  | 'active'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export const PHONE_LOAN_REQUEST_STATUSES: readonly PhoneLoanRequestStatus[] = [
  'submitted',
  'under_review',
  'requisition_raised',
  'requisition_approved',
  'purchased',
  'active',
  'completed',
  'rejected',
  'cancelled',
] as const;

/** Still moving through the workflow — neither finished nor refused. */
export const OPEN_REQUEST_STATUSES: readonly PhoneLoanRequestStatus[] = [
  'submitted',
  'under_review',
  'requisition_raised',
  'requisition_approved',
  'purchased',
  'active',
] as const;

export const REQUEST_STATUS_LABELS: Record<PhoneLoanRequestStatus, string> = {
  submitted: 'Submitted',
  under_review: 'With finance',
  requisition_raised: 'Purchase request raised',
  requisition_approved: 'Purchase approved',
  purchased: 'Phone purchased',
  active: 'Repaying',
  completed: 'Repaid in full',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
};

export const REQUEST_STATUS_LABELS_SW: Record<PhoneLoanRequestStatus, string> = {
  submitted: 'Imewasilishwa',
  under_review: 'Inapitiwa na uhasibu',
  requisition_raised: 'Ombi la manunuzi limetolewa',
  requisition_approved: 'Manunuzi yameidhinishwa',
  purchased: 'Simu imenunuliwa',
  active: 'Unalipa mkopo wa simu',
  completed: 'Umemaliza kulipa',
  rejected: 'Halikubaliwa',
  cancelled: 'Limeondolewa',
};

/** What the rider should understand is happening, in Swahili. */
export const REQUEST_STATUS_HELP_SW: Record<PhoneLoanRequestStatus, string> = {
  submitted: 'Ombi lako limepokelewa. Uhasibu wataliangalia.',
  under_review: 'Uhasibu wanatafuta bei na ankara ya simu.',
  requisition_raised: 'Ombi la kununua simu limepelekwa kwa Mkurugenzi.',
  requisition_approved: 'Mkurugenzi ameidhinisha. Simu itanunuliwa.',
  purchased: 'Simu imenunuliwa. Mkopo utaanza hivi karibuni.',
  active: 'Unalipa mkopo wa simu. Malipo ya pikipiki yamesimama kwa muda.',
  completed: 'Umemaliza kulipa simu. Malipo ya pikipiki yameendelea.',
  rejected: 'Ombi lako halikukubaliwa. Angalia sababu hapa chini.',
  cancelled: 'Uliondoa ombi hili.',
};

/**
 * WHOSE MOVE IT IS. Returned as data so every queue can say it the same way
 * and neither the accountant nor the Director has to work out whether a
 * request is theirs.
 */
export type RequestActor = 'rider' | 'accountant' | 'owner' | 'nobody';

export const NEXT_ACTOR: Record<PhoneLoanRequestStatus, RequestActor> = {
  submitted: 'accountant',
  under_review: 'accountant',
  // The requisition itself is now with the Director; the request waits on it.
  requisition_raised: 'owner',
  // Approved: finance buys the phone and retires the requisition.
  requisition_approved: 'accountant',
  // Bought: finance activates the loan, which generates the instalments.
  purchased: 'accountant',
  active: 'rider',
  completed: 'nobody',
  rejected: 'nobody',
  cancelled: 'nobody',
};

export const NEXT_ACTION: Record<PhoneLoanRequestStatus, string> = {
  submitted: 'Review the request and confirm the rider is eligible',
  under_review: 'Attach the invoice and raise the purchase requisition',
  requisition_raised: 'Approve or reject the purchase requisition',
  requisition_approved: 'Buy the phone, then mark it purchased',
  purchased: 'Activate the loan — this generates the instalments and pauses the lease',
  active: 'Rider is repaying the instalments',
  completed: '',
  rejected: '',
  cancelled: '',
};

/*
 * Legal transitions. `activate` is the only one that touches money, and it is
 * the one the DB function activate_phone_loan() guards independently — this
 * table is the convenience layer, not the control.
 *
 * Note what is absent: 'submitted' -> 'active'. Finance review and the
 * Director's approval of the purchase cannot be skipped, which is the whole
 * point of routing a phone loan through a requisition rather than letting an
 * accountant simply grant one.
 */
const TRANSITIONS: Record<PhoneLoanRequestStatus, readonly PhoneLoanRequestStatus[]> = {
  submitted: ['under_review', 'rejected', 'cancelled'],
  under_review: ['requisition_raised', 'rejected', 'cancelled'],
  requisition_raised: ['requisition_approved', 'rejected', 'cancelled'],
  requisition_approved: ['purchased', 'rejected', 'cancelled'],
  purchased: ['active', 'rejected', 'cancelled'],
  active: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransitionRequest(
  from: PhoneLoanRequestStatus,
  to: PhoneLoanRequestStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** True while the rider may still withdraw their own request. */
export function isWithdrawable(status: PhoneLoanRequestStatus): boolean {
  // Once the Director has approved a purchase, money is being committed on the
  // rider's behalf and withdrawing is no longer a private decision.
  return status === 'submitted' || status === 'under_review';
}

export function isOpenRequest(status: PhoneLoanRequestStatus): boolean {
  return OPEN_REQUEST_STATUSES.includes(status);
}

/** Default commercial limits, used when app_settings cannot be read. */
export const FALLBACK_LIMITS = {
  maxAmount: 350_000,
  maxMonths: 3,
  interestBps: 5000,
} as const;
