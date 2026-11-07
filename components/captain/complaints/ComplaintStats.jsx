"use client";

import { ClipboardCheck, Sparkles, Activity, AlertTriangle } from "lucide-react";
import { STAGE_KEYS } from "./complaintMeta";

const CARDS = [
  {
    key: STAGE_KEYS.CHECK,
    label: "Awaiting Information Check",
    note: "Identity, completeness, venue, KP applicability",
    icon: ClipboardCheck,
    accent: "bg-[#b45309]",
    soft: "bg-[#b45309]/10 text-[#b45309]",
  },
  {
    key: "categorization",
    label: "For Official Categorization",
    note: "AI suggestions awaiting verification",
    icon: Sparkles,
    accent: "bg-[#714bd8]",
    soft: "bg-[#714bd8]/10 text-[#714bd8]",
  },
  {
    key: "active",
    label: "Active Mediation / Pangkat",
    note: "With deadline monitoring",
    icon: Activity,
    accent: "bg-[#1b4c8c]",
    soft: "bg-info-soft text-secondary",
  },
  {
    key: "critical",
    label: "Critical Advisories",
    note: "Immediate official review required",
    icon: AlertTriangle,
    accent: "bg-critical",
    soft: "bg-critical-soft text-critical",
  },
];

export default function ComplaintStats({ counts, loading }) {
  return (
    <section
      aria-label="Complaint summary"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {CARDS.map(({ key, label, note, icon: Icon, accent, soft }) => (
        <article
          key={key}
          className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-white p-5 shadow-soft"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {label}
            </p>
            <p className="mt-2 text-3xl font-bold text-navy">
              {loading ? "–" : counts[key] ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted">{note}</p>
          </div>
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${soft}`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className={`sr-only h-0 ${accent}`} aria-hidden="true" />
        </article>
      ))}
    </section>
  );
}