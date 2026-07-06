import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  deep_link: string | null;
  read_at: string | null;
  created_at: string;
};

/** Current user's notifications (RLS scopes to the recipient). */
export async function listNotifications(): Promise<NotificationRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('notifications')
    .select('id, type, title, body, deep_link, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  return (data ?? []) as unknown as NotificationRow[];
}

export async function unreadCount(): Promise<number> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from('notifications').select('id').is('read_at', null).limit(100);
  return (data ?? []).length;
}
