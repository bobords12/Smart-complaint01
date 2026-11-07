"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { FilePlus2, CheckCircle2, UserCheck } from "lucide-react";
import { SITE } from "@/lib/constants";
import Panel from "./Panel";
import AttendanceModal from "./AttendanceModal";
import ServiceModal from "./ServiceModal";
import { formatDateShort, formatTime, formatDateTime } from "./complaintMeta";
import {
  HEARING_NOTICE_TEMPLATE_NOTE,
  HEARING_NOTICE_TEMPLATE_STATUS,
} from "@/lib/hearing/mediationDocuments";
import { logComplaintActivity, notifyResidentHearingEvent } from "@/lib/complaintQueries";
import { routingGate, GATE_EXPLANATION } from "@/lib/captainComplaintRouting";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";

const HEARING_TYPE = "Mediation";

function dateParts(value) {
  const d = new Date(`${value}T00:00:00`);
  return {
    month: d.toLocaleString("en-US", { month: "short" }).toUpperCase(),
    day: String(d.getDate()).padStart(2, "0"),
  };
}

export default function HearingsTab({ supabase, user, complaint, hearings = [], serviceRecords = [], onChanged }) {
  const gate = routingGate(complaint);
  const { viewDocument } = useDocumentViewer();
  const [schedule, setSchedule] = useState({
    hearing_date: "",
    hearing_time: "",
    venue: SITE.hall,
  });
  const [scheduling, setScheduling] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [serviceFor, setServiceFor] = useState(null);

  /**
   * Earliest date a hearing may be set to.
   *
   * A session cannot precede the complaint it belongs to. This guard is
   * the root-cause fix for the record that ended up dated 2001-10-10: a
   * stray year typed into the date field was accepted without complaint
   * and became a permanent row. Rejecting anything before the complaint
   * was filed makes that class of typo impossible to save rather than
   * leaving it for a viewer to notice.
   */
  const earliestDate = String(
    complaint?.submitted_at || complaint?.incident_date || ""
  ).slice(0, 10);

  const handleSchedule = async () => {
    if (!schedule.hearing_date) {
      toast.error("Select a hearing date.");
      return;
    }
    if (
      earliestDate &&
      schedule.hearing_date < earliestDate
    ) {
      toast.error(
        `A hearing cannot be set before the complaint was filed (${earliestDate}).`
      );
      return;
    }
    if (!schedule.hearing_time) {
      toast.error("Select a hearing time.");
      return;
    }
    if (!String(schedule.venue || "").trim()) {
      toast.error("Enter a venue for the hearing.");
      return;
    }
    setScheduling(true);
    try {
      const sessionNumber = (hearings || []).filter(
        (h) => h.hearing_type === HEARING_TYPE
      ).length + 1;
      const title = `${ordinal(sessionNumber)} Captain Mediation`;
      const { data, error } = await supabase
        .from("hearings")
        .insert({
          complaint_id: complaint.id,
          hearing_type: HEARING_TYPE,
          title,
          hearing_date: schedule.hearing_date,
          hearing_time: schedule.hearing_time,
          venue: String(schedule.venue).trim(),
          status: "Upcoming",
          created_by: user?.id || null,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new Error(
          "The hearing was not saved. Supabase accepted the request but returned no record."
        );
      }

      // The row is committed already, so an audit failure must not be
      // reported as a failed save.
      const { error: auditError } = await logComplaintActivity(supabase, {
        action: "hearing_scheduled",
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: {
          hearing_id: data.id,
          date: schedule.hearing_date,
          time: schedule.hearing_time,
          venue: schedule.venue,
        },
      });
      if (auditError) {
        console.error("HearingsTab: hearing saved but audit log failed", {
          hearingId: data.id,
          error: auditError,
        });
      }

      /**
       * Tell the complainant a session exists. Until this ran, a hearing
       * scheduled by the Captain was invisible in the Resident Portal's
       * own notification list — the resident only found out by happening
       * to open the hearings page. Failure here is non-fatal by design:
       * the hearing is already on the case.
       */
      try {
        await notifyResidentHearingEvent(
          supabase,
          complaint.id,
          complaint.resident_id,
          {
            id: data.id,
            title,
            hearing_type: HEARING_TYPE,
            hearing_date: schedule.hearing_date,
            hearing_time: schedule.hearing_time,
            venue: schedule.venue,
          },
          "scheduled"
        );
      } catch {
        // Non-fatal: the schedule itself is already saved.
      }

      toast.success("Hearing scheduled. A notice can be generated from the Documents tab.");
      setSchedule({ hearing_date: "", hearing_time: "", venue: SITE.hall });
      onChanged();
    } catch (caught) {
      // Surface the actual reason (routing gate, RLS, constraint) instead of
      // a generic message. Entered values are intentionally left in place.
      const message = caught?.message || "Could not schedule the hearing. Please try again.";
      console.error("HearingsTab: could not save hearing", {
        complaintId: complaint?.id,
        schedule,
        error: caught,
      });
      toast.error(message, { duration: 9000 });
    } finally {
      setScheduling(false);
    }
  };

  const handleNoticeNote = () => {
    toast(HEARING_NOTICE_TEMPLATE_NOTE, { duration: 9000 });
  };

  const allSummons = (hearings || []).flatMap((h) =>
    (h.summons || []).map((s) => ({ ...s, hearing: h }))
  );

  // Opens the issued Notice of Hearing in the shared in-app viewer, so it is
  // read on screen rather than saved to the device first. The `summons` row
  // is the issuance ledger and points at the notice document.
  const openSummons = (summons) => {
    if (!summons?.storage_path) {
      toast.error("This Notice of Hearing has no stored file.");
      return;
    }
    viewDocument({
      supabase,
      bucket: "documents",
      storagePath: summons.storage_path,
      title: `Notice of Hearing — ${summons.hearing?.title || "Hearing"}`,
      subtitle: summons.hearing?.hearing_date ? formatDateShort(summons.hearing.hearing_date) : null,
      filename: summons.filename || null,
      mime: summons.mime_type || null,
      errorMessage: "Could not open this Notice of Hearing.",
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Hearing Notice and Service"
          tag={serviceRecords.length > 0 ? "Served" : "Not served"}
          tagClass={serviceRecords.length > 0 ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}
          className="lg:col-span-2"
        >
          {allSummons.length === 0 ? (
            <p className="text-sm text-muted">
              No Notice of Hearing has been issued yet. {HEARING_NOTICE_TEMPLATE_NOTE}
            </p>
          ) : (
            <div className="space-y-3">
              {allSummons.map((summons) => (
                <div key={summons.id} className="rounded-xl border border-line px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-navy">
                        Notice of Hearing — {summons.hearing?.title || "Hearing"}
                      </p>
                      <p className="text-xs text-muted">
                        Issued {formatDateTime(summons.issued_at)} · Hearing{" "}
                        {summons.hearing?.hearing_date
                          ? formatDateShort(summons.hearing.hearing_date)
                          : "not scheduled yet"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openSummons(summons)}
                      className="text-xs font-semibold text-secondary hover:underline"
                    >
                      Preview
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <ServiceSummary
                      records={serviceRecords}
                      role="complainant"
                      label="Complainant Service"
                    />
                    <ServiceSummary
                      records={serviceRecords}
                      role="respondent"
                      label="Respondent Service"
                    />
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted">
                        Proof of Service
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-mirage">
                        {serviceRecords.length} record(s)
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Schedule Controls">
          {gate.open ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="hear-date" className="mb-1 block text-xs font-semibold text-muted">
                  Hearing date
                </label>
                <input
                  id="hear-date"
                  type="date"
                  value={schedule.hearing_date}
                  onChange={(e) => setSchedule({ ...schedule, hearing_date: e.target.value })}
                  className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />
              </div>
              <div>
                <label htmlFor="hear-time" className="mb-1 block text-xs font-semibold text-muted">
                  Time
                </label>
                <input
                  id="hear-time"
                  type="time"
                  value={schedule.hearing_time}
                  onChange={(e) => setSchedule({ ...schedule, hearing_time: e.target.value })}
                  className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />
              </div>
              <div>
                <label htmlFor="hear-venue" className="mb-1 block text-xs font-semibold text-muted">
                  Venue
                </label>
                <input
                  id="hear-venue"
                  value={schedule.venue}
                  onChange={(e) => setSchedule({ ...schedule, venue: e.target.value })}
                  className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />
              </div>
              <button
                type="button"
                onClick={handleSchedule}
                disabled={scheduling}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-jordy px-5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary disabled:opacity-70"
              >
                {scheduling ? "Saving…" : "Save Approved Schedule"}
              </button>
            </div>
          ) : (
            <div>
              <p className="rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold leading-relaxed text-warning">
                {GATE_EXPLANATION} A hearing cannot be scheduled until this is resolved in Routing
                Assessment.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                The database also refuses new hearings on an unassessed complaint, so this is not a
                client-side-only restriction.
              </p>
            </div>
          )}
        </Panel>

        <div className="lg:col-span-2">
          <Panel
            title="Hearing Sessions"
            tag={`${hearings.length} scheduled`}
            tagClass="bg-info-soft text-secondary"
          >
            {hearings.length === 0 ? (
              <p className="text-sm text-muted">
                No hearings have been scheduled for this complaint.
              </p>
            ) : (
              <ul className="space-y-3">
                {hearings.map((hearing) => {
                  const { month, day } = dateParts(hearing.hearing_date);
                  return (
                    <li
                      key={hearing.id}
                      className="flex flex-wrap items-center gap-4 rounded-xl border border-line px-4 py-3"
                    >
                      <span className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-info-soft">
                        <span className="text-[10px] font-bold uppercase text-secondary">{month}</span>
                        <span className="text-base font-bold leading-none text-navy">{day}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-navy">{hearing.title}</p>
                        <p className="text-xs text-muted">
                          {formatTime(hearing.hearing_time)} · {hearing.venue} · {hearing.status}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            (hearing.summons?.length ?? 0) > 0
                              ? "bg-success-soft text-success"
                              : "bg-alt text-muted"
                          }`}
                        >
                          <FilePlus2 className="h-3 w-3" aria-hidden="true" />
                          {hearing.summons?.length ?? 0} issued
                        </span>
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"
                          title={HEARING_NOTICE_TEMPLATE_NOTE}
                        >
                          {HEARING_NOTICE_TEMPLATE_STATUS}
                        </span>
                        <button
                          type="button"
                          onClick={handleNoticeNote}
                          disabled={!gate.open}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft disabled:opacity-50"
                        >
                          <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Why is this generated this way?
                        </button>
                        <button
                          type="button"
                          onClick={() => setServiceFor(hearing)}
                          disabled={(hearing.summons?.length ?? 0) === 0}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-50"
                        >
                          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Record Service
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveModal(hearing)}
                          disabled={hearing.status === "Completed"}
                          className="inline-flex items-center gap-1.5 rounded-full bg-jordy px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-secondary disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {hearing.status === "Completed" ? "Completed" : "Record Attendance"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <AttendanceModal
        open={activeModal !== null}
        onClose={() => setActiveModal(null)}
        supabase={supabase}
        complaint={complaint}
        hearing={activeModal}
        onSaved={onChanged}
      />
      <ServiceModal
        open={serviceFor !== null}
        onClose={() => setServiceFor(null)}
        supabase={supabase}
        complaint={complaint}
        summons={serviceFor?.summons?.[0] || null}
        onSaved={onChanged}
      />
    </div>
  );
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function ServiceSummary({ records, role, label }) {
  const matching = records.filter((r) => r.party_role === role);
  const latest = matching[0];
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      {latest ? (
        <p className="mt-0.5 text-sm font-semibold text-success">
          {formatDateShort(latest.served_on)} · {latest.mode_of_service || "Personal"}
        </p>
      ) : (
        <p className="mt-0.5 text-sm font-semibold text-mirage">Not recorded</p>
      )}
    </div>
  );
}