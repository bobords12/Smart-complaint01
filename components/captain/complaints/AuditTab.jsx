"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Download } from "lucide-react";
import Panel from "./Panel";
import InternalNoteModal from "./InternalNoteModal";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { formatDateTime, formatDateShort } from "./complaintMeta";

const NOTE_META = {
  internal: {
    label: "Internal note",
    chip: "bg-alt text-muted",
    border: "border-l-alt",
  },
  resident_visible: {
    label: "Notice to parties",
    chip: "bg-info-soft text-secondary",
    border: "border-l-jordy",
  },
  update: {
    label: "Update",
    chip: "bg-gold-soft text-[#b04503]",
    border: "border-l-[#b45309]",
  },
};

export default function AuditTab({ complaint, activityLogs = [], internalNotes = [], supabase }) {
  const [showNote, setShowNote] = useState(false);
  const [allNotes, setAllNotes] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const viewableNotes = allNotes ? internalNotes : internalNotes.filter((n) => n.is_resident_visible);
  const exported = [...(activityLogs || []), ...(internalNotes || [])];

  const handleNoteSaved = (note) => {
    setShowNote(false);
    setAllNotes(allNotes || note?.is_resident_visible);
    toast.success(note?.is_resident_visible ? "Notice added to the parties." : "Internal note saved.");
  };

  const handleExport = async () => {
    setExportBusy(true);
    try {
      const rows = exported.map((entry) => {
        const type = entry.event_type ?? entry.note_type;
        const label = type === "note" ? "Case note" : type || "Entry";
        const dt = entry.created_at || entry.timestamp;
        return {
          Date: dt ? formatDateTime(dt) : "—",
          Actor: entry.actor_name || entry.author_name || entry.profiles?.display_name || "System",
          Type: label,
          Entry: entry.action ? formatAction(entry.action) : entry.message || entry.notes || "—",
        };
      });
      const csv = buildCsv(rows);
      downloadCsv(
        csv,
        `audit-${(complaint?.reference_number || complaint?.id || "case").replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`
      );
      toast.success("Audit log exported.");
    } catch {
      toast.error("Could not export the audit log.");
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Audit History"
        tag={`${exported.length} entries`}
        tagClass="bg-info-soft text-secondary"
        className="lg:col-span-2"
      >
        {exported.length === 0 ? (
          <p className="text-sm text-muted">
            No audit entries yet. Actions taken in this case will appear here.
          </p>
        ) : (
          <ol className="relative space-y-0 border-l-2 border-line pl-5">
            {exported.slice(0, 8).map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {exported.length > 8 ? (
            <span className="text-xs text-muted">
              Showing 8 of {exported.length}. Use the export to review the full log.
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleExport}
            disabled={exportBusy || exported.length === 0}
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-xs font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {exportBusy ? "Preparing…" : "Export CSV"}
          </button>
        </div>
      </Panel>

      <div className="lg:col-span-2">
        <Panel
          title="Case Notes"
          tag={`${internalNotes.length} saved`}
          tagClass="bg-alt text-muted"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowNote(true)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-jordy px-4 text-xs font-semibold text-white transition-colors hover:bg-secondary"
            >
              Add Internal Note
            </button>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-mirage">
              <input
                type="checkbox"
                checked={allNotes}
                onChange={(e) => setAllNotes(e.target.checked)}
                className="h-4 w-4 rounded border-line accent-[#1b4c8c]"
              />
              Show internal notes
            </label>
          </div>

          {viewableNotes.length === 0 ? (
            <p className="text-sm text-muted">
              {internalNotes.length > 0
                ? "All notes are internal. Toggle “Show internal notes” to view them."
                : "Add a case note to document findings or reminders."}
            </p>
          ) : (
            <ul className="space-y-3">
              {viewableNotes.map((note) => {
                const meta =
                  NOTE_META[note?.is_resident_visible ? "resident_visible" : "internal"] ||
                  NOTE_META.update;
                return (
                  <li
                    key={note.id}
                    className={`rounded-xl rounded-l-none border border-l-4 ${meta.border} border-line bg-white px-4 py-3`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${meta.chip}`}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-muted">
                        {note.author_id ? "Official" : "System"} ·{" "}
                        {formatDateTime(note.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-mirage">
                      {note.note}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <InternalNoteModal
        open={showNote}
        onClose={() => setShowNote(false)}
        onSaved={handleNoteSaved}
        complaint={complaint}
        supabase={supabase}
      />
    </div>
  );
}

function AuditRow({ entry }) {
  const dotClass = entry.event_type === "archive"
    ? "bg-success"
    : entry.event_type === "resolved"
    ? "bg-[#17774e]"
    : entry.event_type === "rejected"
    ? "bg-critical"
    : "bg-jordy";
  return (
    <li className="relative pb-5">
      <span
        className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${dotClass}`}
        aria-hidden="true"
      />
      <p className="text-sm font-semibold text-navy">{formatAction(entry.action)}</p>
      <p className="mt-0.5 text-xs text-muted">
        {entry.profiles?.display_name || entry.actor_name || entry.author_name || "System"} ·{" "}
        {formatClock(entry.created_at || entry.timestamp)}
      </p>
      {entry.details ? (
        <span className="mt-1 block text-[11px] text-muted">{formatDetails(entry.details)}</span>
      ) : null}
      <p className="mt-0.5 text-xs text-muted">{entry.notes || entry.message || "—"}</p>
    </li>
  );
}

function formatClock(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDateShort(value)} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function formatAction(action) {
  if (!action) return "Case activity";
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetails(details) {
  try {
    if (typeof details === "string") return details;
    return Object.entries(details)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join(" · ");
  } catch {
    return "";
  }
}