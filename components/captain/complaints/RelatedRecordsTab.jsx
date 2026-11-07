/**
 * Related Records — the blotter entry and the barangay referral.
 *
 * These live beside the routing decision, not inside it. Routing asks
 * "where does this case go"; these record what has already been linked
 * or sent: an entry in the Digital Blotter, or a referral passed to an
 * outside office. Keeping them apart means the routing tab answers one
 * question, and an official looking for the blotter number is not
 * walking through the respondent and KP fields to find it.
 *
 * Everything here is a write the Captain or OIC makes deliberately:
 * nothing is linked automatically, and a complaint carries at most one
 * open blotter record (enforced by the database, not by this panel).
 */

"use client";

import { useMemo, useState } from "react";
import { FileText, Send } from "lucide-react";
import {
  assistanceTypeMeta,
  canDecideRouting,
  isIncidentLike,
  isReferralRoute,
} from "@/lib/captainComplaintRouting";
import { formatDateTime } from "./complaintMeta";
import BlotterModal from "./BlotterModal";
import AssistanceRecordModal from "./AssistanceRecordModal";

function Row({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold text-mirage">{children || "—"}</div>
    </div>
  );
}

export default function RelatedRecordsTab({
  supabase,
  role,
  complaint,
  blotterRecord,
  assistanceRecords = [],
  routingUnavailable = false,
  focus,
  onFocusCleared,
  onChanged,
}) {
  const mayDecide = canDecideRouting(role);
  const incidentLike = isIncidentLike(complaint);
  const routed = isReferralRoute(complaint?.routing_status);

  const [modals, setModals] = useState({ blotter: false, assistance: false });

  // "Continue Case Processing" can land here for a blotter or referral
  // step; the focus is read rather than acted on in an effect so no
  // modal opens behind the official's back during a render.
  const focusedKeys = useMemo(() => {
    if (focus === "blotter" || focus === "assistance") return [focus];
    return [];
  }, [focus]);

  const isOpen = (key) => modals[key] || focusedKeys.includes(key);

  const open = (key) => setModals((m) => ({ ...m, [key]: true }));

  const close = (key) => {
    setModals((m) => ({ ...m, [key]: false }));
    if (focusedKeys.includes(key) && onFocusCleared) onFocusCleared();
  };

  return (
    <div className="space-y-5">
      {routingUnavailable ? (
        <p className="rounded-xl border border-line bg-alt px-4 py-3 text-xs leading-relaxed text-muted">
          Referral records are not available. Apply{" "}
          <code className="font-mono">captain-complaint-routing-workflow.sql</code> and{" "}
          <code className="font-mono">captain-complaint-routing-rls.sql</code> to record them. The
          case itself is unaffected.
        </p>
      ) : null}

      {/* ── Blotter entry ─────────────────────────────────────── */}
      <section>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-navy">
            <FileText className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
            Blotter Record
          </h3>
          {mayDecide && !blotterRecord && incidentLike ? (
            <button
              type="button"
              onClick={() => open("blotter")}
              className="inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-xs font-semibold text-mirage transition-colors hover:bg-alt"
            >
              Create or Link
            </button>
          ) : null}
        </header>

        {blotterRecord ? (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Row label="Blotter number">
              <a
                href={blotterRecord.id ? `/captain/blotter/${blotterRecord.id}` : undefined}
                className="text-secondary hover:underline"
              >
                {blotterRecord.blotter_number}
              </a>
            </Row>
            <Row label="Record status">{blotterRecord.current_status}</Row>
            <Row label="Recorded">{formatDateTime(blotterRecord.recorded_at)}</Row>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Not linked.
            {mayDecide && !incidentLike
              ? " A blotter entry is recorded for reported incidents."
              : ""}
          </p>
        )}
      </section>

      <div className="border-t border-line" />

      {/* ── Referral to an outside office ─────────────────────── */}
      <section>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-navy">
            <Send className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
            Referral
          </h3>
          {mayDecide && routed ? (
            <button
              type="button"
              onClick={() => open("assistance")}
              className="inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-xs font-semibold text-mirage transition-colors hover:bg-alt"
            >
              Record Referral
            </button>
          ) : null}
        </header>

        {assistanceRecords.length === 0 ? (
          <p className="mt-3 text-sm text-muted">None recorded.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {assistanceRecords.map((record) => {
              const typeMeta = assistanceTypeMeta(record.assistance_type);
              return (
                <li key={record.id} className="rounded-xl border border-line px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-mirage">
                      {typeMeta ? typeMeta.label : record.assistance_type}
                    </p>
                    <p className="text-xs text-muted">{formatDateTime(record.recorded_at)}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {record.agency_name
                      ? record.agency_name
                      : record.reference_number
                        ? "No office named"
                        : "No office recorded"}
                    {record.reference_number ? ` · Ref. ${record.reference_number}` : ""}
                    {record.recorded_by_name ? ` · Recorded by ${record.recorded_by_name}` : ""}
                  </p>
                  {record.assistance_given ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-mirage">
                      {record.assistance_given}
                    </p>
                  ) : null}
                  {record.assistance_summary ? (
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      {record.assistance_summary}
                    </p>
                  ) : null}
                  {record.recorded_outcome ? (
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Outcome noted: {record.recorded_outcome}
                    </p>
                  ) : null}
                  {record.follow_up_required ? (
                    <p className="mt-1 text-xs font-semibold text-warning">
                      Follow-up required
                      {record.follow_up_due_on ? ` by ${record.follow_up_due_on}` : ""}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {mayDecide && !routed ? (
          <p className="mt-2 text-xs text-muted">Available after the case route is set.</p>
        ) : null}
      </section>

      {mayDecide ? (
        <>
          <BlotterModal
            key={`blotter-${isOpen("blotter")}`}
            open={isOpen("blotter")}
            onClose={() => close("blotter")}
            onSaved={onChanged}
            complaint={complaint}
            supabase={supabase}
          />
          <AssistanceRecordModal
            key={`assistance-${isOpen("assistance")}`}
            open={isOpen("assistance")}
            onClose={() => close("assistance")}
            onSaved={onChanged}
            complaint={complaint}
            supabase={supabase}
            assistanceType={complaint?.routing_status}
          />
        </>
      ) : null}
    </div>
  );
}
