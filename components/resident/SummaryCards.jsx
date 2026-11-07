"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Hourglass,
  ShieldAlert,
} from "lucide-react";
import { RESIDENT_ROUTES } from "@/lib/constants";
import useResidentComplaints from "@/hooks/useResidentComplaints";

const CARD_META = [
  {
    key: "total",
    icon: ClipboardList,
    iconClass: "bg-info-soft text-secondary",
    filter: {},
  },
  {
    key: "inProgress",
    icon: Hourglass,
    iconClass: "bg-action/10 text-action",
    filter: { status: "in-progress" },
  },
  {
    key: "resolved",
    icon: CheckCircle2,
    iconClass: "bg-success-soft text-success",
    filter: { status: "resolved" },
  },
  {
    key: "critical",
    icon: ShieldAlert,
    iconClass: "bg-critical-soft text-critical",
    filter: { priority: "critical" },
  },
];

const LABELS = {
  total: "Total",
  inProgress: "In Progress",
  resolved: "Resolved",
  critical: "Critical",
};

export default function SummaryCards() {
  const { counts } = useResidentComplaints();

  return (
    <section aria-label="Complaint summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CARD_META.map((card) => {
        const count = counts[card.key] ?? 0;
        const Icon = card.icon;
        const query = new URLSearchParams(card.filter).toString();
        const href = query ? `${RESIDENT_ROUTES.complaints}?${query}` : RESIDENT_ROUTES.complaints;
        const filterLabel = Object.values(card.filter)[0] ?? "all complaints";
        return (
          <Link
            key={card.key}
            href={href}
            aria-label={`${LABELS[card.key]}: ${count}. Opens ${filterLabel} complaints`}
            className="group rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(11,33,68,0.12)] focus-visible:outline-2 focus-visible:outline-secondary"
          >
            <div className="flex items-start justify-between gap-3">
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-xl ${card.iconClass}`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <ArrowUpRight
                className="h-5 w-5 text-muted/50 transition-colors group-hover:text-secondary"
                aria-hidden="true"
              />
            </div>
            <p className="mt-4 font-heading text-3xl font-semibold tracking-tight text-navy dark:text-secondary">
              {count}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-mirage">
              {LABELS[card.key]}
            </p>
          </Link>
        );
      })}
    </section>
  );
}
