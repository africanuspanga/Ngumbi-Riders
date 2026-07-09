import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

/*
 * Append-only audit trail (spec §25.2, §36). Every owner action that touches
 * money, contracts, identity or permissions must call this. Rows are never
 * updated or deleted; corrections are new events.
 */
export type AuditAction =
  | 'rider.login'
  | 'rider.login_failed'
  | 'rider.pin_changed'
  | 'rider.pin_reset'
  | 'rider.phone_changed'
  | 'owner.login'
  | 'auth.locked_out';

export async function writeAudit(params: {
  actorId: string | null;
  actorRole: 'owner' | 'rider' | 'system' | 'anonymous';
  action: AuditAction | string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from('audit_logs').insert({
    actor_id: params.actorId,
    actor_role: params.actorRole,
    action: params.action,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    metadata: (params.metadata ?? {}) as Json,
    ip: params.ip ?? null,
  });
}
