"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { residentComplaintStatus } from "@/lib/constants";
import {
  getResidentCaseStatuses,
  getResidentHearings,
  getResidentVisibleDocuments,
} from "@/repositories/complaintRepository";

/**
 * The Resident Portal's single view of the resident's own case data.
 *
 * Before this existed each dashboard card ran its own query and opened its
 * own realtime channel, so three numbers on the same screen could disagree
 * for as long as a refetch took. The provider now runs one fetch and one
 * set of subscriptions for the whole portal, and every surface reads the
 * same derived counters — which is what makes the dashboard summary cards,
 * the Status Overview and the My Complaints count pills the same numbers.
 *
 * Nothing here creates resident-only records. Everything is read from the
 * canonical `complaints`, `case_statuses`, `hearings` and
 * `official_documents` rows the Captain Portal writes.
 */

const ResidentComplaintsContext = createContext(null);

function emptyContext() {
  return { caseStatuses: [], hearings: [], documents: [] };
}

/** Group rows by complaint_id so a card can read its own slice in O(1). */
function groupByComplaint(rows) {
  const grouped = {};
  for (const row of rows || []) {
    const key = row?.complaint_id;
    if (!key) continue;
    (grouped[key] ||= []).push(row);
  }
  return grouped;
}

function useResidentCaseSource() {
  const { user, isLoading: authLoading } = useAuth();
  const [complaints, setComplaints] = useState([]);
  const [caseContext, setCaseContext] = useState(emptyContext);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const userId = user?.id ?? null;

  /**
   * Load complaints and everything that hangs off them. The three
   * supporting queries are independent, so they run together and each is
   * individually tolerant: a missing `case_statuses` table must not blank
   * out the complaint list.
   */
  const fetchAll = useCallback(
    async (silent = false) => {
      if (!userId) return;
      if (!silent) setLoading(true);

      try {
        const supabase = createClient();
        const { data, error: queryError } = await supabase
          .from("complaints")
          .select("*")
          .eq("resident_id", userId)
          .order("submitted_at", { ascending: false });

        if (queryError) throw queryError;
        setComplaints(data || []);
        setError(null);
      } catch (err) {
        console.error("Failed to load complaints:", err);
        setError("Unable to load complaints.");
        setComplaints([]);
      } finally {
        if (!silent) setLoading(false);
      }

      const [caseStatuses, hearings, documents] = await Promise.all([
        getResidentCaseStatuses().catch(() => []),
        getResidentHearings().catch(() => []),
        getResidentVisibleDocuments().catch(() => []),
      ]);

      setCaseContext({ caseStatuses, hearings, documents });
    },
    [userId]
  );

  /* Keep a stable ref so realtime callbacks never go stale. */
  const fetchRef = useRef(fetchAll);
  useEffect(() => {
    fetchRef.current = fetchAll;
  });

  useEffect(() => {
    if (authLoading || !userId) return;

    let cancelled = false;
    (async () => {
      await fetchAll();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, fetchAll]);

  /* Reset when there is no signed-in resident. */
  useEffect(() => {
    if (!authLoading && !userId) {
      queueMicrotask(() => {
        setComplaints([]);
        setCaseContext(emptyContext());
        setLoading(false);
      });
    }
  }, [authLoading, userId]);

  const refresh = useCallback(() => fetchAll(false), [fetchAll]);

  /* ── Realtime ────────────────────────────────────────────────────
   *
   * One channel per table, all of them silent refetches. The payload is
   * never rendered: every row that reaches the UI comes back through an
   * RLS-scoped query, so a channel event can only ever trigger a re-read
   * that the database has already authorized.
   *
   * `hearings` and `official_documents` have no `resident_id` column, so
   * they cannot be filtered client-side. They are subscribed unfiltered
   * for wake-up only, which is the same trade the Captain portal makes.
   */
  useEffect(() => {
    if (authLoading || !userId) return;

    const supabase = createClient();
    const channels = [];

    const complaintsChannel = supabase
      .channel(`resident-complaints-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "complaints", filter: `resident_id=eq.${userId}` },
        () => fetchRef.current(true)
      )
      .subscribe();
    channels.push(complaintsChannel);

    for (const [name, table] of [
      ["resident-hearings", "hearings"],
      ["resident-documents", "official_documents"],
    ]) {
      channels.push(
        supabase
          .channel(`${name}-${userId}`)
          .on("postgres_changes", { event: "*", schema: "public", table }, () =>
            fetchRef.current(true)
          )
          .subscribe()
      );
    }

    return () => {
      for (const channel of channels) supabase.removeChannel(channel);
    };
  }, [authLoading, userId]);

  const derived = useMemo(() => {
    const total = complaints.length;
    const inProgress = complaints.filter(
      (c) => residentComplaintStatus(c.current_status) === "In Progress"
    ).length;
    const awaitingMeeting = complaints.filter(
      (c) => residentComplaintStatus(c.current_status) === "Awaiting Meeting"
    ).length;
    const resolved = complaints.filter(
      (c) => residentComplaintStatus(c.current_status) === "Resolved"
    ).length;
    const closed = complaints.filter(
      (c) => residentComplaintStatus(c.current_status) === "Closed"
    ).length;
    const pendingReview = complaints.filter(
      (c) => residentComplaintStatus(c.current_status) === "Pending Review"
    ).length;
    const critical = complaints.filter(
      (c) => c.predicted_urgency === "Critical" || c.confirmed_urgency === "Critical"
    ).length;

    return {
      counts: { total, inProgress, awaitingMeeting, resolved, closed, pendingReview, critical },
      caseStatusesByComplaint: groupByComplaint(caseContext.caseStatuses),
      hearingsByComplaint: groupByComplaint(caseContext.hearings),
      documentsByComplaint: groupByComplaint(caseContext.documents),
      hearings: caseContext.hearings,
      documents: caseContext.documents,
      caseStatuses: caseContext.caseStatuses,
    };
  }, [complaints, caseContext]);

  return useMemo(
    () => ({
      complaints,
      counts: derived.counts,
      caseStatusesByComplaint: derived.caseStatusesByComplaint,
      hearingsByComplaint: derived.hearingsByComplaint,
      documentsByComplaint: derived.documentsByComplaint,
      hearings: derived.hearings,
      documents: derived.documents,
      caseStatuses: derived.caseStatuses,
      loading,
      error,
      refresh,
    }),
    [complaints, derived, loading, error, refresh]
  );
}

/**
 * Mount once, above the Resident Portal. Every consumer then shares one
 * query set and one set of subscriptions.
 */
export function ResidentComplaintsProvider({ children }) {
  const value = useResidentCaseSource();
  return (
    <ResidentComplaintsContext.Provider value={value}>
      {children}
    </ResidentComplaintsContext.Provider>
  );
}

/**
 * Read the shared case data.
 *
 * The provider is mounted once in `app/resident/layout.js`, above every
 * resident surface. Reading a second local copy here would re-run the
 * queries this hook exists to deduplicate, so a missing provider is a
 * wiring bug and is reported as one rather than silently served empty data.
 */
export default function useResidentComplaints() {
  const context = useContext(ResidentComplaintsContext);
  if (!context) {
    throw new Error(
      "useResidentComplaints must be used within ResidentComplaintsProvider " +
        "(mounted in app/resident/layout.js)."
    );
  }
  return context;
}

/** Read just the counters, for surfaces that do not need the rows. */
export function useResidentComplaintCounts() {
  const { counts } = useResidentComplaints();
  return counts;
}
