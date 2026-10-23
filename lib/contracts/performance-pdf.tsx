import 'server-only';

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime, formatLongDate } from '@/lib/dates/format';
import { GRADE_LABELS, PAYMENT_METHOD_LABELS, SCHEDULE_LABELS } from './performance';
import type { ContractPerformanceReport } from './performance-queries';

/*
 * Printable rider performance report (client request 2026-10-23). Same house
 * style as the requisition PDF: green letterhead rule, grey section bars, one
 * ruled table. Generated per request from the ledger, never stored (D-034).
 */


const GREEN = '#2F8F46';
const GREEN_DARK = '#163D24';
const RED = '#B42318';
const INK = '#122117';
const MUTED = '#5F6F65';
const RULE = '#DCE4DE';
const BAR = '#F1F4F2';

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 40, paddingHorizontal: 40, fontSize: 9.5, lineHeight: 1.45, color: INK, fontFamily: 'Helvetica' },
  brandName: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: GREEN_DARK, textAlign: 'center', marginBottom: 4 },
  brandLine: { fontSize: 8.5, color: MUTED, textAlign: 'center' },
  rule: { borderBottomWidth: 1.5, borderBottomColor: GREEN, marginTop: 8, marginBottom: 14 },
  docTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 4, letterSpacing: 0.5 },
  docSub: { fontSize: 9, textAlign: 'center', color: MUTED, marginBottom: 14 },
  sectionBar: { backgroundColor: BAR, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: GREEN, letterSpacing: 0.6 },
  section: { marginBottom: 14 },
  cols: { flexDirection: 'row', gap: 18 },
  col: { flex: 1 },
  field: { flexDirection: 'row', marginBottom: 3 },
  fieldLabel: { width: 108, color: MUTED },
  fieldValue: { flex: 1 },
  bold: { fontFamily: 'Helvetica-Bold' },
  red: { color: RED, fontFamily: 'Helvetica-Bold' },
  green: { color: GREEN, fontFamily: 'Helvetica-Bold' },
  kpis: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpi: { flex: 1, borderWidth: 0.75, borderColor: RULE, padding: 7 },
  kpiLabel: { fontSize: 7.5, color: MUTED, letterSpacing: 0.4 },
  kpiValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  th: { backgroundColor: GREEN, color: '#FFFFFF', flexDirection: 'row', paddingVertical: 4 },
  thText: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingHorizontal: 5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 4 },
  td: { fontSize: 8.5, paddingHorizontal: 5 },
  right: { textAlign: 'right' },
  signRow: { flexDirection: 'row', gap: 30, marginTop: 28 },
  signBox: { flex: 1, borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 4, fontSize: 8.5, color: MUTED },
  footer: { marginTop: 18, fontSize: 7.5, color: MUTED, textAlign: 'center' },
});

function Field({ label, value, style }: { label: string; value: string; style?: (typeof s)[keyof typeof s] }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={[s.fieldValue, style ?? {}]}>{value}</Text>
    </View>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export async function renderPerformancePdf(
  report: ContractPerformanceReport,
  generatedByName: string,
): Promise<Buffer> {
  const p = report.performance;
  const ended = report.terminatedOn !== null;

  const doc = (
    <Document title={`Performance report ${report.contractNumber}`} author="Ng'umbi Riders">
      <Page size="A4" style={s.page}>
        <Text style={s.brandName}>NG&apos;UMBI RIDERS</Text>
        <Text style={s.brandLine}>Motorcycle lease management · Tanzania · www.ngumbi.co.tz</Text>
        <View style={s.rule} />

        <Text style={s.docTitle}>RIDER PERFORMANCE REPORT</Text>
        <Text style={s.docSub}>
          Contract {report.contractNumber} ·{' '}
          {ended ? `terminated ${formatDate(report.terminatedOn)}` : `as of ${formatDate(p.cutoffDate)}`}
        </Text>

        <View style={s.section}>
          <View style={s.sectionBar}>
            <Text style={s.sectionTitle}>RIDER AND CONTRACT</Text>
          </View>
          <View style={s.cols}>
            <View style={s.col}>
              <Field label="Rider" value={report.rider.name} style={s.bold} />
              <Field label="Rider number" value={report.rider.riderNumber} />
              <Field label="Phone" value={report.rider.phone ?? '—'} />
              <Field
                label="Motorcycle"
                value={
                  report.motorcycle
                    ? `${report.motorcycle.code}${report.motorcycle.registration ? ` · ${report.motorcycle.registration}` : ''}`
                    : '—'
                }
              />
            </View>
            <View style={s.col}>
              <Field label="Started" value={formatLongDate(report.startDate)} style={s.bold} />
              <Field
                label={ended ? 'Terminated' : 'Report date'}
                value={formatLongDate(p.cutoffDate)}
                style={ended ? s.red : s.bold}
              />
              <Field label="Scheduled end" value={formatDate(report.scheduledEndDate)} />
              <Field
                label="Terms"
                value={`${SCHEDULE_LABELS[report.scheduleType] ?? report.scheduleType} · ${formatTZS(report.installmentAmount)}`}
              />
              <Field label="Days on contract" value={String(p.daysOnContract)} />
            </View>
          </View>
        </View>

        <View style={s.kpis}>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>TOTAL PAID</Text>
            <Text style={[s.kpiValue, { color: GREEN }]}>{formatTZS(p.totalPaid)}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>{ended ? 'OWED AT TERMINATION' : 'OUTSTANDING'}</Text>
            <Text style={[s.kpiValue, { color: p.outstandingValue > 0 ? RED : GREEN }]}>
              {formatTZS(p.outstandingValue)}
            </Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>EXPECTED TO DATE</Text>
            <Text style={s.kpiValue}>{formatTZS(p.expectedValue)}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>COLLECTION RATE</Text>
            <Text style={s.kpiValue}>{p.collectionRate.toFixed(1)}%</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.sectionBar}>
            <Text style={s.sectionTitle}>PAYMENT BEHAVIOUR</Text>
          </View>
          <View style={s.cols}>
            <View style={s.col}>
              <Field label="Rating" value={GRADE_LABELS[p.grade]} style={s.bold} />
              <Field label="Payment days due" value={`${p.expectedCount}`} />
              <Field label="Paid on time" value={`${p.onTimeCount} (${p.onTimeRate.toFixed(1)}%)`} />
              <Field
                label="Paid late"
                value={`${p.lateCount}${p.lateCount > 0 ? ` · avg ${p.averageDaysLate} days late` : ''}`}
              />
              <Field label="Never paid" value={`${p.outstandingCount} · ${formatTZS(p.outstandingValue)}`} style={p.outstandingCount > 0 ? s.red : undefined} />
              <Field label="Waived by owner" value={`${p.waivedCount} · ${formatTZS(p.waivedValue)}`} />
            </View>
            <View style={s.col}>
              <Field label="First payment" value={formatDate(p.firstPaymentDate)} />
              <Field label="Last payment" value={formatDate(p.lastPaymentDate)} />
              <Field label="Days since last pay" value={p.daysSinceLastPayment === null ? '—' : String(p.daysSinceLastPayment)} />
              {p.paidByMethod.map((m) => (
                <Field
                  key={m.method}
                  label={`${PAYMENT_METHOD_LABELS[m.method] ?? m.method} (${m.count})`}
                  value={formatTZS(m.amount)}
                />
              ))}
              <Field label="Days cleared (value)" value={formatTZS(p.settledValue)} />
              <Field label="Contract value" value={formatTZS(report.contractValue)} />
            </View>
          </View>
        </View>

        {p.months.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionBar}>
              <Text style={s.sectionTitle}>MONTH BY MONTH</Text>
            </View>
            <View style={s.th} fixed>
              <Text style={[s.thText, { flex: 2 }]}>Month</Text>
              <Text style={[s.thText, s.right, { flex: 2 }]}>Expected</Text>
              <Text style={[s.thText, s.right, { flex: 2 }]}>Paid</Text>
              <Text style={[s.thText, s.right, { flex: 2 }]}>Outstanding</Text>
            </View>
            {p.months.map((m) => (
              <View key={m.month} style={s.tr} wrap={false}>
                <Text style={[s.td, { flex: 2 }]}>{monthLabel(m.month)}</Text>
                <Text style={[s.td, s.right, { flex: 2 }]}>{formatTZS(m.expected)}</Text>
                <Text style={[s.td, s.right, { flex: 2 }]}>{formatTZS(m.settled)}</Text>
                <Text style={[s.td, s.right, { flex: 2 }, m.outstanding > 0 ? s.red : {}]}>
                  {formatTZS(m.outstanding)}
                </Text>
              </View>
            ))}
            <View style={[s.tr, { borderBottomWidth: 0 }]}>
              <Text style={[s.td, s.bold, { flex: 2 }]}>Total</Text>
              <Text style={[s.td, s.right, s.bold, { flex: 2 }]}>{formatTZS(p.expectedValue)}</Text>
              <Text style={[s.td, s.right, s.bold, { flex: 2 }]}>{formatTZS(p.settledValue)}</Text>
              <Text style={[s.td, s.right, { flex: 2 }, p.outstandingValue > 0 ? s.red : s.bold]}>
                {formatTZS(p.outstandingValue)}
              </Text>
            </View>
          </View>
        )}

        <View style={s.signRow} wrap={false}>
          <Text style={s.signBox}>Managing Director — signature &amp; date</Text>
          <Text style={s.signBox}>Rider — signature &amp; date</Text>
        </View>

        <Text style={s.footer}>
          Generated {formatDateTime(new Date())} by {generatedByName}. Figures are computed from the
          payment ledger up to {formatDate(p.cutoffDate)}; days after that date are not counted as
          owed.
        </Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
