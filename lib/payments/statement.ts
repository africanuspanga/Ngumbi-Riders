/*
 * Rider payment statement (client feedback 2026-09-05): "there should also be
 * a payment statement similar to a bank statement".
 *
 * A bank statement is a chronological list of what was CHARGED and what was
 * RECEIVED, with a running balance after every line. Here:
 *
 *   debit  — an obligation falling due (the rider is billed that day),
 *   credit — a completed payment (cash or mobile money) arriving.
 *
 * The running balance is therefore "what the rider owed after this line".
 * Positive = owing, negative = paid ahead. That is exactly how the owner reads
 * an M-Pesa or bank statement, so nothing needs explaining.
 *
 * Ordering matters and is deliberate: on a day where both a charge and a
 * payment land, the CHARGE is listed first, so the payment visibly clears it
 * rather than appearing to arrive against nothing.
 *
 * Pure and dependency-free so the running balance is unit tested.
 */

export type StatementCharge = {
  date: string; // YYYY-MM-DD (obligation due date)
  amount: number;
  /** 'lease' | 'phone_loan' — a phone instalment reads differently. */
  kind?: string;
  status: string;
};

export type StatementCredit = {
  date: string; // YYYY-MM-DD (payment completed date, local)
  amount: number;
  method: string; // 'cash' | 'mobile_money'
  paymentId: string;
  receiptNumber?: string | null;
  /** Staff member who received cash — blank for mobile money. */
  receivedByName?: string | null;
  note?: string | null;
};

export type StatementLine = {
  date: string;
  type: 'charge' | 'credit';
  description: string;
  debit: number;
  credit: number;
  balance: number;
  method?: string;
  paymentId?: string;
  receiptNumber?: string | null;
  receivedByName?: string | null;
};

export type Statement = {
  openingBalance: number;
  closingBalance: number;
  totalCharged: number;
  totalReceived: number;
  lines: StatementLine[];
};

/** Obligation statuses that were actually billed to the rider. */
const BILLED = new Set(['scheduled', 'due', 'overdue', 'paid', 'paid_in_advance']);

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
};

export function methodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

/**
 * Build the statement for a window. Charges and credits from BEFORE `from`
 * are folded into the opening balance instead of being dropped, so a
 * date-ranged statement still reconciles — the same guarantee a bank gives.
 */
export function buildStatement(
  charges: StatementCharge[],
  credits: StatementCredit[],
  range?: { from?: string | null; to?: string | null },
): Statement {
  const from = range?.from ?? null;
  const to = range?.to ?? null;

  const billed = charges.filter((c) => BILLED.has(c.status));

  const before = (d: string) => Boolean(from) && d < from!;
  const after = (d: string) => Boolean(to) && d > to!;

  const openingBalance =
    billed.filter((c) => before(c.date)).reduce((s, c) => s + c.amount, 0) -
    credits.filter((c) => before(c.date)).reduce((s, c) => s + c.amount, 0);

  type Row = { date: string; order: number; line: Omit<StatementLine, 'balance'> };
  const rows: Row[] = [];

  for (const c of billed) {
    if (before(c.date) || after(c.date)) continue;
    rows.push({
      date: c.date,
      order: 0, // charges first on a shared day
      line: {
        date: c.date,
        type: 'charge',
        description: c.kind === 'phone_loan' ? 'Phone loan instalment due' : 'Lease payment due',
        debit: c.amount,
        credit: 0,
      },
    });
  }

  for (const p of credits) {
    if (before(p.date) || after(p.date)) continue;
    rows.push({
      date: p.date,
      order: 1,
      line: {
        date: p.date,
        type: 'credit',
        description: p.receivedByName
          ? `Payment received (${methodLabel(p.method)} — received by ${p.receivedByName})`
          : `Payment received (${methodLabel(p.method)})`,
        debit: 0,
        credit: p.amount,
        method: p.method,
        paymentId: p.paymentId,
        receiptNumber: p.receiptNumber ?? null,
        receivedByName: p.receivedByName ?? null,
      },
    });
  }

  rows.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));

  let balance = openingBalance;
  const lines: StatementLine[] = rows.map((r) => {
    balance += r.line.debit - r.line.credit;
    return { ...r.line, balance };
  });

  return {
    openingBalance,
    closingBalance: balance,
    totalCharged: lines.reduce((s, l) => s + l.debit, 0),
    totalReceived: lines.reduce((s, l) => s + l.credit, 0),
    lines,
  };
}
