import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getRiderForEdit } from '@/lib/riders/queries';
import { EditRiderForm } from './EditRiderForm';

export const metadata = { title: 'Edit rider' };

/**
 * Edit a rider's information (client request 2026-09-05). Owner only — an
 * accountant may read the rider register but never change it
 * (`riders.write` is not in their permission set).
 */
export default async function EditRiderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const rider = await getRiderForEdit(id);
  if (!rider) notFound();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <Link href={`/owner/riders/${id}`} className="text-sm font-medium text-muted-foreground">
          ← Back to the rider
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Edit {rider.firstName} {rider.lastName}
        </h1>
        <p className="text-muted-foreground text-sm">
          {rider.riderNumber} · correcting a registration mistake here updates the
          rider record everywhere it is shown.
        </p>
      </div>

      <EditRiderForm
        riderId={rider.id}
        riderNumber={rider.riderNumber}
        defaults={{
          firstName: rider.firstName,
          middleName: rider.middleName,
          lastName: rider.lastName,
          phone: rider.phone,
          email: rider.email,
          dateOfBirth: rider.dateOfBirth,
          gender: rider.gender,
          region: rider.region,
          district: rider.district,
          locationSource: 'manual',
          ward: rider.ward,
          street: rider.street,
          fullAddress: rider.fullAddress,
          nidaNumber: '',
          drivingLicenceNumber: '',
        }}
      />
    </div>
  );
}
