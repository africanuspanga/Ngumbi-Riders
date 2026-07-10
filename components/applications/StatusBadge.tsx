import type { ApplicationStatus } from '@/lib/supabase/types';
import { STATUS_META } from '@/lib/applications/status';

const TONE_CLASS: Record<string, string> = {
  neutral: 'bg-surface text-muted-foreground',
  progress: 'bg-blue-50 text-[color:var(--color-advance)]',
  good: 'bg-surface text-[color:var(--color-paid)]',
  bad: 'bg-red-50 text-[color:var(--color-overdue)]',
  warn: 'bg-amber-50 text-[color:var(--color-warning)]',
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}
