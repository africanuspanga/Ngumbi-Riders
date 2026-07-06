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
import { WEEKDAY_LABELS } from './validation';

/*
 * Server-side contract PDF generation (spec §10.4, §10.5). Renders the
 * versioned contract into an A4 document. The caller stores the PDF in private
 * storage and records a SHA-256 hash; signed documents are never overwritten.
 * Kept server-only (heavy Node renderer).
 */

export type ContractPdfData = {
  contractNumber: string;
  templateBody: string;
  templateVersion: number;
  riderName: string;
  riderNumber: string;
  registration: string;
  installmentAmount: number;
  paymentDeadlineTime: string;
  startDate: string | null;
  endDate: string | null;
  scheduleType: 'daily' | 'selected_weekdays';
  selectedWeekdays: number[];
  ownershipTransfers: boolean;
  ownershipTransferNotes: string | null;
  specialTerms: string | null;
  generatedAtLabel: string;
};

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 11, lineHeight: 1.5, color: '#122117' },
  title: { fontSize: 18, marginBottom: 4, color: '#163D24' },
  subtitle: { fontSize: 10, color: '#607066', marginBottom: 16 },
  section: { marginBottom: 12 },
  h2: { fontSize: 13, marginBottom: 6, color: '#163D24' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  label: { color: '#607066' },
  body: { marginBottom: 10 },
  sigRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
  sigBox: { width: '45%', borderTop: '1px solid #122117', paddingTop: 4, fontSize: 10 },
});

function ContractDoc({ d }: { d: ContractPdfData }) {
  const schedule =
    d.scheduleType === 'daily'
      ? 'Every day'
      : d.selectedWeekdays.map((w) => WEEKDAY_LABELS[w]).join(', ');
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Ng&apos;umbi Riders — Motorcycle Lease Agreement</Text>
        <Text style={s.subtitle}>
          {d.contractNumber} · Template v{d.templateVersion} · Generated {d.generatedAtLabel}
        </Text>

        <View style={s.section}>
          <View style={s.row}><Text style={s.label}>Rider</Text><Text>{d.riderName} ({d.riderNumber})</Text></View>
          <View style={s.row}><Text style={s.label}>Motorcycle</Text><Text>{d.registration}</Text></View>
          <View style={s.row}><Text style={s.label}>Installment</Text><Text>{formatTZS(d.installmentAmount)}</Text></View>
          <View style={s.row}><Text style={s.label}>Payment deadline</Text><Text>{d.paymentDeadlineTime}</Text></View>
          <View style={s.row}><Text style={s.label}>Term</Text><Text>{d.startDate} to {d.endDate}</Text></View>
          <View style={s.row}><Text style={s.label}>Schedule</Text><Text>{schedule}</Text></View>
          <View style={s.row}><Text style={s.label}>Ownership transfers</Text><Text>{d.ownershipTransfers ? 'Yes' : 'No'}</Text></View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Terms</Text>
          <Text style={s.body}>{d.templateBody}</Text>
          {d.ownershipTransfers && d.ownershipTransferNotes && (
            <Text style={s.body}>Ownership transfer: {d.ownershipTransferNotes}</Text>
          )}
          {d.specialTerms && <Text style={s.body}>Special terms: {d.specialTerms}</Text>}
        </View>

        <View style={s.sigRow}>
          <Text style={s.sigBox}>Owner signature &amp; date</Text>
          <Text style={s.sigBox}>Rider signature &amp; date</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderContractPdf(d: ContractPdfData): Promise<Buffer> {
  return renderToBuffer(<ContractDoc d={d} />);
}
