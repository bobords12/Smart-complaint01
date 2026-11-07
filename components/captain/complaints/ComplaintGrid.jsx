"use client";

import { Inbox } from "lucide-react";
import EmptyState from "@/components/shared/EmptyState";
import ComplaintCard from "./ComplaintCard";

function SkeletonCard() {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse overflow-hidden rounded-2xl border border-line bg-white p-5"
    >
      <div className="h-1 w-full rounded-full bg-alt" />
      <div className="mt-4 space-y-3">
        <div className="h-4 w-2/3 rounded-full bg-alt" />
        <div className="h-3 w-1/2 rounded-full bg-alt" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-8 rounded-lg bg-alt" />
          <div className="h-8 rounded-lg bg-alt" />
        </div>
        <div className="h-1.5 w-full rounded-full bg-alt" />
        <div className="h-3 w-3/4 rounded-full bg-alt" />
      </div>
    </div>
  );
}

export default function ComplaintGrid({
  complaints,
  hearingsByComplaint = {},
  kpTrackerMap = {},
  blotterMap = {},
  incidentDetailMap = {},
  assistanceMap = {},
  loading,
  emptyMessage,
  onOpen,
}) {
  if (loading) {
    return (
      <section
        aria-label="Complaint cards"
        className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
        aria-busy="true"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </section>
    );
  }

  if (!complaints.length) {
    return (
      <div className="rounded-2xl border border-line bg-white">
        <EmptyState
          icon={Inbox}
          title="No complaints found"
          message={emptyMessage || "No complaints match the current filters."}
        />
      </div>
    );
  }

  return (
    <section
      aria-label="Complaint cards"
      className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
    >
      {complaints.map((complaint) => (
        <ComplaintCard
          key={complaint.id}
          complaint={complaint}
          kpTracker={kpTrackerMap[complaint.id]}
          hearings={hearingsByComplaint[complaint.id] || []}
          blotterRecord={blotterMap[complaint.id] || null}
          incidentRecorded={Boolean(incidentDetailMap[complaint.id])}
          assistanceRecorded={Boolean(assistanceMap[complaint.id])}
          onOpen={() => onOpen(complaint.id)}
        />
      ))}
    </section>
  );
}