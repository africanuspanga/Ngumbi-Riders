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
        [...months.entries()].map(([month, list]) => (
          <div key={month} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted">{month}</h2>
            <div className="grid grid-cols-7 gap-1.5">
              {list.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date} · ${d.status}`}
                  className={`flex aspect-square items-center justify-center rounded text-[10px] font-medium text-white ${DOT[d.color]}`}
                >
                  {d.date.slice(8)}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
