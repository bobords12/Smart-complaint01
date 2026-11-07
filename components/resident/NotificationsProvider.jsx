"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
  getCurrentUserId,
} from "@/repositories/notificationRepository";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";

const NotificationsContext = createContext(null);

/**
 * The resident's notifications, shared by the top bar, the sidebar badge,
 * the dashboard preview and the notifications page.
 *
 * There is one fetch and one realtime subscription for the whole portal.
 * Realtime is filtered to the signed-in resident, so a notification written
 * by the Captain for this resident appears — including hearing scheduling
 * and Notice of Hearing events — without the resident reloading anything.
 */
export function NotificationsProvider({ children }) {
  const { user, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const userId = user?.id ?? null;

  const loadNotifications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getNotifications();
      setItems(data);
      const count = await getUnreadCount();
      setUnreadCount(count);
    } catch {
      setItems([]);
      setUnreadCount(0);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  /* Stable ref so the realtime callback never closes over a stale loader. */
  const loadRef = useRef(loadNotifications);
  useEffect(() => {
    loadRef.current = loadNotifications;
  });

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      queueMicrotask(() => {
        setItems([]);
        setUnreadCount(0);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    (async () => {
      await loadRef.current(false);
      if (cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  /* ── Realtime ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (authLoading || !userId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`resident-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => loadRef.current(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authLoading, userId]);

  /**
   * Mark exactly one notification read. The optimistic update mirrors what
   * the RPC wrote (`read_at`), so a later refetch cannot resurrect the
   * unread dot the resident just watched disappear.
   */
  const markRead = useCallback(async (id) => {
    const success = await markNotificationRead(id);
    if (success) {
      const readAt = new Date().toISOString();
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, unread: false, is_read: true, read_at: readAt }
            : item
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    return success;
  }, []);

  const markAllRead = useCallback(async () => {
    const success = await markAllNotificationsRead();
    if (success) {
      const readAt = new Date().toISOString();
      setItems((current) =>
        current.map((item) =>
          item.unread ? { ...item, unread: false, is_read: true, read_at: readAt } : item
        )
      );
      setUnreadCount(0);
    }
    return success;
  }, []);

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      loading,
      markRead,
      markAllRead,
      refresh: loadNotifications,
    }),
    [items, unreadCount, loading, markRead, markAllRead, loadNotifications]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}

export { getCurrentUserId };
