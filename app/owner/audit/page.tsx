import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { getAuditLog } from '@/lib/system/queries';

export const metadata = { title: 'Audit log' };

export default async function AuditPage() {
  await requireOwner();
  const rows = await getAuditLog();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/owner/system" className="text-sm font-medium text-muted-foreground">← System</Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">Audit log</h1>
        <p className="text-sm text-muted-foreground">Every money-, contract-, identity- and permission-affecting action.</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">No audit entries yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-muted-foreground">
              <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Entity</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">{r.created_at.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-3 py-2 capitalize">{r.actor_role}</td>
                  <td className="px-3 py-2 font-medium">{r.action}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.entity_type ?? ''}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
