"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Bell, BellOff, BellRing, CalendarDays, Megaphone } from "lucide-react";
import Link from "next/link";
import { RESIDENT_ROUTES } from "@/lib/constants";
import { useNotifications } from "./NotificationsProvider";
import useOpenNotification from "./useOpenNotification";

function iconFor(item) {
  if (item.related_hearing_id || item.type === "hearing") return CalendarDays;
  if (item.type === "general") return Megaphone;
  return item.unread ? BellRing : Bell;
}

/**
 * The three most recent notifications on the dashboard.
 *
 * Clicking one goes straight to the complaint or hearing it is about — the
 * same destination the notifications page would open — rather than to the
 * notifications list. Read state is written only for the row that was
 * clicked, and the badge in the sidebar moves at the same moment.
 */
export default function NotificationsPreview() {
  const router = useRouter();
  const { items, unreadCount, loading } = useNotifications();
  const openNotification = useOpenNotification();
  const preview = items.slice(0, 3);

  return (
    <section
      aria-labelledby="notifications-title"
      className="rounded-2xl border border-line bg-white dark:bg-alt shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <h2
          id="notifications-title"
          className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy dark:text-secondary"
        >
          <Bell className="h-5 w-5 text-gold" aria-hidden="true" />
          Notifications
          {unreadCount > 0 ? (
            <span
              aria-label={`${unreadCount} unread notifications`}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[11px] font-bold text-navy"
            >
              {unreadCount}
            </span>
          ) : null}
        </h2>
        <Link
          href={RESIDENT_ROUTES.notifications}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-secondary transition-colors hover:text-navy dark:hover:text-secondary"
        >
          View All
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </header>

      {loading && preview.length === 0 ? (
        <div aria-busy="true" aria-label="Loading notifications" className="divide-y divide-line/70">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-alt" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-3/4 rounded bg-alt" />
                <div className="h-3 w-1/3 rounded bg-alt/70" />
              </div>
            </div>
          ))}
        </div>
      ) : preview.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center sm:px-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-alt text-muted">
            <BellOff className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold text-mirage">No notifications yet</p>
          <p className="text-[13px] text-muted">
            Case and hearing updates will appear here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line/70">
          {preview.map((item) => {
            const Icon = iconFor(item);
            const canOpen = Boolean(item.href);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openNotification(item)}
                  aria-label={`${item.message}${canOpen ? `. Opens ${item.targetLabel.toLowerCase()}` : ""}`}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-canvas/70 sm:px-5"
                >
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      item.unread ? "bg-info-soft text-secondary" : "bg-alt text-muted"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span
                        className={`text-sm leading-snug ${
                          item.unread ? "font-semibold text-mirage" : "text-muted"
                        }`}
                      >
                        {item.message}
                      </span>
                      {item.unread ? (
                        <span
                          aria-label="Unread"
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-action"
                        />
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[12px] text-muted">
                      {item.time}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
