"use client";

import { toast } from "react-hot-toast";
import { Eye, FileText } from "lucide-react";
import { SITE } from "@/lib/constants";
import StatusBadge from "@/components/shared/StatusBadge";
import {
  resolveComplainantName,
  resolveRespondent,
  formatDateTime,
} from "./complaintMeta";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";

function Detail({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-mirage">{children || "—"}</p>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function evidenceTypeLabel(type) {
  const map = { photo: "Image", document: "Document", audio: "Audio", video: "Video" };
  return map[type] || type || "File";
}

export default function OverviewTab({ supabase, complaint, evidence, kpTracker, blotterRecord }) {
  const { viewDocument } = useDocumentViewer();

  // Evidence is shown in the same in-app viewer as the case documents, so a
  // photo or PDF opens on screen instead of being saved to the device first.
  const openEvidence = (item) => {
    if (!item.storage_path) {
      toast.error("This evidence file has no stored path.");
      return;
    }
    viewDocument({
      supabase,
      bucket: "evidence",
      storagePath: item.storage_path,
      title: item.original_filename || "Evidence",
      subtitle: evidenceTypeLabel(item.evidence_type),
      filename: item.original_filename,
      mime: item.mime_type,
      errorMessage: "Could not open this file. It may no longer exist in storage.",
    });
  };

  const residentProfile = complaint.profiles?.resident_profiles?.[0];

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-line bg-alt px-4 py-3 text-xs leading-relaxed text-muted">
        <strong className="font-semibold text-mirage">Official meaning:</strong> Accepting this
        complaint for processing confirms completeness and applicability; it does not establish
        that the allegation is true.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-line bg-white shadow-soft lg:col-span-2">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h3 className="font-heading text-sm font-semibold text-navy">
              Complaint and Party Information
            </h3>
            <span className="inline-flex shrink-0 items-center rounded-full bg-info-soft px-2.5 py-1 text-[11px] font-semibold text-secondary">
              Original submission
            </span>
          </header>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Complainant">{resolveComplainantName(complaint)}</Detail>
            <Detail label="Respondent">{resolveRespondent(complaint)}</Detail>
            <Detail label="Date and Time Filed">
              {formatDateTime(complaint.submitted_at)}
            </Detail>
            <Detail label="Filing Channel">Resident Web Portal</Detail>
            <Detail label="Incident Date">
              {complaint.incident_date
                ? formatDateTime(`${complaint.incident_date}T${complaint.incident_time || "00:00"}`)
                : "—"}
            </Detail>
            <Detail label="Incident Location">{complaint.incident_location}</Detail>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-white shadow-soft">
          <header className="border-b border-line px-5 py-4">
            <h3 className="font-heading text-sm font-semibold text-navy">Complaint Narrative</h3>
          </header>
          <p className="whitespace-pre-line px-5 py-4 text-sm leading-relaxed text-mirage">
            {complaint.description || complaint.title || "No narrative recorded."}
          </p>
        </section>

        <section className="rounded-2xl border border-line bg-white shadow-soft lg:col-span-2">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h3 className="font-heading text-sm font-semibold text-navy">Submitted Evidence</h3>
            <span className="shrink-0 text-xs font-medium text-muted">{evidence.length} file(s)</span>
          </header>
          <div className="flex flex-col gap-2 px-5 py-4">
            {evidence.length === 0 ? (
              <p className="text-sm text-muted">No evidence was attached.</p>
            ) : (
              evidence.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-info-soft">
                      <FileText className="h-4 w-4 text-secondary" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-navy">
                        {item.original_filename || "Unnamed file"}
                      </p>
                      <p className="text-xs text-muted">
                        {evidenceTypeLabel(item.evidence_type)} · {formatBytes(item.file_size)}
                        {item.description ? ` · ${item.description}` : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEvidence(item)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    View
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-white shadow-soft">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h3 className="font-heading text-sm font-semibold text-navy">
              Applicability and Record Check
            </h3>
            <StatusBadge
              label={kpTracker?.kp_applicable ? "Completed" : "Pending"}
            />
          </header>
          <div className="grid grid-cols-1 gap-4 px-5 py-4">
            <Detail label="Identity / Contact">
              {residentProfile ? "Verified" : "Awaiting verification"}
            </Detail>
            <Detail label="Venue">{complaint.incident_location || SITE.barangay}</Detail>
            <Detail label="KP Applicability">
              {kpTracker?.kp_applicable ? "Applicable" : "Pending confirmation"}
            </Detail>
            <Detail label="Digital Logbook Entry">
              {blotterRecord?.blotter_number || "—"}
            </Detail>
          </div>
        </section>
      </div>
    </div>
  );
}