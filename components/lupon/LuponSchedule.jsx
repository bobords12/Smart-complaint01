"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Clock,
  Loader2,
  MapPin,
  Video,
} from "lucide-react";
import {
  formatDate,
  formatTime,
  getMyHearings,
  getMyPastHearings,
} from "@/repositories/luponRepository";
import { LUPON_ROUTES } from "@/lib/constants";

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
];

function HearingCard({ hearing }) {
  const ref = hearing.complaints?.reference_number;
  const title = hearing.complaints?.title;
  return (
    <li className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={LUPON_ROUTES.caseDetail(hearing.complaint_id)}
            className="text-[12px] font-semibold text-secondary hover:underline"
          >
            {ref ?? "Case"}
          </Link>
          <h3 className="mt-0.5 line-clamp-2 font-heading text-[15px] font-semibold text-navy">
            {title ?? "Untitled case"}
          </h3>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            hearing.status === "Completed"
              ? "bg-alt text-muted"
              : "bg-secondary/10 text-secondary"
          }`}
        >
          {hearing.status ?? "Scheduled"}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 text-[13px] text-navy">
          <CalendarClock className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
          <dt className="sr-only">Date</dt>
          <dd className="font-medium">{formatDate(hearing.hearing_date)}</dd>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-navy">
          <Clock className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
          <dt className="sr-only">Time</dt>
          <dd className="font-medium">{formatTime(hearing.hearing_time)}</dd>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted sm:col-span-2">
          {hearing.is_online ? (
            <>
              <Video className="h-4 w-4 shrink-0" aria-hidden="true" />
              <dt className="sr-only">Venue</dt>
              <dd>Online hearing</dd>
            </>
          ) : (
            <>
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              <dt className="sr-only">Venue</dt>
              <dd>{hearing.venue ?? "Barangay Hall"}</dd>
            </>
          )}
        </div>
      </dl>
    </li>
  );
}

export default function LuponSchedule() {
  const [tab, setTab] = useState("upcoming");
  const [upcoming, setUpcoming] = useState([]);
  const [past, setPast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [next, previous] = await Promise.all([
        getMyHearings(),
        getMyPastHearings(),
      ]);
      setUpcoming(next);
      setPast(previous);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const items = tab === "upcoming" ? upcoming : past;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-navy sm:text-3xl">
          Schedule
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          The hearings set for the cases you are assigned to.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Hearing period"
        className="inline-flex gap-1.5 rounded-xl bg-alt p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-[36px] rounded-lg px-4 text-[13px] font-semibold transition-colors ${
              tab === t.key
                ? "bg-white text-navy shadow-sm"
                : "text-muted hover:text-navy"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[11px] text-muted">
              {t.key === "upcoming" ? upcoming.length : past.length}
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-critical/30 bg-critical-soft p-4 text-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-line bg-white py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="text-sm">Loading the schedule…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-alt text-muted">
            <CalendarClock className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-heading text-base font-semibold text-navy">
            {tab === "upcoming" ? "No upcoming hearings" : "No past hearings"}
          </h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
            {tab === "upcoming"
              ? "Hearings for your assigned cases will appear here once they are set."
              : "Hearings that have already taken place will be listed here."}
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((h) => (
            <HearingCard key={h.id} hearing={h} />
          ))}
        </ul>
      )}
    </div>
  );
}
