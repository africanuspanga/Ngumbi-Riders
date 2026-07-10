import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { getRiderCalendar } from '@/lib/dashboard/queries';
import type { CalendarColor } from '@/lib/dashboard/rider';

export const metadata = { title: 'Kalenda' };

const DOT: Record<CalendarColor, string> = {
  green: 'bg-[color:var(--color-paid)]',
  red: 'bg-[color:var(--color-overdue)]',
  amber: 'bg-[color:var(--color-warning)]',
  blue: 'bg-[color:var(--color-advance)]',
  grey: 'bg-[color:var(--color-exempt)]',
  neutral: 'bg-border',
};

const LEGEND: { color: CalendarColor; label: string }[] = [
  { color: 'green', label: 'Imelipwa' },
  { color: 'red', label: 'Deni' },
  { color: 'amber', label: 'Ya leo' },
  { color: 'blue', label: 'Malipo ya awali' },
  { color: 'grey', label: 'Msamaha' },
  { color: 'neutral', label: 'Ijayo' },
];

// Rider-facing: Swahili labels, never raw status enums (spec §36.11).
const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Ijayo',
  due: 'Ya leo',
  overdue: 'Deni',
  paid: 'Imelipwa',
  paid_in_advance: 'Malipo ya awali',
  exempted: 'Msamaha',
  postponed: 'Imeahirishwa',
  cancelled: 'Imeghairiwa',
};

// Sunday-first, matching getUTCDay().
const WEEKDAYS = ['Jpi', 'Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijm', 'Jms'];

function monthParts(key: string): { y: number; m: number } {
  // key is YYYY-MM (derived from due_date slices), so both parts always exist.
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return { y, m };
}

function monthLabel(key: string): string {
  const { y, m } = monthParts(key);
  return new Intl.DateTimeFormat('sw-TZ', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

export default async function CalendarPage() {
  await requireRider();
  const days = await getRiderCalendar();

  // Group by YYYY-MM for a compact, low-bandwidth list.
  const months = new Map<string, typeof days>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(d);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/rider" className="text-sm font-medium text-muted">← Nyumbani</Link>
        <h1 className="mt-1 text-xl font-bold text-primary-dark">Kalenda ya malipo</h1>
      </div>

      <div className="flex flex-wrap gap-3 rounded-[--radius-card] border border-border bg-white p-3 text-xs">
        {LEGEND.map((l) => (
          <span key={l.color} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-full ${DOT[l.color]}`} />
            {l.label}
          </span>
        ))}
      </div>

      {days.length === 0 ? (
        <p className="text-muted">Hakuna kalenda kwa sasa.</p>
      ) : (
        [...months.entries()].map(([month, list]) => {
          // Real calendar layout: columns are weekdays, with leading offset
          // cells and gap cells for days without an obligation — a packed
          // grid of obligation days only reads like a calendar but isn't.
          const { y, m } = monthParts(month);
          const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
          const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
          const byDate = new Map(list.map((d) => [d.date, d]));
          return (
            <div key={month} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-muted">{monthLabel(month)}</h2>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="text-center text-[10px] font-semibold text-muted">
                    {w}
                  </div>
                ))}
                {Array.from({ length: firstWeekday }, (_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                  const d = byDate.get(date);
                  if (!d) {
                    return (
                      <div
                        key={date}
                        className="flex aspect-square items-center justify-center rounded text-[10px] text-muted"
                      >
                        {i + 1}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={date}
                      title={`${d.date} · ${STATUS_LABEL[d.status] ?? d.status}`}
                      className={`flex aspect-square items-center justify-center rounded text-[10px] font-medium text-white ${DOT[d.color]}`}
                    >
                      {i + 1}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
