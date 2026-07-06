import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getApplication } from '@/lib/applications/queries';
import { StatusBadge } from '@/components/applications/StatusBadge';
import {
  StatusActions,
  RevealSecrets,
  DocumentLink,
  ConvertButton,
} from './actions-ui';

export const metadata = { title: 'Application review' };

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const app = await getApplication(id);
  if (!app) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/owner/applications" className="text-sm font-medium text-muted">
          ← Applications
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-primary-dark">
            {app.first_name} {app.middle_name ? `${app.middle_name} ` : ''}
            {app.last_name}
          </h1>
          <p className="text-sm text-muted">
            {app.reference} · {app.primary_phone}
          </p>
        </div>
        <StatusBadge status={app.status} />
      </header>

      {app.duplicate_flags.length > 0 && (
        <div className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-3 text-sm text-[color:var(--color-warning)]">
          ⚠ Possible duplicate: {app.duplicate_flags.join(', ')}
        </div>
      )}

      {app.converted_rider_id && (
        <div className="rounded-[--radius-card] border border-primary bg-surface p-3 text-sm text-primary-dark">
          Converted to rider.{' '}
          <Link href={`/owner/riders/${app.converted_rider_id}`} className="font-semibold underline">
            View rider
          </Link>
        </div>
      )}

      <Section title="Applicant">
        <Grid>
          <Info label="Date of birth" value={app.date_of_birth} />
          <Info label="Gender" value={app.gender} />
          <Info label="Email" value={app.email} />
          <Info label="Alt. phone" value={app.alternative_phone} />
          <Info label="Region" value={app.region} />
          <Info label="District" value={app.district} />
          <Info label="Ward" value={app.ward} />
          <Info label="Street" value={app.street} />
        </Grid>
        <Info label="Full address" value={app.full_address} />
        {app.previous_experience && (
          <Info label="Experience" value={app.previous_experience} />
        )}
      </Section>

      <Section title="Sensitive identifiers">
        <RevealSecrets id={app.id} />
      </Section>

      <Section title="Emergency contact">
        <Grid>
          <Info label="Name" value={app.emergency_contact_name} />
          <Info label="Phone" value={app.emergency_contact_phone} />
          <Info label="Relationship" value={app.emergency_contact_relationship} />
        </Grid>
      </Section>

      <Section title="Applicant documents">
        {app.documents.length === 0 ? (
          <p className="text-sm text-muted">No documents uploaded.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {app.documents.map((d) => (
              <DocumentLink
                key={d.id}
                bucket="application-documents"
                path={d.storage_path}
                label={d.doc_type}
              />
            ))}
          </div>
        )}
      </Section>

      {app.guarantors.map((g, i) => (
        <Section key={g.id} title={`Guarantor ${i + 1}: ${g.full_name}`}>
          <Grid>
            <Info label="Phone" value={g.phone} />
            <Info label="Relationship" value={g.relationship} />
            <Info label="Occupation" value={g.occupation} />
            <Info label="Employer" value={g.employer} />
          </Grid>
          <Info label="Address" value={g.residential_address} />
          {g.documents.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {g.documents.map((d) => (
                <DocumentLink
                  key={d.id}
                  bucket="guarantor-documents"
                  path={d.storage_path}
                  label={d.doc_type}
                />
              ))}
            </div>
          )}
        </Section>
      ))}

      <Section title="Decision">
        <StatusActions id={app.id} current={app.status} />
        {app.status === 'approved' && (
          <div className="mt-3">
            <ConvertButton id={app.id} />
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
      <h2 className="font-semibold text-primary-dark">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</div>;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}
