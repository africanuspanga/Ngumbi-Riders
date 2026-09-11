/*
 * Purchase-requisition reference data (client feedback 2026-09-05).
 *
 * PURE and dependency-free: the form, the server action and the printed view
 * all read the same lists, so a category can never render as a raw enum in one
 * place and a label in another (the leak fixed across the app on 2026-07-11).
 *
 * The vocabulary is deliberately this project's vocabulary — motorcycles,
 * spare parts, fuel, phones, rider collections — not generic procurement
 * wording, because Mr. Ng'umbi reads these requests.
 */

/** What the spend belongs to. */
export const REQUISITION_DEPARTMENTS = [
  'fleet',
  'operations',
  'finance',
  'administration',
] as const;
export type RequisitionDepartment = (typeof REQUISITION_DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<RequisitionDepartment, string> = {
  fleet: 'Fleet (motorcycles)',
  operations: 'Operations',
  finance: 'Finance',
  administration: 'Administration',
};

/**
 * What is being bought. The first eight mirror the motorcycle expense ledger
 * (lib/expenses/validation.ts) so an approved requisition and the expense it
 * later becomes are filed under the same word; `motorcycle`, `phone` and
 * `office` are the procurement-side additions.
 */
export const REQUISITION_ITEM_CATEGORIES = [
  'motorcycle',
  'spare_parts',
  'maintenance',
  'repair',
  'service',
  'fuel',
  'insurance',
  'registration',
  'phone',
  'office',
  'other',
] as const;
export type RequisitionItemCategory = (typeof REQUISITION_ITEM_CATEGORIES)[number];

export const ITEM_CATEGORY_LABELS: Record<RequisitionItemCategory, string> = {
  motorcycle: 'Motorcycle',
  spare_parts: 'Spare parts',
  maintenance: 'Maintenance',
  repair: 'Repair',
  service: 'Service',
  fuel: 'Fuel',
  insurance: 'Insurance',
  registration: 'Registration',
  phone: 'Phone',
  office: 'Office & administration',
  other: 'Other',
};

/** Unit of measure. */
export const REQUISITION_UNITS = [
  'unit',
  'piece',
  'set',
  'litre',
  'box',
  'service',
  'month',
  'kilogram',
] as const;
export type RequisitionUnit = (typeof REQUISITION_UNITS)[number];

export const UNIT_LABELS: Record<RequisitionUnit, string> = {
  unit: 'Unit',
  piece: 'Piece',
  set: 'Set',
  litre: 'Litre',
  box: 'Box',
  service: 'Service',
  month: 'Month',
  kilogram: 'Kilogram',
};

/** Where the money to pay for this line comes from. */
export const REQUISITION_BUDGET_COVERS = [
  'collections',
  'owner_capital',
  'financing',
  'other',
] as const;
export type RequisitionBudgetCover = (typeof REQUISITION_BUDGET_COVERS)[number];

export const BUDGET_COVER_LABELS: Record<RequisitionBudgetCover, string> = {
  collections: 'Rider collections',
  owner_capital: 'Owner capital',
  financing: 'Loan / financing',
  other: 'Other',
};

export type RequisitionStatus =
  | 'draft'
  | 'submitted'
  // Picked up but not ruled on (migration 0032). Added at the END of the
  // Postgres enum, because an enum's order is part of its identity.
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
};

/** Every amount in this system is integer TZS (spec rule 11). */
export const REQUISITION_CURRENCY = 'TZS';
export const CURRENCY_LABEL = 'Tanzania Shilling (TZS)';

/** At most ten supporting documents, matched by a DB trigger in 0028. */
export const MAX_REQUISITION_DOCUMENTS = 10;

/*
 * 4 MiB per file. The form the client showed says 10MB, but Vercel rejects a
 * request body over ~4.5 MB with an opaque 413 — promising 10 would just move
 * the failure somewhere the accountant cannot understand it (D-030).
 */
export const MAX_REQUISITION_DOC_BYTES = 4 * 1024 * 1024;

/*
 * GIF appears on the client's form but is deliberately absent: the magic-byte
 * sniffer this codebase validates every upload with (lib/applications/
 * file-signature.ts) does not recognise it, and accepting a file we cannot
 * verify is worse than not accepting it. Quotations are PDFs or photographs.
 */
export const REQUISITION_DOC_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const REQUISITION_DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';

/**
 * Fiscal year of a request = the calendar year on its date, read TEXTUALLY.
 * A calendar date is never passed through a Date here: converting it would
 * shift a 1 January request into the previous year for anyone west of EAT
 * (the date-splitting rule from build spec #5).
 */
export function yearOf(isoDate: string): number {
  return parseInt(isoDate.slice(0, 4), 10);
}

/* ------------------------------------------------------------------------ *
 * Payment progress after approval (client feedback 2026-09-06)
 * ------------------------------------------------------------------------ */

/**
 * Whether the owner has released money for an APPROVED purchase.
 *
 * Deliberately NOT part of `RequisitionStatus`: approval and payment are two
 * different questions, and folding them into one enum would make "approved"
 * ambiguous and force every existing status check to be re-read. A request is
 * approved OR rejected; separately, an approved one is unpaid, processing or
 * paid.
 */
export type RequisitionPaymentStatus = 'unpaid' | 'processing' | 'paid';

export const REQUISITION_PAYMENT_STATUSES: readonly RequisitionPaymentStatus[] = [
  'unpaid',
  'processing',
  'paid',
] as const;

export const PAYMENT_STATUS_LABELS: Record<RequisitionPaymentStatus, string> = {
  unpaid: 'Not paid',
  processing: 'Payment processing',
  paid: 'Paid',
};

/** What each stage means, in the owner's and accountant's terms. */
export const PAYMENT_STATUS_DESCRIPTIONS: Record<RequisitionPaymentStatus, string> = {
  unpaid: 'Approved, but no money has been released yet.',
  processing: 'Payment has been started — bank transfer, cash or mobile money in progress.',
  paid: 'The supplier has been paid in full.',
};

/**
 * The single line a reader — including the printed PDF — should see for a
 * requisition, combining the decision and the money.
 *
 * A rejected or draft request has no payment stage worth printing, so only an
 * approved one gets the second half.
 */
export function requisitionStageLabel(
  status: RequisitionStatus,
  paymentStatus: RequisitionPaymentStatus,
): string {
  if (status !== 'approved') return REQUISITION_STATUS_LABELS[status];
  return `${REQUISITION_STATUS_LABELS.approved} · ${PAYMENT_STATUS_LABELS[paymentStatus]}`;
}

/* ------------------------------------------------------------------------ *
 * Requisition kind, and retirement (client feedback 2026-09-11 #14)
 * ------------------------------------------------------------------------ */

/**
 * WHAT is being requested. Distinct from `category`, which describes a LINE:
 * a motorcycle-purchase requisition may well have a line for registration and
 * a line for insurance. The type is what the request is FOR, and it is what
 * the reports filter on.
 */
export const REQUISITION_TYPES = [
  'general',
  'phone',
  'motorcycle',
  'department_expense',
] as const;
export type RequisitionType = (typeof REQUISITION_TYPES)[number];

export const REQUISITION_TYPE_LABELS: Record<RequisitionType, string> = {
  general: 'General / operational',
  phone: 'Phone purchase',
  motorcycle: 'Motorcycle purchase',
  department_expense: 'Department expense',
};

/**
 * Whether money already released has been ACCOUNTED FOR.
 *
 * A third orthogonal axis alongside `status` (what the Director decided) and
 * `paymentStatus` (whether money moved), for the reason 0029 gave when it
 * refused to fold payment into status: three independent questions need three
 * independent answers, and one enum carrying all of them makes 'approved'
 * ambiguous and breaks every existing status check.
 */
export type RequisitionRetirementStatus = 'not_started' | 'pending' | 'completed';

export const RETIREMENT_STATUSES: readonly RequisitionRetirementStatus[] = [
  'not_started',
  'pending',
  'completed',
] as const;

export const RETIREMENT_STATUS_LABELS: Record<RequisitionRetirementStatus, string> = {
  not_started: 'Not due yet',
  pending: 'Retirement pending',
  completed: 'Retired',
};

export const RETIREMENT_STATUS_DESCRIPTIONS: Record<RequisitionRetirementStatus, string> = {
  not_started: 'Nothing to account for yet — the money has not been released.',
  pending: 'The money has been paid out and is waiting to be accounted for with receipts.',
  completed: 'Accounted for: receipts filed and the actual spend recorded.',
};

/** What documents may be attached, and when (enforced by the 0033 trigger). */
export const REQUISITION_DOC_TYPES = [
  'supporting',
  'invoice',
  'proof_of_payment',
  'receipt',
  'retirement',
] as const;
export type RequisitionDocType = (typeof REQUISITION_DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<RequisitionDocType, string> = {
  supporting: 'Supporting document',
  invoice: 'Invoice / proforma',
  proof_of_payment: 'Proof of payment',
  receipt: 'Receipt',
  retirement: 'Retirement document',
};

/** Attachable while the request is still a draft (what the decision is made on). */
export const PRE_DECISION_DOC_TYPES: readonly RequisitionDocType[] = ['supporting', 'invoice'];
/** Attachable only after approval (evidence of what happened to the money). */
export const POST_DECISION_DOC_TYPES: readonly RequisitionDocType[] = [
  'proof_of_payment',
  'receipt',
  'retirement',
];

/**
 * The ONE sentence a human should read, from all three axes.
 *
 * Extends `requisitionStageLabel` rather than replacing it: that function is
 * already on the printed PDF and in the list, and a printed requisition must
 * keep saying what it said. This adds the retirement half only when there is
 * something to say.
 */
export function requisitionFullStageLabel(
  status: RequisitionStatus,
  paymentStatus: RequisitionPaymentStatus,
  retirementStatus: RequisitionRetirementStatus,
): string {
  const base = requisitionStageLabel(status, paymentStatus);
  if (status !== 'approved' || retirementStatus === 'not_started') return base;
  return `${base} · ${RETIREMENT_STATUS_LABELS[retirementStatus]}`;
}

/**
 * What should happen next, and who does it. Returning null means "nothing is
 * waiting on anybody" — a closed request, or one whose money was never
 * released. Used by the queues so neither the Director nor the accountant has
 * to work out whose turn it is.
 */
export function nextRequisitionAction(
  status: RequisitionStatus,
  paymentStatus: RequisitionPaymentStatus,
  retirementStatus: RequisitionRetirementStatus,
): { actor: 'accountant' | 'owner'; action: string } | null {
  if (status === 'draft') return { actor: 'accountant', action: 'Submit the request' };
  if (status === 'submitted' || status === 'under_review') {
    return { actor: 'owner', action: 'Approve or reject' };
  }
  if (status !== 'approved') return null;
  if (paymentStatus !== 'paid') return { actor: 'owner', action: 'Release the payment' };
  if (retirementStatus !== 'completed') {
    return { actor: 'accountant', action: 'Retire: file receipts and record the actual spend' };
  }
  return null;
}
