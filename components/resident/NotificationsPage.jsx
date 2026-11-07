"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  Search,
  CalendarDays,
  Megaphone,
  FilterX,
  ExternalLink,
} from "lucide-react";
import { useNotifications } from "./NotificationsProvider";
import useOpenNotification from "./useOpenNotification";
import EmptyState from "@/components/shared/EmptyState";
import StatusBadge from "@/components/shared/StatusBadge";
import { RESIDENT_ROUTES } from "@/lib/constants";

const TABS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "complaint", label: "Complaint Updates" },
  { key: "hearing", label: "Hearings" },
  { key: "general", label: "General Notices" },
];

function getNotificationIcon(item) {
  if (item.related_hearing_id || item.type === "hearing") return CalendarDays;
  if (item.type === "general") return Megaphone;
  if (item.unread) return BellRing;
  return Bell;
}

function getTypeLabel(item) {
  if (item.related_hearing_id || item.type === "hearing") return "Hearing";
  if (item.type === "general") return "General";
  return "Complaint";
}

/**
 * A hearing notification is one that belongs to a hearing, whichever way
 * the row was written. The `hearing` type exists in the schema, but the
 * workflow also writes hearing events as `complaint` rows carrying a
 * `related_hearing_id`, and the resident should find both under one tab.
 */
function isHearingNotification(item) {
  return item.type === "hearing" || Boolean(item.related_hearing_id);
}

export default function NotificationsPage() {
  const router = useRouter();
  const { items, markRead, markAllRead, loading } = useNotifications();
  const openNotification = useOpenNotification();

  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const unreadCount = useMemo(
    () => items.filter((n) => n.unread).length,
    [items]
  );

  const filteredItems = useMemo(() => {
    let result = [...items];

    if (activeTab === "unread") {
      result = result.filter((n) => n.unread);
    } else if (activeTab === "hearing") {
      result = result.filter(isHearingNotification);
    } else if (activeTab !== "all") {
      result = result.filter((n) => n.type === activeTab);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          (n.message || "").toLowerCase().includes(q) ||
          (n.title || "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [items, activeTab, searchQuery]);

  const toggleRead = useCallback(
    (e, item) => {
      e.stopPropagation();
      if (item.unread) {
        markRead(item.id);
        toast.success("Notification marked as read.");
      }
    },
    [markRead]
  );

  const handleMarkAllRead = useCallback(() => {
    markAllRead();
    toast.success("All notifications marked as read.");
  }, [markAllRead]);

  const hasItems = items.length > 0;
  const hasResults = filteredItems.length > 0;
  const showEmptySearch = hasItems && !hasResults;
  const showEmptyUnread = activeTab === "unread" && !hasResults && unreadCount === 0;
  const showEmptyFilter = hasItems && !hasResults && activeTab !== "unread";

  return (
    <section
      aria-labelledby="notifications-title"
      className="mx-auto max-w-[1100px]"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            id="notifications-title"
            className="font-heading text-2xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-3xl"
          >
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted">
            Complaint and hearing updates.
          </p>
        </div>
      </header>

      {loading && !hasItems ? (
        <div
          aria-busy="true"
          aria-label="Loading notifications"
          className="mt-6 space-y-3"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-start gap-4 rounded-2xl border border-line bg-white dark:bg-alt px-5 py-4"
            >
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-alt" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-3/4 rounded bg-alt" />
                <div className="h-3 w-1/3 rounded bg-alt/70" />
              </div>
            </div>
          ))}
        </div>
      ) : !hasItems ? (
        <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt">
          <EmptyState
            title="No notifications yet"
            message="Updates will appear here once available."
            icon={BellOff}
          >
            <button
              type="button"
              onClick={() => router.push(RESIDENT_ROUTES.dashboard)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-navy px-5 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
            >
              Back to Dashboard
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-white dark:bg-alt p-1">
                {TABS.map((tab) => {
                  const count =
                    tab.key === "all"
                      ? items.length
                      : tab.key === "unread"
                      ? unreadCount
                      : tab.key === "hearing"
                      ? items.filter(isHearingNotification).length
                      : items.filter((n) => n.type === tab.key).length;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${
                        activeTab === tab.key
                          ? "bg-navy text-white shadow-sm"
                          : "text-muted hover:bg-alt hover:text-navy dark:hover:text-secondary"
                      }`}
                    >
                      {tab.label}
                      <span
                        className={`ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10.5px] ${
                          activeTab === tab.key
                            ? "bg-white/20 text-white"
                            : "bg-alt text-muted"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  placeholder="Search notifications…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-52 rounded-xl border border-line bg-white dark:bg-alt py-2 pl-9 pr-3 text-[13px] text-navy dark:text-secondary placeholder-muted transition-colors focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary/30 sm:w-64"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-alt hover:text-navy dark:hover:text-secondary"
                    aria-label="Clear search"
                  >
                    <FilterX className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <p
                className="text-[13px] font-medium text-muted"
                aria-live="polite"
              >
                {unreadCount > 0
                  ? `${unreadCount} unread ${unreadCount === 1 ? "notification" : "notifications"}`
                  : "All read"}
              </p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line px-4 text-[13px] font-semibold text-secondary transition-colors hover:border-secondary hover:bg-info-soft"
                >
                  <CheckCheck className="h-4 w-4" aria-hidden="true" />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {showEmptySearch ? (
            <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt">
              <EmptyState
                title="No results"
                message="Try a different keyword."
                icon={Search}
              >
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line px-5 text-[13px] font-semibold text-navy dark:text-secondary transition-colors hover:bg-alt"
                >
                  <FilterX className="h-4 w-4" aria-hidden="true" />
                  Clear Search
                </button>
              </EmptyState>
            </div>
          ) : showEmptyUnread ? (
            <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt">
              <EmptyState
                title="All caught up"
                message="No unread notifications."
                icon={CheckCheck}
              />
            </div>
          ) : showEmptyFilter ? (
            <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt">
              <EmptyState
                title="No notifications here"
                message="None match this filter."
                icon={FilterX}
              />
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line/70 rounded-2xl border border-line bg-white dark:bg-alt shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
              {filteredItems.map((item) => {
                const Icon = getNotificationIcon(item);
                const typeLabel = getTypeLabel(item);
                const canOpen = Boolean(item.href);
                return (
                  <li key={item.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => openNotification(item)}
                      aria-label={`${item.message}${canOpen ? `. Opens ${item.targetLabel.toLowerCase()}` : ""}`}
                      className={`flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-canvas/70 ${
                        item.unread ? "bg-info-soft/30" : ""
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                          item.unread
                            ? "bg-info-soft text-secondary"
                            : "bg-alt text-muted"
                        }`}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-3">
                          <span
                            className={`text-sm leading-snug ${
                              item.unread
                                ? "font-semibold text-mirage"
                                : "text-muted"
                            }`}
                          >
                            {item.message}
                          </span>
                          {item.unread && (
                            <span
                              aria-label="Unread"
                              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-action"
                            />
                          )}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2">
                          <StatusBadge label={typeLabel} />
                          {canOpen ? (
                            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-secondary">
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              {item.targetLabel}
                            </span>
                          ) : (
                            <span className="text-[12px] text-muted">
                              General notice
                            </span>
                          )}
                          <span className="text-[12px] text-muted">
                            {item.time}
                          </span>
                        </span>
                      </span>
                    </button>
                    {item.unread && (
                      <button
                        type="button"
                        onClick={(e) => toggleRead(e, item)}
                        className="absolute right-4 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 rounded-lg border border-line bg-white dark:bg-alt px-3 py-1.5 text-[11.5px] font-semibold text-muted shadow-sm transition-colors hover:border-secondary hover:text-secondary group-hover:inline-flex"
                        aria-label="Mark as read"
                      >
                        <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
                        Mark read
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
