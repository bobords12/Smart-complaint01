"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { BellOff, CheckCheck, FileText } from "lucide-react";
import {
  fetchMyNotifications,
  markAllPnpNotificationsRead,
  markPnpNotificationRead,
} from "@/repositories/pnpReferralRepository";
import { formatDateTime } from "@/lib/pnpReferral";
import { PNP_ROUTES } from "@/lib/constants";
import { EmptyState, LoadingBlock, PnpPageHeader } from "./PnpPrimitives";

/**
 * The officer's notifications.
 *
 * A notification is a pointer, not a grant. One may point at a
 * referral the officer is no longer assigned to — the assignment can
 * be released after the notification was written. Following the link
 * then lands on the referral's "not available" page, which is the
 * correct outcome: the existence of a referral is not disclosed to
 * someone who cannot work on it.
 */
export default function PnpNotifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const data = await fetchMyNotifications();
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onRead = async (item) => {
    if (item.read_at) return;
    setBusyId(item.id);
    const ok = await markPnpNotificationRead(item.id);
    if (ok) {
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row))
      );
    }
    setBusyId(null);
  };

  const onMarkAll = async () => {
    setLoading(true);
    const ok = await markAllPnpNotificationsRead();
    if (ok) {
      toast.success("All notifications marked as read.");
      load();
    } else {
      setLoading(false);
      toast.error("Could not mark the notifications as read.");
    }
  };

  const unread = items.filter((item) => !item.read_at).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PnpPageHeader
        title="Notifications"
        subtitle="Assignments, information requests, replies and status changes on referrals assigned to you."
        actions={
          unread > 0 ? (
            <button
              type="button"
              onClick={onMarkAll}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/50"
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Mark all read
            </button>
          ) : null
        }
      />

      {loading ? (
        <LoadingBlock label="Loading notifications…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications"
          message="You will be notified when a referral is assigned to you, when the barangay replies to your information request, and when a referral you hold changes status."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const isUnread = !item.read_at;
            const body = (
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    isUnread ? "bg-secondary" : "bg-line"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold text-navy">{item.title}</p>
                    {isUnread ? (
                      <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
                        New
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{item.message}</p>
                  <p className="mt-1.5 text-[11px] text-muted">
                    {formatDateTime(item.created_at)}
                  </p>
                </div>
              </div>
            );

            return (
              <li
                key={item.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${
                  isUnread ? "border-secondary/40" : "border-line"
                }`}
              >
                {item.related_referral_id ? (
                  <Link
                    href={PNP_ROUTES.referralDetail(item.related_referral_id)}
                    onClick={() => onRead(item)}
                    className="block rounded-lg focus-visible:outline-2 focus-visible:outline-secondary"
                  >
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRead(item)}
                    disabled={busyId === item.id}
                    className="block w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-secondary disabled:opacity-60"
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        A notification never grants access. If a referral has been reassigned away from you, the
        link will say so rather than open the case.
      </p>
    </div>
  );
}
