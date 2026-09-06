import 'server-only';

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { lineAmount, requisitionTotal } from './compute';
import {
  BUDGET_COVER_LABELS,
  DEPARTMENT_LABELS,
  ITEM_CATEGORY_LABELS,
  PAYMENT_STATUS_LABELS,
  REQUISITION_STATUS_LABELS,
  UNIT_LABELS,
  requisitionStageLabel,
  type RequisitionBudgetCover,
  type RequisitionDepartment,
  type RequisitionItemCategory,
  type RequisitionPaymentStatus,
  type RequisitionStatus,
  type RequisitionUnit,
} from './constants';

/*
 * The printable purchase requisition (client feedback 2026-09-06).
 *
 * Modelled on the reference document the client supplied — grey section bars,
 * a label/value block, one ruled item table, an approver table and a page
 * footer — with two deliberate departures:
 *
 *   • the accent is Ng'umbi green, not the reference's blue. The layout is
 *     what the client asked to copy; the colour is this business's own.
 *   • no "landing cost per kg" block. The reference is a freight importer's
 *     form; a lease business buying motorcycles and spare parts has no such
 *     figure, and printing an empty section is worse than omitting it.
 *
 * Downloadable AT ANY STAGE, as asked, and the stage is stated on the face of
 * the document: a draft prints "Draft" and an approved-and-paid one prints
 * "Approved · Paid". A printed page that did not say which is which would end
 * up in a supplier's hands looking like an authorisation it is not.
 *
 * Nothing here is stored. Amounts are recomputed from the lines by the same
 * pure functions the screen uses (D-034 rule 3), so a printed total can never
 * disagree with the total that was approved.
 */

/** House palette, matching the web app's tokens. */
const GREEN = '#2F8F46';
const GREEN_DARK = '#163D24';
const INK = '#122117';
const MUTED = '#5F6F65';
const RULE = '#DCE4DE';
const BAR = '#F1F4F2';
const ZEBRA = '#FAFBFA';

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: 40,
    fontSize: 9.5,
    lineHeight: 1.45,
    color: INK,
    fontFamily: 'Helvetica',
  },

  // --- letterhead ---------------------------------------------------------
  brandName: {
    fontSize: 17,
    fontFamily: 'Helvetica-Bold',
    color: GREEN_DARK,
    textAlign: 'center',
    // Descenders in the wordmark collided with the strapline without this.
    marginBottom: 4,
  },
  brandLine: { fontSize: 8.5, color: MUTED, textAlign: 'center', lineHeight: 1.35 },
  rule: { borderBottomWidth: 1.5, borderBottomColor: GREEN, marginTop: 8, marginBottom: 14 },

  docTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    color: INK,
    marginBottom: 10,
    letterSpacing: 0.5,
  },

  // --- the meta strip under the title -------------------------------------
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  metaCell: { fontSize: 9 },
  metaLabel: { color: MUTED },

  // --- section bars -------------------------------------------------------
  sectionBar: { backgroundColor: BAR, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: GREEN, letterSpacing: 0.6 },
  section: { marginBottom: 16 },

  // --- label / value grid -------------------------------------------------
  cols: { flexDirection: 'row', gap: 18 },
  col: { flex: 1 },
  field: { flexDirection: 'row', marginBottom: 4 },
  fieldLabel: { width: 74, color: MUTED },
  fieldValue: { flex: 1 },
  bold: { fontFamily: 'Helvetica-Bold' },

  // --- tables -------------------------------------------------------------
  th: { backgroundColor: GREEN, color: '#FFFFFF', flexDirection: 'row', paddingVertical: 5 },
  thText: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingHorizontal: 5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 5 },
  trAlt: { backgroundColor: ZEBRA },
  td: { fontSize: 8.5, paddingHorizontal: 5 },
  right: { textAlign: 'right' },

  totalRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: GREEN,
    marginTop: 2,
  },

  note: { color: MUTED, marginTop: 2 },

  /*
   * In normal flow, NOT absolutely positioned. Three separate absolute+fixed
   * layouts were tried against @react-pdf/renderer 4.5.1 and every one of them
   * rendered nothing at all — the box is dropped rather than drawn. A footer
   * that silently disappears is worse than one that sits after the content, so
   * this is the layout that was actually verified to appear.
   */
  footer: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: GREEN,
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  footerText: { fontSize: 7.5, color: MUTED },
});

export type RequisitionPdfItem = {
  position: number;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  budgetCover: string;
};

export type RequisitionPdfData = {
  requisitionNumber: string;
  title: string;
  description: string | null;
  department: string;
  fiscalYear: number;
  requestDate: string;
  currency: string;
  paymentInformation: string | null;
  status: RequisitionStatus;
  paymentStatus: RequisitionPaymentStatus;
  requestedByName: string;
  approverName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  paymentMarkedByName: string | null;
  paymentMarkedAt: string | null;
  paymentNote: string | null;
  submittedAt: string | null;
  createdAt: string;
  items: RequisitionPdfItem[];
  /** Who pressed Download, printed in the footer like the reference does. */
  generatedByName: string;
};

/** A label/value pair in the information grid. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  );
}

function SectionBar({ children }: { children: string }) {
  return (
    <View style={s.sectionBar}>
      <Text style={s.sectionTitle}>{children}</Text>
    </View>
  );
}

/** Column widths for the item table, summing to 100. */
const COL = { n: 4, desc: 34, qty: 8, unit: 10, price: 14, amount: 15, cover: 15 };

function RequisitionDoc({ d }: { d: RequisitionPdfData }) {
  const total = requisitionTotal(
    d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })),
  );
  const stage = requisitionStageLabel(d.status, d.paymentStatus);

  /*
   * The approval trail, built from what actually happened rather than from a
   * fixed list of roles. The reference form prints five rows (HOD, Accountant,
   * CFO, MD…) because that business has five approvers; this one has exactly
   * two parties, and inventing empty rows for offices that do not exist would
   * make the document look unfinished forever.
   */
  const approvals: { role: string; name: string; status: string; date: string }[] = [
    {
      role: 'Requested by',
      name: d.requestedByName,
      status: d.submittedAt ? 'Submitted' : 'Draft',
      date: d.submittedAt ? formatDate(d.submittedAt) : '—',
    },
    {
      role: 'Managing Director',
      name: d.decidedByName ?? d.approverName ?? '—',
      status:
        d.status === 'approved'
          ? 'Approved'
          : d.status === 'rejected'
            ? 'Rejected'
            : d.status === 'cancelled'
              ? 'Withdrawn'
              : 'Pending',
      date: d.decidedAt ? formatDate(d.decidedAt) : '—',
    },
  ];
  if (d.status === 'approved') {
    approvals.push({
      role: 'Payment',
      name: d.paymentMarkedByName ?? '—',
      status: PAYMENT_STATUS_LABELS[d.paymentStatus],
      date: d.paymentMarkedAt ? formatDate(d.paymentMarkedAt) : '—',
    });
  }

  return (
    <Document
      title={`${d.requisitionNumber} — ${d.title}`}
      author="Ng'umbi Riders"
      subject="Purchase requisition"
    >
      <Page size="A4" style={s.page}>
        {/* --- letterhead ------------------------------------------------ */}
        <Text style={s.brandName}>NG&apos;UMBI RIDERS</Text>
        <Text style={s.brandLine}>Motorcycle Lease &amp; Rider Payment Management</Text>
        <Text style={s.brandLine}>Tanzania · www.ngumbi.co.tz</Text>
        <View style={s.rule} />

        <Text style={s.docTitle}>PURCHASE REQUISITION</Text>

        <View style={s.metaRow}>
          <Text style={s.metaCell}>
            <Text style={s.metaLabel}>Request #: </Text>
            <Text style={s.bold}>{d.requisitionNumber}</Text>
          </Text>
          <Text style={s.metaCell}>
            <Text style={s.metaLabel}>Total: </Text>
            <Text style={s.bold}>{formatTZS(total)}</Text>
          </Text>
          <Text style={s.metaCell}>
            <Text style={s.metaLabel}>Printed: </Text>
            {formatDate(new Date())}
          </Text>
        </View>

        {/* --- basic information ----------------------------------------- */}
        <View style={s.section}>
          <SectionBar>BASIC INFORMATION</SectionBar>
          <View style={s.cols}>
            <View style={s.col}>
              <Field label="Title" value={d.title} />
              <Field label="Description" value={d.description ?? '—'} />
              <Field label="Requested by" value={d.requestedByName} />
            </View>
            <View style={s.col}>
              <Field label="Request date" value={formatDate(d.requestDate)} />
              <Field
                label="Department"
                value={
                  DEPARTMENT_LABELS[d.department as RequisitionDepartment] ?? d.department
                }
              />
              <Field label="Fiscal year" value={String(d.fiscalYear)} />
              <Field label="Currency" value={d.currency} />
              <Field label="Status" value={stage} />
            </View>
          </View>
        </View>

        {/* --- payment information --------------------------------------- */}
        {d.paymentInformation ? (
          <View style={s.section}>
            <SectionBar>PAYMENT INFORMATION</SectionBar>
            <Text>{d.paymentInformation}</Text>
          </View>
        ) : null}

        {/* --- items ------------------------------------------------------ */}
        <View style={s.section}>
          <SectionBar>REQUEST ITEMS</SectionBar>
          <View style={s.th} fixed>
            <Text style={[s.thText, { width: `${COL.n}%` }]}>#</Text>
            <Text style={[s.thText, { width: `${COL.desc}%` }]}>Description</Text>
            <Text style={[s.thText, s.right, { width: `${COL.qty}%` }]}>Qty</Text>
            <Text style={[s.thText, { width: `${COL.unit}%` }]}>UoM</Text>
            <Text style={[s.thText, s.right, { width: `${COL.price}%` }]}>Unit price</Text>
            <Text style={[s.thText, s.right, { width: `${COL.amount}%` }]}>Amount</Text>
            <Text style={[s.thText, { width: `${COL.cover}%` }]}>Budget cover</Text>
          </View>

          {d.items.map((item, index) => (
            <View
              key={`${item.position}-${index}`}
              style={index % 2 === 1 ? [s.tr, s.trAlt] : s.tr}
              wrap={false}
            >
              <Text style={[s.td, { width: `${COL.n}%` }]}>{index + 1}</Text>
              <Text style={[s.td, { width: `${COL.desc}%` }]}>
                {item.description}
                {'\n'}
                <Text style={{ color: MUTED, fontSize: 7.5 }}>
                  {ITEM_CATEGORY_LABELS[item.category as RequisitionItemCategory] ??
                    item.category}
                </Text>
              </Text>
              <Text style={[s.td, s.right, { width: `${COL.qty}%` }]}>{item.quantity}</Text>
              <Text style={[s.td, { width: `${COL.unit}%` }]}>
                {UNIT_LABELS[item.unit as RequisitionUnit] ?? item.unit}
              </Text>
              <Text style={[s.td, s.right, { width: `${COL.price}%` }]}>
                {formatTZS(item.unitPrice)}
              </Text>
              <Text style={[s.td, s.right, { width: `${COL.amount}%` }]}>
                {formatTZS(lineAmount({ quantity: item.quantity, unitPrice: item.unitPrice }))}
              </Text>
              <Text style={[s.td, { width: `${COL.cover}%` }]}>
                {BUDGET_COVER_LABELS[item.budgetCover as RequisitionBudgetCover] ??
                  item.budgetCover}
              </Text>
            </View>
          ))}

          <View style={s.totalRow}>
            <Text style={[s.td, s.right, s.bold, { width: `${COL.n + COL.desc + COL.qty + COL.unit + COL.price}%` }]}>
              TOTAL
            </Text>
            <Text style={[s.td, s.right, s.bold, { width: `${COL.amount}%` }]}>
              {formatTZS(total)}
            </Text>
            <Text style={[s.td, { width: `${COL.cover}%` }]} />
          </View>
        </View>

        {/* --- approvals -------------------------------------------------- */}
        <View style={s.section} wrap={false}>
          <SectionBar>APPROVALS</SectionBar>
          <View style={s.th}>
            <Text style={[s.thText, { width: '25%' }]}>Role</Text>
            <Text style={[s.thText, { width: '35%' }]}>Name</Text>
            <Text style={[s.thText, { width: '22%' }]}>Status</Text>
            <Text style={[s.thText, { width: '18%' }]}>Date</Text>
          </View>
          {approvals.map((a, index) => (
            <View key={a.role} style={index % 2 === 1 ? [s.tr, s.trAlt] : s.tr}>
              <Text style={[s.td, { width: '25%' }]}>{a.role}</Text>
              <Text style={[s.td, { width: '35%' }]}>{a.name}</Text>
              <Text style={[s.td, { width: '22%' }]}>{a.status}</Text>
              <Text style={[s.td, { width: '18%' }]}>{a.date}</Text>
            </View>
          ))}
        </View>

        {/* --- notes ------------------------------------------------------ */}
        {d.decisionNote || d.paymentNote ? (
          <View style={s.section} wrap={false}>
            <SectionBar>NOTES</SectionBar>
            {d.decisionNote ? (
              <Text style={s.note}>
                <Text style={s.bold}>Decision: </Text>
                {d.decisionNote}
              </Text>
            ) : null}
            {d.paymentNote ? (
              <Text style={s.note}>
                <Text style={s.bold}>Payment: </Text>
                {d.paymentNote}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* A draft or a rejected request must never be mistaken for an
            authorisation once it is off the screen and on paper. */}
        {d.status !== 'approved' ? (
          <Text style={[s.note, s.bold]}>
            This document is {REQUISITION_STATUS_LABELS[d.status].toLowerCase()} and is NOT an
            authorisation to purchase.
          </Text>
        ) : null}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Generated by: {d.generatedByName}</Text>
          <Text style={s.footerText}>
            Computer generated document. No signature required.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/** Render the requisition to a PDF buffer. Server-only (heavy Node renderer). */
export function renderRequisitionPdf(data: RequisitionPdfData): Promise<Buffer> {
  return renderToBuffer(<RequisitionDoc d={data} />);
}
