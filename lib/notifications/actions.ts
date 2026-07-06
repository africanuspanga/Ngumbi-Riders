'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';

export type ActionResult = { ok: boolean };

/* Riders/owner may mark their OWN notifications read (RLS enforces ownership). */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  revalidatePath('/rider/notifications');
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  revalidatePath('/rider/notifications');
  return { ok: true };
}
