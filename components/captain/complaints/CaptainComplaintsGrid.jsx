"use client";

/**
 * Captain Portal -> Complaints: card grid.
 *
 * Uses ./CaptainComplaintCard.jsx, which is Captain-only. The shared
 * ./ComplaintGrid.jsx is left untouched for the OIC and Secretary
 * portals.
 */

import { useMemo } from "react";
import { Inbox } from "lucide-react";
import EmptyState from "@/components/shared/EmptyState";
import CaptainComplaintCard from "./CaptainComplaintCard";
import { workflowContextFor } from "@/lib/captainComplaintWorkflow";

function SkeletonCard() {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse overflow-hidden rounded-2xl border border-line bg-white p-5"
    >
      <div className="h-1 w-full rounded-full bg-alt" />
      <div className="mt-4 space-y-3">
        <div className="h-3 w-1/3 rounded-full bg-alt" />
        <div className="h-4 w-4/5 rounded-full bg-alt" />
        <div className="h-3 w-1/2 rounded-full bg-alt" />
        <div className="flex gap-1.5">
          <div className="h-6 w-20 rounded-full bg-alt" />
          <div className="h-6 w-16 rounded-full bg-alt" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-8 rounded-lg bg-alt" />
          <div className="h-8 rounded-lg bg-alt" />
        </div>
        <div className="h-3 w-3/4 rounded-full bg-alt" />
      </div>
    </div>
  );
}

export default function CaptainComplaintsGrid({ complaints, source, loading, emptyMessage, onOpen }) {
  // Each card's workflow context is derived from the maps on `source`.
  // Building it inline meant a fresh object per card on every render, so
  // React could never skip a card even when nothing about that card had
  // changed. Keyed on the maps themselves, so a realtime refresh or a
  // filter change still produces fresh contexts.
  const workflows = useMemo(() => {
    const map = new Map();
    for (const complaint of complaints) {
      map.set(complaint.id, {
        ...workflowContextFor(complaint.id, source),
        kpTracker: source?.kpTrackerMap?.[complaint.id],
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    complaints,
    source?.summonsMap,
    source?.serviceMap,
    source?.documentsMap,
    source?.attendanceMap,
    source?.hearingsByComplaint,
    source?.blotterMap,
    source?.kpTrackerMap,
    source?.kpPhasesMap,
    source?.luponPanelsMap,
    source?.pangkatTrackerMap,
  ]);

  if (loading) {
    return (
      <section
        aria-label="Complaint cards"
        aria-busy="true"
        className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
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
          message={emptyMessage || "No complaints match the current search or filters."}
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
        <CaptainComplaintCard
          key={complaint.id}
          complaint={complaint}
          workflow={workflows.get(complaint.id)}
          onOpen={onOpen}
        />
      ))}
    </section>
  );
}