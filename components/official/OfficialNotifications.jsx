"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import EmptyState from "@/components/shared/EmptyState";
import Link from "next/link";
import {
  Bell,
  BellRing,
  CheckCheck,
  FileText,
  CalendarDays,
  Info,
  Filter,
  ChevronDown,
} from "lucide-react";
import toast from "react-hot-toast";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";

const TYPE_CONFIG = {
  complaint: { icon: FileText, color: "bg-info-soft text-secondary" },
  hearing: { icon: CalendarDays, color: "bg-gold/10 text-gold" },
  general: { icon: Info, color: "bg-alt text-muted" },
};

function formatTimeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CaptainNotificationsPage() {
  const { user } = useAuth();
  const routes = useOfficialRoutes();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("Not authenticated.");
      return;
    }

    const { data, error: fetchErr } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications(data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      await fetchNotifications();
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [fetchNotifications]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("captain-notifications-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        fetchNotifications();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchNotifications]);

  const filtered = notifications.filter((n) => {
    return !typeFilter || n.type === typeFilter;
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const handleMarkRead = async (notif) => {
    if (notif.read_at) return;

    const supabase = createClient();
    const { error } = await supabase.rpc("mark_notification_read", {
      p_notification_id: notif.id,
    });

    if (error) {
      toast.error("Failed to mark as read.");
    } else {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notif.id ? { ...n, read_at: new Date().toISOString() } : n
        )
      );
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("mark_all_notifications_read");

    if (error) {
      toast.error("Failed to mark all as read.");
    } else {
      setNotifications((prev) =>
        prev.map((n) =>
          n.read_at ? n : { ...n, read_at: new Date().toISOString() }
        )
      );
      toast.success("All notifications marked as read.");
    }
    setMarkingAll(false);
  };

  const getRelatedLink = (notif) => {
    if (notif.related_complaint_id) {
      return `${routes.complaints}/${notif.related_complaint_id}`;
    }
    if (notif.related_hearing_id) {
      return routes.hearings;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-secondary" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
            Notifications
          </h1>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
            >
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 animate-pulse rounded-full bg-alt" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 animate-pulse rounded bg-alt" />
                  <div className="h-3 w-72 animate-pulse rounded bg-alt" />
                </div>
                <div className="h-3 w-12 animate-pulse rounded bg-alt" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Bell className="h-6 w-6 shrink-0 text-secondary" />
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-navy sm:text-2xl">
              Notifications
            </h1>
            <p className="text-[13px] text-muted">
              {unreadCount > 0
                ? `You have ${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
                : "You're all caught up"}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-full bg-jordy px-5 py-2.5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary disabled:opacity-60"
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            {markingAll ? "Marking..." : "Mark All Read"}
          </button>
        )}
      </div>

      {/* Filter */}
      <section className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-muted" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-navy">Filter:</span>
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-10 appearance-none rounded-full border border-line bg-canvas pl-4 pr-8 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              <option value="">All Types</option>
              <option value="complaint">Complaint</option>
              <option value="hearing">Hearing</option>
              <option value="general">General</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          </div>
          {unreadCount > 0 && (
            <span className="ml-auto inline-flex items-center rounded-full bg-critical-soft px-2.5 py-1 text-[11px] font-semibold text-critical">
              {unreadCount} unread
            </span>
          )}
        </div>
      </section>

      {/* Notification List */}
      <section
        aria-labelledby="notifications-list"
        className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
      >
        <h2
          id="notifications-list"
          className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy"
        >
          <BellRing className="h-5 w-5 text-gold" aria-hidden="true" />
          All Notifications
        </h2>

        {filtered.length === 0 ? (
          <EmptyState
            title={typeFilter ? "No matching notifications" : "No notifications"}
            message={
              typeFilter
                ? "Try changing your filter to see more notifications."
                : "When you receive notifications, they will appear here."
            }
            icon={Bell}
          />
        ) : (
          <div className="mt-4 divide-y divide-line">
            {filtered.map((notif) => {
              const isUnread = !notif.read_at;
              const config = TYPE_CONFIG[notif.type] || TYPE_CONFIG.general;
              const Icon = config.icon;
              const link = getRelatedLink(notif);

              const content = (
                <div
                  key={notif.id}
                  className={`flex items-start gap-4 px-4 py-4 transition-colors hover:bg-alt/40 ${
                    isUnread ? "bg-info-soft/30" : ""
                  }`}
                  onClick={() => handleMarkRead(notif)}
                  role={isUnread ? "button" : undefined}
                  tabIndex={isUnread ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (isUnread && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      handleMarkRead(notif);
                    }
                  }}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.color}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[13px] ${isUnread ? "font-bold text-navy" : "font-semibold text-navy"}`}>
                        {notif.title}
                      </p>
                      <span className="shrink-0 text-[11px] text-muted">
                        {formatTimeAgo(notif.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                      {notif.message}
                    </p>
                    {isUnread && (
                      <span className="mt-1.5 inline-block h-2 w-2 rounded-full bg-secondary" />
                    )}
                  </div>
                </div>
              );

              if (link) {
                return (
                  <Link key={notif.id} href={link} className="block">
                    {content}
                  </Link>
                );
              }
              return <div key={notif.id}>{content}</div>;
            })}
          </div>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-critical/30 bg-white px-4 py-3 shadow-lg"
        >
          <p className="text-sm font-semibold text-critical">{error}</p>
        </div>
      )}
    </div>
  );
}
