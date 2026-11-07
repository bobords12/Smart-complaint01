"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Download, Eye, FileText, Lock, Upload } from "lucide-react";
import Panel from "./Panel";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity } from "@/lib/complaintQueries";
// The same generator the mediation schedule runs after a save, so both
// call sites produce one identical document. See lib/hearing/mediationDocuments.js.
import { generateNoticeOfHearing } from "@/lib/hearing/mediationDocuments";
import ReklamoPanel from "./ReklamoPanel";
import { manilaToday, nextUpcomingHearing } from "@/lib/hearing/hearingSchedule";
import { formatDateTime } from "./complaintMeta";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";

const DOC_TYPES = ["hearing_notice", "summons", "agreement", "settlement", "boac", "certificate", "correspondence", "other"];
const DOC_TYPE_LABELS = {
  hearing_notice: "Notice of Hearing",
  // "summons" is kept labelled Summons on purpose: a case file opened before
  // the summons was retired holds a real Summons document, and relabelling
  // that row would make the label disagree with the file it names.
  summons: "Summons",
  agreement: "Agreement",
  settlement: "Settlement",
  boac: "Barangay Order of Arbitration",
  certificate: "Certificate",
  correspondence: "Correspondence",
  other: "Other",
};
const PROTECTED_TYPES = ["agreement", "settlement", "boac", "certificate"];
const PROTECTED_ACTIONS = ["authorized", "signed", "archived"];

export default function DocumentsTab({ supabase, user, complaint, documents = [], hearings = [], onChanged }) {
  const [showUpload, setShowUpload] = useState(false);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [statusDoc, setStatusDoc] = useState(null);
  const [statusAction, setStatusAction] = useState("authorized");
  const [statusSaving, setStatusSaving] = useState(false);
  const fileInputRef = useRef(null);
  const { viewDocument } = useDocumentViewer();

  // The notice must describe the hearing that still has to happen, so a
  // completed first hearing cannot be printed over a rescheduled second one.
  const noticeHearing = nextUpcomingHearing(hearings, { today: manilaToday() });

  const handleGenerateNotice = async () => {
    if (!noticeHearing) {
      toast.error("No hearing schedule has been saved for this case.");
      return;
    }
    setNoticeBusy(true);
    try {
      // One generator, shared with the mediation schedule section, so a
      // notice printed here and a notice prepared after a schedule is saved
      // are byte-for-byte the same document. See
      // lib/hearing/mediationDocuments.js.
      const result = await generateNoticeOfHearing(supabase, {
        complaint,
        user,
        hearing: noticeHearing,
        documents,
      });
      if (!result.success) {
        toast.error(result.error, { duration: 9000 });
        return;
      }
      toast.success("Notice of Hearing generated and stored.");
      onChanged();
    } finally {
      setNoticeBusy(false);
    }
  };

  const handleUpload = async (file, docType, title) => {
    if (!file) {
      toast.error("Choose a file.");
      return;
    }
    try {
      const storagePath = `complaints/${complaint.id}/upload-${new Date().getTime()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: docInsert, error: docError } = await supabase
        .from("official_documents")
        .insert({
          complaint_id: complaint.id,
          document_type: docType,
          title: title.trim() || file.name,
          filename: file.name,
          storage_path: storagePath,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
          visibility: "official",
          status: "active",
          uploaded_by: user?.id || null,
        })
        .select("id")
        .single();

      if (docError) {
        await supabase.storage.from("documents").remove([storagePath]);
        throw docError;
      }

      if (docInsert?.id) {
        await supabase.from("document_lifecycle_events").insert({
          document_id: docInsert.id,
          complaint_id: complaint.id,
          event_type: "uploaded",
          actor_id: user?.id || null,
          notes: "Document uploaded to the case file.",
        });
      }

      await logComplaintActivity(supabase, {
        action: "document_uploaded",
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: { title: title.trim() || file.name, type: docType },
      });

      toast.success("Document uploaded to the case file.");
      setShowUpload(false);
      onChanged();
    } catch {
      toast.error("Could not upload the document.");
    }
  };

  const handleSaveStatus = async () => {
    const doc = statusDoc;
    if (!doc) return;
    const protectedDoc = PROTECTED_TYPES.includes(doc.document_type);
    if (protectedDoc && PROTECTED_ACTIONS.includes(statusAction) && user?.role !== "captain") {
      toast.error("This protected document requires the Barangay Captain's approval.");
      return;
    }
    setStatusSaving(true);
    try {
      const { data: eventInsert, error } = await supabase
        .from("document_lifecycle_events")
        .insert({
          document_id: doc.id,
          complaint_id: complaint.id,
          event_type: statusAction,
          actor_id: user?.id || null,
          notes: `Marked ${statusAction} by ${user?.display_name || "official"}.`,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (!eventInsert?.id) {
        toast.error("Lifecycle tracking is not available yet. Confirm the case-viewer schema migration is applied.");
        return;
      }

      // "Released" is the Issued step of the document ladder: the same stored
      // PDF is handed to the complainant's Resident Account. Only the
      // `visibility` flag changes, so no second file is produced and the
      // document is not marked viewed. Service stays a separate record.
      if (statusAction === "released" && doc.visibility !== "resident_visible") {
        const { error: visibilityError } = await supabase
          .from("official_documents")
          .update({ visibility: "resident_visible" })
          .eq("id", doc.id)
          .eq("complaint_id", complaint.id);
        if (visibilityError) throw visibilityError;
      }

      await logComplaintActivity(supabase, {
        action: `document_${statusAction}`,
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: { title: doc.title, type: doc.document_type },
      });

      toast.success(`Document marked as ${statusAction}.`);
      setStatusDoc(null);
      setStatusAction("authorized");
      onChanged();
    } catch (caught) {
      const message = caught?.message || "Could not update the document status.";
      console.error("DocumentsTab: could not update document status", {
        documentId: doc.id,
        statusAction,
        error: caught,
      });
      toast.error(message, { duration: 9000 });
    } finally {
      setStatusSaving(false);
    }
  };

  /* ── Open a filed document ─────────────────────────────────────
   *
   * View hands the file to the shared in-app viewer, so an officer can
   * read a generated document without saving it first. Download stays a
   * separate, explicit save-to-disk action.
   */
  const viewDoc = (doc) => {
    if (!doc?.storage_path) {
      toast.error("This document has no stored file.");
      return;
    }
    viewDocument({
      supabase,
      bucket: "documents",
      storagePath: doc.storage_path,
      title: doc.title || "Document",
      subtitle: DOC_TYPE_LABELS[doc.document_type] || null,
      filename: doc.filename || null,
      mime: doc.mime_type || null,
    });
  };

  const downloadDocument = async (doc) => {
    if (!doc?.storage_path) {
      toast.error("This document has no stored file.");
      return;
    }
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 3600);
    if (error || !data?.signedUrl) {
      toast.error("Could not download this document.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const lifecycleByKey = Object.fromEntries(
    (documents || []).map((doc) => [doc.id, doc.document_lifecycle_events || []])
  );

  return (
    <div className="space-y-4">
      <ReklamoPanel
        supabase={supabase}
        user={user}
        complaint={complaint}
        documents={documents}
        onChanged={onChanged}
      />

      <Panel
        title="Documents"
        tag={`${documents.length} on file`}
        tagClass="bg-info-soft text-secondary"
        className="lg:col-span-2"
      >
        {documents.length === 0 ? (
          <p className="text-sm text-muted">
            No documents have been generated or filed for this case yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((doc) => {
              const protectedDoc = PROTECTED_TYPES.includes(doc.document_type);
              return (
                <div key={doc.id} className="rounded-xl border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-info-soft">
                      <FileText className="h-4 w-4 text-secondary" aria-hidden="true" />
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        protectedDoc ? "bg-gold-soft text-[#b04503]" : "bg-alt text-muted"
                      }`}
                    >
                      {DOC_TYPE_LABELS[doc.document_type] || doc.document_type}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm font-semibold text-navy" title={doc.title}>
                    {doc.title || doc.filename}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {doc.uploaded_at ? formatDateTime(doc.uploaded_at) : "—"}
                  </p>

                  <LifecycleChips events={lifecycleByKey[doc.id] || []} />

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <button
                      type="button"
                      onClick={() => viewDoc(doc)}
                      className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft"
                      title="View this document without downloading it"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" /> View
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadDocument(doc)}
                      className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-mirage transition-colors hover:bg-alt"
                      title="Download a copy to this device"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusAction("authorized");
                        setStatusDoc(doc);
                      }}
                      className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-jordy transition-colors hover:bg-secondary hover:text-white"
                    >
                      {protectedDoc && user?.role !== "captain" ? (
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : null}
                      Update Status
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted">
          Documents are not automatically marked as authorized, signed, served, or archived.
          Each state is recorded against the audit trail. Protected documents (agreements,
          settlements) require the Barangay Captain&apos;s approval.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerateNotice}
            disabled={noticeBusy || !noticeHearing}
            title={
              noticeHearing
                ? `Prints the official master template for the hearing on ${noticeHearing.hearing_date}`
                : "No hearing schedule has been saved for this case."
            }
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-50"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {noticeBusy ? "Generating…" : "Generate Notice"}
          </button>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-jordy px-5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload Document
          </button>
        </div>
      </div>

      <UploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onSave={handleUpload}
        fileInputRef={fileInputRef}
      />

      <StatusModal
        open={statusDoc !== null}
        onClose={() => setStatusDoc(null)}
        doc={statusDoc}
        action={statusAction}
        setAction={setStatusAction}
        saving={statusSaving}
        onSave={handleSaveStatus}
        isCaptain={user?.role === "captain"}
      />
    </div>
  );
}

const STATUS_ACTIONS = [
  { value: "authorized", label: "Authorized", hint: "Approved for use in the case." },
  { value: "signed", label: "Signed", hint: "Executed by the parties." },
  { value: "served", label: "Served", hint: "Delivered to the addressee." },
  {
    value: "released",
    label: "Released to complainant",
    hint: "Issued. The same official document becomes readable in the complainant's Resident Account. Service is recorded separately.",
  },
  { value: "archived", label: "Archived", hint: "Filed into the permanent record." },
  { value: "rejected", label: "Rejected", hint: "Returned or not approved." },
];

function StatusModal({ open, onClose, doc, action, setAction, saving, onSave, isCaptain }) {
  const protectedDoc = PROTECTED_TYPES.includes(doc?.document_type);
  return (
    <ResidentModal
      open={open}
      onClose={onClose}
      labelledBy="doc-status-title"
      title={`Update status — ${doc?.title || "Document"}`}
      maxWidthClass="max-w-md"
    >
      <div className="space-y-3 text-sm">
        {protectedDoc && !isCaptain ? (
          <p className="rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold text-warning">
            Protected document: authorization, signing, and archiving require the Barangay
            Captain&apos;s approval. Only served/rejected are available to you.
          </p>
        ) : null}
        {STATUS_ACTIONS.filter(
          (a) => !protectedDoc || isCaptain || a.value === "served" || a.value === "rejected"
        ).map((a) => (
          <label
            key={a.value}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
              action === a.value ? "border-secondary bg-info-soft" : "border-line hover:border-secondary/40"
            }`}
          >
            <input
              type="radio"
              name="doc-status"
              value={a.value}
              checked={action === a.value}
              onChange={() => setAction(a.value)}
              className="mt-1 accent-[#1b4c8c]"
            />
            <span>
              <span className="block text-sm font-semibold capitalize text-navy">{a.label}</span>
              <span className="block text-xs text-muted">{a.hint}</span>
            </span>
          </label>
        ))}
        <div className="flex justify-end pt-2">
          <LoadingButton isLoading={saving} onClick={onSave}>
            Save Status
          </LoadingButton>
        </div>
      </div>
    </ResidentModal>
  );
}

function LifecycleChips({ events }) {
  const latest = events[0];
  if (!latest) {
    return <p className="mt-2 text-[11px] text-muted">Prepared — no status events yet</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {events.slice(0, 3).map((ev) => (
        <span
          key={ev.id}
          className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold capitalize text-mirage"
        >
          {ev.event_type}
        </span>
      ))}
    </div>
  );
}

function UploadModal({ open, onClose, onSave, fileInputRef }) {
  const [docType, setDocType] = useState("correspondence");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!file) {
      toast.error("Choose a file to upload.");
      return;
    }
    setSaving(true);
    try {
      await onSave(file, docType, title);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResidentModal
      open={open}
      onClose={onClose}
      labelledBy="upload-doc-title"
      title="Upload Document"
      maxWidthClass="max-w-md"
    >
      <div className="space-y-4 text-sm">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Document type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short title (optional)"
            className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">File</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.png,.jpg"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-info-soft file:px-4 file:py-2 file:text-xs file:font-semibold file:text-secondary"
          />
        </div>
        <div className="flex justify-end pt-2">
          <LoadingButton isLoading={saving} onClick={handleSave}>
            Upload
          </LoadingButton>
        </div>
      </div>
    </ResidentModal>
  );
}