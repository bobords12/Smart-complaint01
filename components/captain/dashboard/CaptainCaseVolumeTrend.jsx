"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { aggregateCaseTrend, trendSince } from "./caseTrendData.mjs";

const SERIES = [
  { key: "Total", label: "Total Complaints", color: "#132c50", weight: 3.5 },
  { key: "Normal", label: "Normal", color: "#1b4c8c", weight: 2 },
  { key: "High", label: "High", color: "#d97706", weight: 2 },
  { key: "Critical", label: "Critical", color: "#b5493b", weight: 2 },
  { key: "Unassessed", label: "Unassessed", color: "#66788f", weight: 2 },
];
const PAGE_SIZE = 1000;

async function fetchChartRows(supabase, filter, now) {
  const since = trendSince(filter, now);
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase.from("complaints")
      .select("id,submitted_at,confirmed_urgency,predicted_urgency")
      .order("submitted_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (since) query = query.gte("submitted_at", since);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

export default function CaptainCaseVolumeTrend({ filter, userId }) {
  const [supabase] = useState(() => createClient());
  const filterRef = useRef(filter);
  const revision = useRef(0);
  const debounce = useRef(null);
  const [points, setPoints] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connection, setConnection] = useState("Connecting");
  const [active, setActive] = useState(null);
  const [visible, setVisible] = useState(() => SERIES.map((line) => line.key));

  const refresh = useCallback(async (initial = false) => {
    if (!userId) return;
    const currentFilter = filterRef.current;
    const ticket = ++revision.current;
    if (initial) { setLoading(true); setPoints(null); }
    try {
      const now = new Date();
      const rows = await fetchChartRows(supabase, currentFilter, now);
      if (ticket !== revision.current || currentFilter !== filterRef.current) return;
      setPoints(aggregateCaseTrend(rows, currentFilter, now));
      setError(null);
    } catch (err) {
      if (ticket === revision.current) setError(err.message || "Could not load chart data.");
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }, [userId, supabase]);
  const refreshRef = useRef(refresh);

  useEffect(() => {
    let cancelled = false;
    filterRef.current = filter;
    refreshRef.current = refresh;
    queueMicrotask(() => { if (!cancelled) refresh(true); });
    return () => { cancelled = true; revision.current += 1; };
  }, [filter, refresh]);

  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let reconnecting = false;
    let channel;
    let retry;
    function scheduleRefresh() {
      clearTimeout(debounce.current);
      debounce.current = setTimeout(() => refreshRef.current(), 250);
    }
    function subscribe() {
      if (stopped) return;
      channel = supabase.channel(`captain-case-trend-${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => {
          if (stopped) return;
          setConnection("Live");
          scheduleRefresh();
        })
        .subscribe((status) => {
          if (stopped) return;
          if (status === "SUBSCRIBED") {
            reconnecting = false;
            clearTimeout(retry);
            setConnection("Connected");
            scheduleRefresh();
          }
          else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
            if (reconnecting) return;
            reconnecting = true;
            setConnection("Reconnecting");
            retry = setTimeout(async () => {
              if (stopped) return;
              await supabase.removeChannel(channel);
              if (stopped) return;
              reconnecting = false;
              subscribe();
            }, 3000);
          }
        });
    }
    function recheck() { scheduleRefresh(); }
    function offline() { setConnection("Offline"); }
    subscribe();
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    window.addEventListener("offline", offline);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(debounce.current);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      window.removeEventListener("offline", offline);
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, supabase]);

  const width = 700;
  const height = 280;
  const pad = { top: 20, right: 20, bottom: 40, left: 45 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const data = points || [];
  const visibleSeries = SERIES.filter((line) => visible.includes(line.key));
  const max = Math.max(1, ...data.flatMap((p) => visibleSeries.map((s) => p[s.key])));
  const step = Math.max(1, Math.ceil(max / 4));
  const yMax = Math.ceil(max / step) * step;
  const x = (i) => pad.left + (data.length > 1 ? i * chartW / (data.length - 1) : chartW / 2);
  const y = (value) => pad.top + chartH - value / yMax * chartH;
  const hovered = active == null ? null : data[active];
  const hasComplaints = data.some((point) => point.Total > 0);

  return (
    <div className="min-w-0" aria-busy={loading}>
      <p className="mb-2 text-right text-[11px] font-semibold text-muted" role="status">
        {(connection === "Live" || connection === "Connected") && typeof navigator !== "undefined" && navigator.onLine === false ? "Offline" : connection}
      </p>
      {error ? <p role="alert" className="mb-2 text-xs text-critical">{error} <button type="button" onClick={() => refresh(true)} className="underline">Retry</button></p> : null}
      {loading && !points ? <div className="flex h-[280px] items-center justify-center text-sm text-muted" role="status">Loading case trend…</div>
        : !points ? <div className="flex h-[280px] items-center justify-center text-sm text-muted">Case trend unavailable.</div>
          : !hasComplaints ? <div className="flex h-[280px] items-center justify-center text-sm text-muted">No complaints filed in this period.</div>
            : <div className="relative w-full">
              <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Case volume and urgency trend by filing date, Asia/Manila">
                {Array.from({ length: yMax / step + 1 }, (_, i) => i * step).map((value) => (
                  <g key={value}>
                    <line x1={pad.left} y1={y(value)} x2={width - pad.right} y2={y(value)} stroke="#e7eef7" />
                    <text x={pad.left - 8} y={y(value) + 4} textAnchor="end" className="fill-muted" fontSize="11">{value}</text>
                  </g>
                ))}
                {data.map((p, i) => i % Math.max(1, Math.ceil(data.length / 7)) === 0 || i === data.length - 1 ? (
                  <text key={p.key} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted" fontSize="11">{p.label}</text>
                ) : null)}
                {visibleSeries.map((line) => (
                  <g key={line.key}>
                    <path d={data.map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p[line.key])}`).join(" ")}
                      fill="none" stroke={line.color} strokeWidth={line.weight} strokeLinecap="round" strokeLinejoin="round" />
                    {data.map((p, i) => <circle key={p.key} cx={x(i)} cy={y(p[line.key])} r="3.5" fill="white" stroke={line.color} strokeWidth="2" />)}
                  </g>
                ))}
                {data.map((p, i) => <rect key={`hover-${p.key}`}
                  x={i === 0 ? pad.left : (x(i - 1) + x(i)) / 2} y={pad.top}
                  width={data.length === 1 ? chartW : i === 0 ? (x(0) + x(1)) / 2 - pad.left : i === data.length - 1 ? width - pad.right - (x(i - 1) + x(i)) / 2 : (x(i) + x(i + 1)) / 2 - (x(i - 1) + x(i)) / 2}
                  height={chartH} fill="transparent" role="button" tabIndex={0}
                  aria-label={`${p.fullLabel}: ${p.Total} total, ${p.Normal} normal, ${p.High} high, ${p.Critical} critical, ${p.Unassessed} unassessed`}
                  onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)} onBlur={() => setActive(null)} />)}
              </svg>
              {hovered ? <div className="pointer-events-none absolute right-2 top-2 rounded-xl border border-line bg-white/95 p-3 text-[11px] shadow-sm" role="status">
                <p className="font-bold text-navy">{hovered.fullLabel} (Asia/Manila)</p>
                {SERIES.map((line) => <p key={line.key} className="mt-1 text-mirage">{line.label}: {hovered[line.key]}</p>)}
              </div> : null}
            </div>}
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1" aria-label="Toggle chart series">
        {SERIES.map((line) => <button key={line.key} type="button" aria-pressed={visible.includes(line.key)}
          onClick={() => setVisible((current) => current.includes(line.key) ? current.filter((key) => key !== line.key) : [...current, line.key])}
          className={`flex items-center gap-2 text-[12px] font-medium ${visible.includes(line.key) ? "text-muted" : "text-muted/50"}`}>
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: line.color }} />{line.label}
        </button>)}
      </div>
    </div>
  );
}
