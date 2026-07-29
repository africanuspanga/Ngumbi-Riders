import { requireAccountant } from '@/lib/auth/session';
import { listMotorcycles } from '@/lib/motorcycles/queries';

export const metadata = { title: 'Motorcycles' };

/** Read-only motorcycle register — the fleet facts the accountant needs. */
export default async function AccountantMotorcyclesPage() {
  await requireAccountant();
  const motorcycles = await listMotorcycles();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Motorcycles</h1>
        <p className="text-sm text-muted-foreground">{motorcycles.length} in the register.</p>
      </header>

      {motorcycles.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
          No motorcycles yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Registration</th>
                <th className="px-3 py-2">Make / model</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {motorcycles.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{m.motorcycle_number}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.registration_number ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {[m.make, m.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {[m.district, m.region].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
