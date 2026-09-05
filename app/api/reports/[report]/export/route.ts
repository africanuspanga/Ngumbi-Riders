import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { checkPermission } from '@/lib/auth/session';
import { localDateString } from '@/lib/dates/tz';
import { toCsv, type CsvCell } from '@/lib/reports/csv';
import { getCollectionReport, getArrearsReport, getExpenseReport, getFinancialReport } from '@/lib/reports/queries';
import { getRiderStatement } from '@/lib/payments/queries';
import { formatDate } from '@/lib/dates/format';
import { methodLabel } from '@/lib/payments/statement';

// Report exports (spec §19.3): CSV and XLSX. Owner + active accountant
// (`reports.export`, build spec #10). Print-friendly output is the report page
// itself; PDF export is a tracked follow-up.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// XLSX generation over a long date range needs more than the short default.
export const maxDuration = 120;

type Table = { title: string; headers: string[]; rows: CsvCell[][] };

async function buildTable(
  report: string,
  from: string,
  to: string,
  riderId: string | null,
): Promise<Table | null> {
  // General financial report — the bank-statement export the owner asked for:
  // every transaction, then a per-rider contribution summary in the same sheet.
  if (report === 'financial') {
    const r = await getFinancialReport(from, to);
    const rows: CsvCell[][] = [
      ...r.transactions.map((t) => [
        formatDate(t.date),
        t.riderNumber,
        t.riderName,
        methodLabel(t.method),
        t.receivedByName ?? '',
        t.receiptNumber ?? '',
        t.amount,
      ]),
      [],
      ['TOTAL', '', '', '', '', '', r.totals.total],
      ['Cash', '', '', '', '', '', r.totals.cash],
      ['Mobile money', '', '', '', '', '', r.totals.mobile],
      [],
      ['Contribution by rider', '', '', '', '', '', ''],
      ['Rider #', 'Rider', 'Payments', 'Cash', 'Mobile', 'First', 'Total'],
      ...r.contributions.map((c) => [
        c.riderNumber,
        c.riderName,
        c.payments,
        c.cash,
        c.mobile,
        formatDate(c.firstPayment),
        c.total,
      ]),
    ];
    return {
      title: `Financial statement ${from}..${to}`,
      headers: ['Date', 'Rider #', 'Rider', 'Method', 'Received by', 'Receipt', 'Amount'],
      rows,
    };
  }

  // One rider's bank-style statement, with the running balance.
  if (report === 'rider-statement') {
    if (!riderId) return null;
    const s = await getRiderStatement(riderId, { from: from === to ? null : from, to: to || null });
    if (!s) return null;
    return {
      title: `Statement ${s.riderNumber}`,
      headers: ['Date', 'Description', 'Charged', 'Received', 'Balance'],
      rows: [
        ['', 'Opening balance', '', '', s.statement.openingBalance],
        ...s.statement.lines.map((l) => [
          formatDate(l.date),
          l.description,
          l.debit || '',
          l.credit || '',
          l.balance,
        ]),
        ['', 'Closing balance', s.statement.totalCharged, s.statement.totalReceived, s.statement.closingBalance],
        [],
        ['', 'Outstanding now', '', '', s.progress.outstandingNow],
        ['', 'Remaining to finish contract', '', '', s.progress.totalRemaining],
        ['', 'Expected completion', '', '', formatDate(s.progress.projectedEndDate)],
      ],
    };
  }

  if (report === 'collections') {
    const r = await getCollectionReport(from, to);
    return {
      title: `Collections ${from}..${to}`,
      headers: ['Metric', 'Value'],
      rows: [
        ['Expected', r.expected],
        ['Settled', r.settled],
        ['Payments received', r.paymentsReceived],
        ['Cash', r.cash],
        ['Mobile money', r.mobile],
        ['Collection rate', r.collectionRate === null ? '—' : `${Math.round(r.collectionRate * 100)}%`],
        ['Arrears created', r.arrearsCreated],
        ['Arrears recovered', r.arrearsRecovered],
      ],
    };
  }
  if (report === 'arrears') {
    const r = await getArrearsReport();
    return {
      title: 'Arrears',
      headers: ['Rider', 'Rider #', 'Oldest overdue', 'Days overdue', 'Count', 'Amount'],
      rows: r.rows.map((x) => [x.riderName, x.riderNumber, x.oldestOverdue, x.daysOverdue, x.count, x.amount]),
    };
  }
  if (report === 'expenses') {
    const r = await getExpenseReport(from, to);
    return {
      title: `Expenses ${from}..${to}`,
      headers: ['Date', 'Motorcycle', 'Category', 'Amount', 'Note'],
      rows: r.rows.map((x) => [x.date, x.registration, x.category, x.amount, x.note]),
    };
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  // Server-side permission check: the accountant reaches this URL from their
  // own report page, and a rider must never be able to fetch it by guessing.
  const profile = await checkPermission('reports.export');
  if (!profile) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { report } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'csv';
  // Validate dates: junk input would crash the range computation, and these
  // values also flow into the Content-Disposition filename.
  const isDate = (v: string | null): v is string =>
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to')! : localDateString();
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from')! : to;

  const riderParam = url.searchParams.get('rider');
  const riderId =
    riderParam && /^[0-9a-f-]{36}$/i.test(riderParam) ? riderParam : null;
  const table = await buildTable(report, from, to, riderId);
  if (!table) return NextResponse.json({ error: 'unknown_report' }, { status: 404 });

  const filename = `${report.replace(/[^\w-]/g, '')}-${from}_${to}`;

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report);
    ws.addRow(table.headers);
    for (const row of table.rows) ws.addRow(row as (string | number)[]);
    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      },
    });
  }

  const csv = toCsv(table.headers, table.rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  });
}
