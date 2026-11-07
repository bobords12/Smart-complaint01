import { createClient } from "@/lib/supabase/client";
import { formatTimeAgo } from "@/lib/residentDates";
import { resolveNotificationTarget, describeNotificationTarget } from "@/lib/residentRoutes";

const supabase = createClient();

export interface NotificationRow {
  id: string;
  user_id: string;
  type: "complaint" | "hearing" | "general";
  title: string;
  message: string;
  related_complaint_id: string | null;
  related_hearing_id: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Shape a notification row for the Resident Portal.
 *
 * `href` is resolved once, here, through the single route builder, from the
 * row's own `related_complaint_id` / `related_hearing_id`. It is null for a
 * notification that genuinely has nothing to open, and the UI renders such
 * a row as a plain notice rather than navigating somewhere that would not
 * match its text. No URL is ever taken from the notification body.
 */
function mapNotification(row: NotificationRow) {
  const target = resolveNotificationTarget(row);

  return {
    id: row.id,
    title: row.title,
    message: row.message,
    type: row.type as "complaint" | "hearing" | "general",
    related_complaint_id: row.related_complaint_id,
    related_hearing_id: row.related_hearing_id,
    created_at: row.created_at,
    read_at: row.read_at,
    is_read: Boolean(row.read_at),
    unread: !row.read_at,
    /** Where this notification opens, or null when it opens nothing. */
    href: target?.href ?? null,
    targetKind: target?.kind ?? null,
    targetLabel: describeNotificationTarget(row),
    time: formatTimeAgo(row.created_at),
  };
}

export async function getNotifications() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return [];
  return (data || []).map(mapNotification);
}

/**
 * The signed-in user's id, or null. The Resident Portal subscribes to its
 * own notification rows only; a subscription without this filter would be
 * scoped by RLS anyway, but filtering here keeps the channel honest and
 * lets the provider tear down cleanly.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });
  return !error;
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.rpc("mark_all_notifications_read");
  return !error;
}

export async function getUnreadCount(): Promise<number> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return 0;

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userData.user.id)
    .is("read_at", null);

  if (error) return 0;
  return count || 0;
}
