"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Printer, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import {
  DOCUMENT_STATUS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  findReklamoBundle,
  formatDocumentDateTime,
  isOfficiallyReceived,
  pickDocument,
  signedCopyValidationError,
  SUBMISSION_RECEIPT_TYPE,
} from "@/lib/reklamo/reklamoDocument";
import { getDocumentSignedUrl, getResidentComplaintDocuments } from "@/repositories/complaintRepository";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";
import ReklamoFormPreview from "@/components/reklamo/ReklamoFormPreview";
import { requestSubmittedReklamo } from "@/lib/reklamo/requestSubmittedReklamo";
import {
  pushModalLayer,
  popModalLayer,
  isTopModalLayer,
  hasModalLayer,
} from "@/lib/modalLayer";

function StatusPill({ status }) {
  const tone =
    status === DOCUMENT_STATUS.SIGNED_AND_FILED
      ? "bg-success-soft text-success"
      : status === DOCUMENT_STATUS.OFFICIALLY_RECEIVED || status === DOCUMENT_STATUS.FOR_SIGNATURE
        ? "bg-info-soft text-secondary"
        : "bg-canvas text-muted";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
      {DOCUMENT_STATUS_LABELS[status] || "Pending review"}
    </span>
  );
}

function DocumentRow({ doc, onOpen, busy }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-alt" aria-hidden="true">
          <FileText className="h-5 w-5 text-secondary" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-mirage">
            {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.title || "Document"}
          </p>
          <p className="text-[12px] text-muted">
            {DOCUMENT_STATUS_LABELS[doc.document_status] || "Pending review"}
            {doc.generated_at ? ` · ${formatDocumentDateTime(doc.generated_at)}` : ""}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onOpen(doc)}
        disabled={busy}
        className="inline-flex min-h-[36px] shrink-0 items-center justify-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-4 text-[12.5px] font-semibold text-secondary transition-colors hover:border-secondary hover:bg-info-soft disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
        View
      </button>
    </li>
  );
}

export default function ReklamoDocumentCard({ complaint }) {
  const { viewDocument } = useDocumentViewer();
  const [documents, setDocuments] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const previewPanelRef = useRef(null);
  const autoAttemptRef = useRef(false);
  const layerRef = useRef(null);
  if (layerRef.current === null) layerRef.current = {};

  const received = isOfficiallyReceived(complaint);
  const bundle = findReklamoBundle(documents);
  const receipt = pickDocument(documents, SUBMISSION_RECEIPT_TYPE);
  const loading = documents === null;

  useEffect(() => {
    let cancelled = false;
    getResidentComplaintDocuments(complaint.id).then((rows) => {
      if (!cancelled) setDocuments(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [complaint.id, reload]);

  // The first Reklamo Form is automatic: the moment the card loads with no
  // submitted form on file, it asks the trusted server route to prepare one
  // (the resident browser never touches the private master template). The
  // route is idempotent, so a rerun after a network drop cannot stack a v2.
  const runAutoGeneration = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setGenerationFailed(false);
    const result = await requestSubmittedReklamo({ complaintId: complaint.id });
    setGenerating(false);
    if (result.success) {
      toast.success("Your Reklamo Form is ready.");
      setReload((n) => n + 1);
    } else {
      console.warn("Reklamo auto-generation failed", result.code, result.error);
      setGenerationFailed(true);
      toast.error(result.error || "Could not prepare the Reklamo Form.", { duration: 9000 });
    }
  }, [complaint.id, generating]);

  useEffect(() => {
    if (!previewDoc) return undefined;
    const token = layerRef.current;
    const panel = previewPanelRef.current;
    const previouslyFocused = document.activeElement;

    pushModalLayer(token);
    panel?.focus();

    const handleKeyDown = (event) => {
      if (!isTopModalLayer(token)) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPreviewDoc(null);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      popModalLayer(token);
      if (
        !hasModalLayer() &&
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, [previewDoc]);

  useEffect(() => {
    if (documents === null) return;
    if (received) return;
    if (findReklamoBundle(documents)) return;
    if (autoAttemptRef.current) return;
    autoAttemptRef.current = true;
    runAutoGeneration();
  }, [documents, received, runAutoGeneration]);

  // Opens the document in the in-app viewer. The resident is shown the file
  // on screen; downloading stays available inside that dialog.
  const handleOpen = useCallback(async (doc) => {
    if (!doc?.storage_path) {
      toast.error("This document is not available to view yet.");
      return;
    }
    setBusyId(doc.id);
    const { url, error } = await getDocumentSignedUrl(doc.storage_path);
    setBusyId(null);
    if (error || !url) {
      toast.error(error || "Could not open this document.");
      return;
    }
    viewDocument({
      url,
      title: DOCUMENT_TYPE_LABELS[doc.document_type] || doc.title || "Document",
      subtitle: doc.filename || null,
      filename: doc.filename || null,
      mime: doc.mime_type || null,
    });
  }, [viewDocument]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // documents is null until the fetch resolves, so this must tolerate null
  // even though the list below only renders once loading is false.
  const openCount = documents?.length ?? 0;

  return (
    <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Documents &amp; Forms</h2>
        {previewDoc ? (
          <button
            type="button"
            onClick={handlePrint}
            className="no-print inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-4 text-[12.5px] font-semibold text-secondary transition-colors hover:border-secondary hover:bg-info-soft"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            Print
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-canvas px-3.5 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Tracking Number</span>
          <p className="mt-0.5 text-sm font-bold text-mirage">{complaint.reference_number || "—"}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">Issued when you submitted online</p>
        </div>
        <div className="rounded-xl border border-line bg-canvas px-3.5 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Barangay Case No.</span>
          <p className="mt-0.5 text-sm font-bold text-mirage">{complaint.barangay_case_number || "Not yet assigned"}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {received
              ? `Received ${formatDocumentDateTime(complaint.official_received_at)}`
              : "Assigned only after the barangay officially receives your complaint"}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted">Loading your documents…</p>
      ) : documents && openCount > 0 ? (
        <ul className="mt-4 divide-y divide-line/70 rounded-xl border border-line/50 bg-canvas">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onOpen={handleOpen} busy={busyId === doc.id} />
          ))}
        </ul>
      ) : !received ? (
        <div className="mt-4 flex flex-col items-start gap-2">
          {generating ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-secondary" aria-hidden="true" />
              Preparing your Reklamo Form...
            </p>
          ) : generationFailed ? (
            <>
              <p className="text-sm text-muted">
                Your complaint was submitted successfully, but the Reklamo Form could not be
                prepared right now.
              </p>
              <button
                type="button"
                onClick={() => {
                  autoAttemptRef.current = false;
                  runAutoGeneration();
                }}
                className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-4 text-[12.5px] font-semibold text-secondary transition-colors hover:border-secondary hover:bg-info-soft"
              >
                Try Again
              </button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-secondary" aria-hidden="true" />
              Preparing your Reklamo Form...
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">No documents yet.</p>
      )}

      {receipt ? (
        <button
          type="button"
          onClick={() => setPreviewDoc(receipt)}
          className="no-print mt-4 text-[12.5px] font-semibold text-secondary underline underline-offset-2"
        >
          Preview submission copy
        </button>
      ) : null}

      {bundle ? (
        <p className="no-print mt-3 text-[12px] text-muted">
          {bundle.form.document_status === DOCUMENT_STATUS.PENDING_REVIEW
            ? "Your submitted Reklamo Form is pending barangay review."
            : `Your Reklamo Form is ${DOCUMENT_STATUS_LABELS[bundle.form.document_status]?.toLowerCase()} on file.`}
          {bundle.signed
            ? " The signed copy is on file too."
            : bundle.form.document_status === DOCUMENT_STATUS.PENDING_REVIEW
              ? ""
              : " A wet signature is still required at the barangay hall."}
        </p>
      ) : received ? (
        <p className="no-print mt-3 flex items-start gap-1.5 text-[12px] text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
          The official Reklamo Form is being prepared. It will appear here once the barangay releases it.
        </p>
      ) : null}

      {previewDoc ? (
        <div className="reklamo-print-host no-print fixed inset-0 z-[90] overflow-y-auto bg-black/40 px-3 py-6 sm:px-6" ref={previewPanelRef} role="dialog" aria-modal="true" aria-label="Reklamo form preview" tabIndex={-1} onClick={(e) => { if (e.target === e.currentTarget) setPreviewDoc(null); }}>
          <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Reklamo Form Preview</p>
            <button
              type="button"
              onClick={() => setPreviewDoc(null)}
              className="inline-flex min-h-[36px] items-center rounded-full bg-white px-4 text-[12.5px] font-semibold text-mirage"
            >
              Close
            </button>
          </div>
          <div className="mx-auto max-w-[210mm] pb-10">
            <ReklamoFormPreview
              inputs={{
                complaint,
                complainant: {
                  name: complaint.complainant_name,
                  contact: complaint.complainant_contact,
                  address: complaint.complainant_address,
                },
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
