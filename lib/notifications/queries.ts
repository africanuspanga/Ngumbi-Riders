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

/**
 * How many of the current user's notifications are unread.
 *
 * Counted by the database, not by measuring a fetched page: the previous
 * version selected `.limit(100)` rows and returned the array length, so any
 * user past a hundred unread was permanently shown "100". The owner's backlog
 * was 884 when this surfaced, because nothing had ever displayed it.
 */
export async function unreadCount(): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) return 0;
  return count ?? 0;
}

/**
 * The most recent UNREAD notifications, for the dashboard banner.
 *
 * Separate from `listNotifications` because the dashboard wants a short,
 * always-unread list while the inbox wants the full history including what has
 * already been read.
 */
export async function listUnreadNotifications(limit = 5): Promise<NotificationRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, deep_link, read_at, created_at')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as NotificationRow[];
}
