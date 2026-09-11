'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveStaffProfile,
  submitStaffProfile,
  uploadStaffCertificate,
  deleteStaffCertificate,
  reviewStaffProfile,
  setEmploymentStatus,
} from '@/lib/staff/profile';
import {
  CERTIFICATE_ACCEPT,
  CERTIFICATE_KINDS,
  CERTIFICATE_KIND_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_HINTS,
  EMPLOYMENT_STATUS_LABELS,
  REVIEW_STATUS_HINTS,
  REVIEW_STATUS_LABELS,
  type EmploymentStatus,
  type StaffCertificateKind,
} from '@/lib/staff/profile-constants';
import type { StaffProfileRow } from '@/lib/staff/profile-queries';

/*
 * The staff record, editable (client feedback #9).
 *
 * ONE component for both audiences, differing only in `canReview`:
 *   an employee  fills it in, attaches certificates, submits it;
 *   the Director does all of that plus approve/return, and is the only role
 *                that can set an employment status.
 *
 * The employment-status control is rendered ONLY for the Director. That is
 * cosmetic — `setEmploymentStatus` requires `staff_profiles.review`, which no
 * accountant holds, and `saveStaffProfile` does not accept the field at all, so
 * an employee cannot promote themselves even by forging a request (spec rule 3
 * and rule 12).
 */

const ERRORS: Record<string, string> = {
  validation: 'Check the highlighted fields.',
  forbidden: 'You do not have permission to change this record.',
  not_found: 'That record no longer exists — reload the page.',
  already_approved: 'This record has already been approved.',
  reason_required: 'Say what needs changing.',
  title_required: 'Give the certificate a title.',
  too_large: 'Each file must be 4 MiB or smaller.',
  too_many: 'You already have the maximum number of certificates attached.',
  invalid_type: 'That file is not a PDF, JPG, PNG or WebP.',
  upload_failed: 'The upload failed. Try again.',
  insert_failed: 'The file uploaded but could not be recorded. Try again.',
  no_file: 'Choose a file first.',
  bad_request: 'Something was missing from that request — reload the page.',
  server_error: 'A server error occurred. Reload the page and try again.',
};

export function StaffProfileForm({
  record,
  canReview,
}: {
  record: StaffProfileRow;
  /** True for the Managing Director: approval, return and employment status. */
  canReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [phone, setPhone] = useState(record.phone ?? '');
  const [jobTitle, setJobTitle] = useState(record.jobTitle ?? '');
  const [startDate, setStartDate] = useState(record.startDate ?? '');
  const [endDate, setEndDate] = useState(record.endDate ?? '');
  const [education, setEducation] = useState(record.education ?? '');
  const [workExperience, setWorkExperience] = useState(record.workExperience ?? '');
  const [notes, setNotes] = useState(record.notes ?? '');

  const [kind, setKind] = useState<StaffCertificateKind>('education');
  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issuedOn, setIssuedOn] = useState('');

  const [reviewNote, setReviewNote] = useState('');
  const [returning, setReturning] = useState(false);

  async function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successNotice: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      if (res.ok) {
        setNotice(successNotice);
        setReturning(false);
        router.refresh();
      } else {
        setError(ERRORS[res.error ?? ''] ?? 'That did not work. Reload the page and try again.');
      }
    } catch {
      setError('Network error — reload the page to see whether it went through.');
    } finally {
      setBusy(false);
    }
  }

  async function upload(formData: FormData) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      formData.set('profileId', record.profileId);
      formData.set('kind', kind);
      formData.set('title', title);
      formData.set('issuer', issuer);
      formData.set('issuedOn', issuedOn);
      const res = await uploadStaffCertificate(formData);
      if (res.ok) {
        setNotice(`${res.data?.fileName ?? 'File'} attached.`);
        setTitle('');
        setIssuer('');
        setIssuedOn('');
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? 'The upload failed. Try again.');
      }
    } catch {
      setError('Network error — reload the page to see whether the file arrived.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* --- who they are, from the auth record --------------------------- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-primary-dark">{record.fullName}</h2>
            <p className="text-sm text-muted-foreground">
              {record.email ?? 'No email on file'} · {record.role}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold">
              {REVIEW_STATUS_LABELS[record.reviewStatus]}
            </span>
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold">
              {EMPLOYMENT_STATUS_LABELS[record.employmentStatus]}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {REVIEW_STATUS_HINTS[record.reviewStatus]}
        </p>
        {record.reviewNote && (
          <p className="rounded-[--radius-card] border border-border bg-surface px-3 py-2 text-sm">
            <span className="font-semibold">
              {record.reviewedByName ? `${record.reviewedByName}: ` : 'Director: '}
            </span>
            {record.reviewNote}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Name, email and role come from the sign-in account and are changed on the Staff page.
          System access is{' '}
          <strong className="font-semibold">{record.hasAccess ? 'enabled' : 'disabled'}</strong> —
          separate from the employment status below.
        </p>
      </section>

      {notice && (
        <p role="status" className="text-sm font-medium text-[color:var(--color-paid)]">
          ✓ {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}

      {/* --- the record --------------------------------------------------- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone number">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Job title">
            <input
              className="input"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Accountant"
            />
          </Field>
          <Field label="Start date">
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="End date (if they have left)">
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Education profile">
          <textarea
            className="input min-h-24"
            value={education}
            onChange={(e) => setEducation(e.target.value)}
            placeholder="Schools, qualifications, years"
          />
        </Field>
        <Field label="Work experience">
          <textarea
            className="input min-h-24"
            value={workExperience}
            onChange={(e) => setWorkExperience(e.target.value)}
            placeholder="Previous roles and dates"
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="input min-h-20"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  saveStaffProfile(record.profileId, {
                    phone,
                    jobTitle,
                    startDate,
                    endDate,
                    education,
                    workExperience,
                    notes,
                  }),
                'Saved.',
              )
            }
            className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() => submitStaffProfile(record.profileId), 'Sent to the Managing Director.')
            }
            className="min-h-11 rounded-[--radius-card] bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            Submit for review
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Saving does not submit. Editing an approved record sends it back for review
          automatically, so an approval always covers what the Director actually read.
        </p>
      </section>

      {/* --- certificates ------------------------------------------------- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Certificates &amp; documents</h2>

        {record.certificates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing attached yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border">
            {record.certificates.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {CERTIFICATE_KIND_LABELS[c.kind]}
                    {c.issuer ? ` · ${c.issuer}` : ''}
                    {c.issuedOn ? ` · ${c.issuedOn}` : ''} · {Math.round(c.sizeBytes / 1024)} KB
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <a
                    href={`/api/staff/certificates/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-primary underline"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => deleteStaffCertificate(c.id), 'Removed.')}
                    className="text-xs font-semibold text-overdue underline disabled:opacity-60"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form action={upload} className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select
                className="input bg-white"
                value={kind}
                onChange={(e) => setKind(e.target.value as StaffCertificateKind)}
              >
                {CERTIFICATE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CERTIFICATE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Title">
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Bachelor of Commerce"
              />
            </Field>
            <Field label="Issued by (optional)">
              <input className="input" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </Field>
            <Field label="Issued on (optional)">
              <input
                type="date"
                className="input"
                value={issuedOn}
                onChange={(e) => setIssuedOn(e.target.value)}
              />
            </Field>
          </div>
          <input
            type="file"
            name="file"
            accept={CERTIFICATE_ACCEPT}
            className="input bg-white"
            required
          />
          <button
            type="submit"
            disabled={busy || title.trim().length < 2}
            className="min-h-11 self-start rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
          >
            {busy ? 'Uploading…' : 'Attach certificate'}
          </button>
        </form>
      </section>

      {/* --- the Director's controls -------------------------------------- */}
      {canReview && (
        <section className="flex flex-col gap-3 rounded-[--radius-card] border border-primary/40 bg-primary/5 p-4">
          <h2 className="font-semibold text-primary-dark">Managing Director</h2>

          <Field
            label="Employment status"
            hint={EMPLOYMENT_STATUS_HINTS[record.employmentStatus]}
          >
            <select
              className="input bg-white"
              value={record.employmentStatus}
              disabled={busy}
              onChange={(e) =>
                run(
                  () => setEmploymentStatus(record.profileId, e.target.value as EmploymentStatus),
                  'Employment status updated.',
                )
              }
            >
              {EMPLOYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>

          {returning ? (
            <div className="flex flex-col gap-2">
              <Field label="What needs changing (they will see this)">
                <input
                  className="input"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || reviewNote.trim().length < 3}
                  onClick={() =>
                    run(
                      () => reviewStaffProfile(record.profileId, 'returned', reviewNote),
                      'Returned for correction.',
                    )
                  }
                  className="min-h-11 rounded-[--radius-card] bg-[color:var(--color-warning)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Confirm return
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReturning(false)}
                  className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () => reviewStaffProfile(record.profileId, 'approved', reviewNote),
                    'Profile approved.',
                  )
                }
                className="min-h-11 rounded-[--radius-card] bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                Approve profile
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setReturning(true)}
                className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
              >
                Return for correction
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
