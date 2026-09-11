import 'server-only';

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import { formatLongDate, formatDate } from '@/lib/dates/format';

/*
 * CERTIFICATE OF ACCOMPLISHMENT (client feedback 2026-09-11 #7).
 *
 * "After the director approves that the rider has completed the contract, the
 *  system should automatically generate a certificate of accomplishment"
 * carrying the rider's full name, the motorcycle details, the contract code,
 * its start and end dates, confirmation of completion, a director signature
 * area and the date issued.
 *
 * LANDSCAPE, unlike every other document this system prints. A certificate is
 * something a rider frames; portrait A4 with a green header bar would look like
 * an invoice. Same palette as the requisition PDF so the two are visibly from
 * the same business.
 *
 * EVERY FIELD COMES FROM A SNAPSHOT taken at the moment of issue, never
 * re-derived at download time. A certificate is a statement about a moment: if
 * the rider later changes their name, or the motorcycle is re-registered, the
 * certificate they were handed must keep saying what it said. That is why
 * contract_certificates carries a `snapshot` jsonb column and this function
 * takes plain values rather than ids.
 *
 * KNOWN LIMITATION, inherited from the requisition PDF: @react-pdf/renderer
 * 4.5.1 renders NOTHING for an absolutely-positioned footer and produces no
 * output for <Text render={…} />, so there is no "page X of Y". A certificate
 * is one page, so this costs nothing here.
 */

const GREEN = '#2F8F46';
const GREEN_DARK = '#163D24';
const INK = '#122117';
const MUTED = '#5F6F65';
const RULE = '#DCE4DE';
const GOLD = '#9A7B27';

const s = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 34,
    paddingHorizontal: 44,
    fontSize: 10,
    color: INK,
    fontFamily: 'Helvetica',
  },
  // A double rule around the whole page, which is what makes a page read as a
  // certificate rather than a letter.
  frameOuter: {
    borderWidth: 2,
    borderColor: GREEN,
    borderStyle: 'solid',
    padding: 5,
    height: '100%',
  },
  frameInner: {
    borderWidth: 0.75,
    borderColor: GOLD,
    borderStyle: 'solid',
    height: '100%',
    paddingTop: 26,
    paddingBottom: 20,
    paddingHorizontal: 34,
  },

  brand: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: GREEN_DARK,
    textAlign: 'center',
    letterSpacing: 1.1,
  },
  strapline: {
    fontSize: 8.5,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
  },
  title: {
    fontSize: 25,
    fontFamily: 'Helvetica-Bold',
    color: GREEN_DARK,
    textAlign: 'center',
    letterSpacing: 2.2,
    marginTop: 20,
  },
  subtitle: {
    fontSize: 9.5,
    color: MUTED,
    textAlign: 'center',
    letterSpacing: 2.4,
    marginTop: 5,
  },
  divider: {
    alignSelf: 'center',
    width: 92,
    borderBottomWidth: 1.5,
    borderBottomColor: GOLD,
    marginTop: 12,
    marginBottom: 16,
  },

  presented: {
    fontSize: 9.5,
    color: MUTED,
    textAlign: 'center',
    letterSpacing: 1.1,
  },
  riderName: {
    fontSize: 27,
    fontFamily: 'Helvetica-Bold',
    color: GREEN,
    textAlign: 'center',
    marginTop: 8,
  },
  riderNumber: {
    fontSize: 9,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
  },
  body: {
    fontSize: 10.5,
    lineHeight: 1.55,
    textAlign: 'center',
    marginTop: 16,
    marginHorizontal: 26,
  },
  bodyStrong: { fontFamily: 'Helvetica-Bold' },

  // --- the facts ----------------------------------------------------------
  factsRow: { flexDirection: 'row', marginTop: 20, gap: 14 },
  factCol: { flex: 1 },
  factLabel: {
    fontSize: 7.5,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  factValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  factRule: { borderBottomWidth: 0.75, borderBottomColor: RULE, marginTop: 5 },

  // --- signatures ---------------------------------------------------------
  signRow: { flexDirection: 'row', marginTop: 34, gap: 40 },
  signCol: { flex: 1 },
  signLine: { borderBottomWidth: 0.75, borderBottomColor: INK, height: 26 },
  signName: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 5 },
  signRole: { fontSize: 7.5, color: MUTED, marginTop: 1 },

  footer: {
    marginTop: 18,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 7.5, color: MUTED },
});

/**
 * The facts printed on a certificate. Plain values, captured at issue time —
 * see the header on why this is not a set of ids.
 */
export type CertificateData = {
  certificateNumber: string;
  riderName: string;
  riderNumber: string;
  motorcycleNumber: string;
  motorcycleRegistration: string | null;
  motorcycleMake: string | null;
  motorcycleModel: string | null;
  motorcycleChassis: string | null;
  contractNumber: string;
  contractStartDate: string | null;
  contractEndDate: string | null;
  /** Total the rider paid over the life of the contract, integer TZS. */
  totalPaid: number | null;
  /** Whether ownership of the motorcycle transfers to the rider. */
  ownershipTransfers: boolean;
  directorName: string;
  issuedOn: string;
  /** ISO date the request was signed off, when it has been. */
  signedOffOn: string | null;
};

function motorcycleLine(d: CertificateData): string {
  const parts = [
    [d.motorcycleMake, d.motorcycleModel].filter(Boolean).join(' '),
    d.motorcycleRegistration ? `Reg. ${d.motorcycleRegistration}` : null,
    d.motorcycleNumber,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.join(' · ');
}

export function CertificateDocument({ data }: { data: CertificateData }) {
  const ownership = data.ownershipTransfers
    ? 'and that ownership of the motorcycle described below has been transferred to them'
    : 'having met every obligation under the contract described below';

  return (
    <Document
      title={`Certificate of Accomplishment ${data.certificateNumber}`}
      author="Ng'umbi Riders"
      subject={`${data.riderName} — ${data.contractNumber}`}
    >
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.frameOuter}>
          <View style={s.frameInner}>
            <Text style={s.brand}>NG&rsquo;UMBI RIDERS</Text>
            <Text style={s.strapline}>Motorcycle lease-to-own · Tanzania</Text>

            <Text style={s.title}>CERTIFICATE</Text>
            <Text style={s.subtitle}>OF ACCOMPLISHMENT</Text>
            <View style={s.divider} />

            <Text style={s.presented}>THIS CERTIFICATE IS PRESENTED TO</Text>
            <Text style={s.riderName}>{data.riderName}</Text>
            <Text style={s.riderNumber}>Rider number {data.riderNumber}</Text>

            <Text style={s.body}>
              in recognition of the successful completion of their motorcycle lease agreement with
              Ng&rsquo;umbi Riders, {ownership}. All payment obligations under this contract have
              been settled in full and verified by the company&rsquo;s finance function
              {data.totalPaid !== null ? (
                <Text>
                  , with total payments of{' '}
                  <Text style={s.bodyStrong}>
                    TZS {Math.round(data.totalPaid).toLocaleString('en-US')}
                  </Text>
                </Text>
              ) : (
                <Text />
              )}
              .
            </Text>

            <View style={s.factsRow}>
              <Fact label="Contract code" value={data.contractNumber} />
              <Fact
                label="Contract start"
                value={data.contractStartDate ? formatDate(data.contractStartDate) : '—'}
              />
              <Fact
                label="Contract end"
                value={data.contractEndDate ? formatDate(data.contractEndDate) : '—'}
              />
            </View>
            <View style={s.factsRow}>
              <Fact label="Motorcycle" value={motorcycleLine(data)} />
              <Fact label="Chassis number" value={data.motorcycleChassis ?? '—'} />
              <Fact
                label="Ownership"
                value={data.ownershipTransfers ? 'Transferred to rider' : 'Retained by company'}
              />
            </View>

            <View style={s.signRow}>
              <View style={s.signCol}>
                <View style={s.signLine} />
                <Text style={s.signName}>{data.directorName}</Text>
                <Text style={s.signRole}>Managing Director, Ng&rsquo;umbi Riders</Text>
              </View>
              <View style={s.signCol}>
                <View style={s.signLine} />
                <Text style={s.signName}>{data.riderName}</Text>
                <Text style={s.signRole}>Rider</Text>
              </View>
            </View>

            <View style={s.footer}>
              <Text style={s.footerText}>
                Certificate no. {data.certificateNumber} · Issued{' '}
                {formatLongDate(data.issuedOn)}
              </Text>
              <Text style={s.footerText}>
                {data.signedOffOn
                  ? `Signed off ${formatDate(data.signedOffOn)}`
                  : 'Awaiting final sign-off'}
              </Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.factCol}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
      <View style={s.factRule} />
    </View>
  );
}

/** Render the certificate to a PDF buffer. */
export async function renderCertificate(data: CertificateData): Promise<Buffer> {
  return renderToBuffer(<CertificateDocument data={data} />);
}
