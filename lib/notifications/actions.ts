'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';

export type ActionResult = { ok: boolean };

/* Riders/owner may mark their OWN notifications read (RLS enforces ownership). */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false };
  revalidatePath('/rider/notifications');
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) return { ok: false };
  revalidatePath('/rider/notifications');
  return { ok: true };
}
