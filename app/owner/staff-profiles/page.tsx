import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listStaffProfiles } from '@/lib/staff/profile-queries';
import {
  EMPLOYMENT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  awaitsReview,
} from '@/lib/staff/profile-constants';
import { formatDate } from '@/lib/dates/format';

export const metadata = { title: 'Staff profiles' };

/**
 * The Director's staff-record list (client feedback #9).
 *
 * Driven from the SIGN-IN accounts, not from the HR table, so a colleague who
 * has never filled their record in still appears — with empty fields — rather
 * than being invisible. "Nothing to review" and "never asked" are different
 * facts and the Director needs to tell them apart.
 */
export default async function OwnerStaffProfilesPage() {
  await requireOwner();
  const people = await listStaffProfiles();
  const waiting = people.filter((p) => awaitsReview(p.reviewStatus));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Staff profiles</h1>
        <p className="text-sm text-muted-foreground">
          Employment records for the people who use this system. Separate from sign-in access,
          which is managed on the{' '}
          <Link href="/owner/staff" className="underline">
            Staff
          </Link>{' '}
          page.
        </p>
      </header>

      {waiting.length > 0 && (
        <p className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {waiting.length} profile{waiting.length === 1 ? '' : 's'} awaiting your review:{' '}
          {waiting.map((p) => p.fullName).join(', ')}.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {people.map((p) => (
          <li
            key={p.profileId}
            className={`flex flex-wrap items-start justify-between gap-3 rounded-[--radius-card] border bg-white p-4 ${
              awaitsReview(p.reviewStatus)
                ? 'border-[color:var(--color-warning)]/50'
                : 'border-border'
            }`}
          >
            <div className="min-w-0">
              <p className="font-semibold text-primary-dark">
                <Link href={`/owner/staff-profiles/${p.profileId}`} className="hover:underline">
                  {p.fullName}
                </Link>
              </p>
              <p className="text-sm text-muted-foreground">
                {p.jobTitle ?? p.role} · {p.email ?? 'no email'}
                {p.startDate ? ` · started ${formatDate(p.startDate)}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.certificates.length} certificate{p.certificates.length === 1 ? '' : 's'} ·{' '}
                system access {p.hasAccess ? 'enabled' : 'disabled'}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold">
                {EMPLOYMENT_STATUS_LABELS[p.employmentStatus]}
              </span>
              <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold">
                {REVIEW_STATUS_LABELS[p.reviewStatus]}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
