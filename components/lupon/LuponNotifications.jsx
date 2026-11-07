"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Bell, BellOff, CheckCheck, Loader2 } from "lucide-react";
import { useNotifications } from "@/components/resident/NotificationsProvider";
import { formatDateTime } from "@/repositories/luponRepository";
import { LUPON_ROUTES } from "@/lib/constants";

const TYPE_STYLE = {
  assignment: "bg-secondary/10 text-secondary",
  hearing: "bg-gold/20 text-navy",
  minutes: "bg-alt text-muted",
  outcome: "bg-success/10 text-success",
  extension: "bg-warning/15 text-navy",
  general: "bg-alt text-muted",
};

function typeStyle(type) {
  return TYPE_STYLE[type] ?? TYPE_STYLE.general;
}

export default function LuponNotifications() {
  const { items, unreadCount, loading, markRead, markAllRead, refresh } =
    useNotifications();
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onRead = async (item) => {
    if (item.is_read) return;
    setBusyId(item.id);
    try {
      await markRead(item.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const onMarkAll = async () => {
    try {
      await markAllRead();
      toast.success("All notifications marked as read.");
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-navy sm:text-3xl">
            Notifications
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {unreadCount > 0
              ? `${unreadCount} unread.`
              : "You are all caught up."}
          </p>
        </div>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={onMarkAll}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-line px-4 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/40"
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            Mark all read
          </button>
        ) : null}
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-line bg-white py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="text-sm">Loading notifications…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-alt text-muted">
            <BellOff className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-heading text-base font-semibold text-navy">
            Nothing here yet
          </h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
            You will be notified here when you are assigned to a case, when a
            hearing is set, and when the minutes or outcome are updated.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const href = item.related_complaint_id
              ? LUPON_ROUTES.caseDetail(item.related_complaint_id)
              : null;
            return (
              <li
                key={item.id}
                className={`rounded-2xl border bg-white p-5 shadow-sm transition-colors ${
                  item.is_read ? "border-line" : "border-secondary/40"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        item.is_read ? "bg-alt text-muted" : "bg-secondary/10 text-secondary"
                      }`}
                    >
                      <Bell className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[14px] font-semibold text-navy">
                          {item.title}
                        </h2>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${typeStyle(item.type)}`}
                        >
                          {item.type}
                        </span>
                        {!item.is_read ? (
                          <span className="sr-only">Unread</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">
                        {item.message}
                      </p>
                      <p className="mt-1.5 text-[11px] text-muted/80">
                        {formatDateTime(item.created_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {!item.is_read ? (
                      <button
                        type="button"
                        onClick={() => onRead(item)}
                        disabled={busyId === item.id}
                        className="min-h-[34px] rounded-lg border border-line px-3 text-[12px] font-semibold text-navy transition-colors hover:border-secondary/40 disabled:opacity-50"
                      >
                        Mark read
                      </button>
                    ) : null}
                    {href ? (
                      <Link
                        href={href}
                        className="inline-flex min-h-[34px] items-center rounded-lg bg-secondary px-3 text-[12px] font-semibold text-white transition-colors hover:bg-navy"
                      >
                        View case
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
