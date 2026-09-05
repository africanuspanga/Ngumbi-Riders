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
  | 'approved'
  | 'rejected'
  | 'cancelled';

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
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
