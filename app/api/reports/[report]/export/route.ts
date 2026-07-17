import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getSessionProfile } from '@/lib/auth/session';
import { localDateString } from '@/lib/dates/tz';
import { toCsv, type CsvCell } from '@/lib/reports/csv';
import { getCollectionReport, getArrearsReport, getExpenseReport } from '@/lib/reports/queries';

// Report exports (spec §19.3): CSV and XLSX. Owner-only. Print-friendly output
// is the report page itself; PDF export is a tracked follow-up.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// XLSX generation over a long date range needs more than the short default.
export const maxDuration = 120;

type Table = { title: string; headers: string[]; rows: CsvCell[][] };

async function buildTable(report: string, from: string, to: string): Promise<Table | null> {
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
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { report } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'csv';
  // Validate dates: junk input would crash the range computation, and these
  // values also flow into the Content-Disposition filename.
  const isDate = (v: string | null): v is string =>
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to')! : localDateString();
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from')! : to;

  const table = await buildTable(report, from, to);
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
