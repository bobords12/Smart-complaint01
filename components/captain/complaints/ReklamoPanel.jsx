"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Eye, FileText, Lock, Upload } from "lucide-react";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity } from "@/lib/complaintQueries";
import {
  buildReklamoFieldModel,
  complaintStoragePath,
  DOCUMENT_STATUS,
  DOCUMENT_STATUS_LABELS,
  findReklamoBundle,
  formatDocumentDateTime,
  isOfficiallyReceived,
  nextReklamoVersion,
  pickDocument,
  REKLAMO_FORM_TYPE,
  reklamoFolder,
  reklamoFormDocxFileName,
  reklamoSnapshotFromModel,
  SIGNED_REKLAMO_TYPE,
  SUBMISSION_RECEIPT_TYPE,
  signedCopyValidationError,
} from "@/lib/reklamo/reklamoDocument";
import { DOCX_MIME } from "@/lib/documents/docxTemplate";
import {
  buildReklamoFormModel,
  renderReklamoFormDocx,
} from "@/lib/reklamo/reklamoForm";
import { officialSignatureFor } from "@/lib/documents/officialSignature";
import {
  resolveComplainantName,
  resolveDocumentComplainantAddressLine1,
  resolveDocumentComplainantAddressLine2,
  resolveDocumentComplainantName,
  resolveDocumentRespondentAddressLine1,
  resolveDocumentRespondentName,
} from "./complaintMeta";

const REKLAMO_TYPES = [REKLAMO_FORM_TYPE, SIGNED_REKLAMO_TYPE, SUBMISSION_RECEIPT_TYPE];

export default function ReklamoPanel({ supabase, user, complaint, documents = [], onChanged }) {
  const [generateBusy, setGenerateBusy] = useState(false);
  const [signedBusy, setSignedBusy] = useState(false);
  const signedInputRef = useRef(null);
  const { viewDocument } = useDocumentViewer();

  const received = isOfficiallyReceived(complaint);
  const caseNumber = complaint.barangay_case_number;
  const signature = officialSignatureFor(user);

  const reklamoDocs = useMemo(
    () => (documents || []).filter((doc) => REKLAMO_TYPES.includes(doc.document_type)),
    [documents]
  );
  const bundle = findReklamoBundle(reklamoDocs);
  const receipt = pickDocument(reklamoDocs, SUBMISSION_RECEIPT_TYPE);

  // The officially received form, if one is already on file. A regeneration
  // replaces it in place rather than stacking a second official version.
  const officialForm = (reklamoDocs || []).find(
    (doc) =>
      doc.document_type === REKLAMO_FORM_TYPE &&
      doc.document_status === DOCUMENT_STATUS.OFFICIALLY_RECEIVED
  );
  const hasOfficialForm = Boolean(officialForm);
  const hasPendingSubmittedForm =
    Boolean(bundle?.form) && bundle.form.document_status === DOCUMENT_STATUS.PENDING_REVIEW;

  // Field model for the submission copy and the filed signed copy, which are
  // PDFs rendered from the complaint row rather than from the DOCX master.
  const fieldInputs = useMemo(
    () => ({
      complaint: {
        reference_number: complaint.reference_number,
        barangay_case_number: complaint.barangay_case_number,
        official_received_at: complaint.official_received_at,
        description: complaint.description,
        incident_date: complaint.incident_date,
        incident_time: complaint.incident_time,
        incident_location: complaint.incident_location,
        persons_involved: complaint.persons_involved,
        witnesses: complaint.witnesses,
        desired_relief: complaint.desired_relief,
        official_category: complaint.official_category,
        official_urgency: complaint.official_urgency,
      },
      complainant: resolveComplainantName(complaint),
      officialProfile: user,
    }),
    [complaint, user]
  );

  // The placeholder values printed on the generated DOCX. Resolved for the
  // document specifically: a walk-in is read from their snapshot, and nothing
  // ever prints a dash where the barangay has not recorded a value.
  const documentInputs = useMemo(
    () => ({
      complainantName: resolveDocumentComplainantName(complaint),
      complainantAddressLine1: resolveDocumentComplainantAddressLine1(complaint),
      complainantAddressLine2: resolveDocumentComplainantAddressLine2(complaint),
      respondentName: resolveDocumentRespondentName(complaint),
      respondentAddressLine1: resolveDocumentRespondentAddressLine1(complaint),
      respondentAddressLine2: "",
      narrative: complaint.description,
    }),
    [complaint]
  );

  const handleGenerate = useCallback(async () => {
    if (!received || !caseNumber) {
      toast.error("Use the Receive action first. The form needs a Barangay Case Number.");
      return;
    }
    setGenerateBusy(true);
    try {
      // Regenerating replaces the already-filed official form IN PLACE: the
      // barangay re-prints the same numbered document (a new version number
      // would no longer match the version recorded as signed/filed). Only
      // when no official form exists yet is a fresh version created - after
      // the resident's submitted v1, that is v2.
      const version = hasOfficialForm
        ? Number(officialForm.version) || 1
        : nextReklamoVersion(reklamoDocs);
      const regenerating = hasOfficialForm;

      // The generated form is the barangay's own layout built programmatically
      // from the complaint row; no master template storage read is involved.
      const model = buildReklamoFormModel({
        complaint,
        ...documentInputs,
        now: new Date(),
      });
      const blob = await renderReklamoFormDocx(model);

      const filename = reklamoFormDocxFileName(caseNumber, version);
      const storagePath = complaintStoragePath(complaint.id, reklamoFolder(), filename);

      // A regenerated official form replaces its own file; a brand-new version
      // is a new file that must never clobber the form already handed out.
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, blob, { contentType: DOCX_MIME, upsert: regenerating });
      if (uploadError) throw uploadError;

      const contentSnapshot = {
        // Exactly what this version printed, so the case file can show what
        // was on the form without reopening the DOCX. No binary is stored.
        ...model,
        stage: "official",
        generator: "programmatic",
      };

      let formId = null;
      if (regenerating) {
        const { error: updateError } = await supabase
          .from("official_documents")
          .update({
            filename,
            storage_path: storagePath,
            mime_type: DOCX_MIME,
            file_size: blob.size,
            generated_at: new Date().toISOString(),
            generated_by: user?.id || null,
            content_snapshot: contentSnapshot,
          })
          .eq("id", officialForm.id)
          .select("id")
          .single();
        if (updateError) throw updateError;
        formId = officialForm.id;
      } else {
        const { data: inserted, error: rowError } = await supabase
          .from("official_documents")
          .insert({
            complaint_id: complaint.id,
            document_type: REKLAMO_FORM_TYPE,
            document_status: DOCUMENT_STATUS.OFFICIALLY_RECEIVED,
            title: "Reklamo Form — Officially Received",
            filename,
            storage_path: storagePath,
            mime_type: DOCX_MIME,
            file_size: blob.size,
            visibility: "resident_visible",
            version,
            generated_at: new Date().toISOString(),
            generated_by: user?.id || null,
            content_snapshot: contentSnapshot,
          })
          .select("id")
          .single();

        if (rowError) {
          // Nothing in the case file points at the uploaded file, so take it
          // back out of the bucket rather than leaving it unreferenced.
          await supabase.storage.from("documents").remove([storagePath]);
          throw rowError;
        }
        formId = inserted?.id;
      }

      if (formId) {
        await supabase.from("document_lifecycle_events").insert({
          document_id: formId,
          complaint_id: complaint.id,
          event_type: "prepared",
          actor_id: user?.id || null,
          notes: `Reklamo Form v${version} generated programmatically for Barangay Case No. ${caseNumber}.`,
        });
      }

      await logComplaintActivity(supabase, {
        action: "reklamo_form_generated",
        complaintId: complaint.id,
        ref: caseNumber,
        details: {
          version,
          document_type: REKLAMO_FORM_TYPE,
          stage: "official",
          generator: "programmatic",
        },
      });

      toast.success(
        regenerating
          ? `Reklamo Form v${version} regenerated.`
          : `Reklamo Form v${version} generated.`
      );
      onChanged?.();
    } catch (error) {
      console.error("ReklamoPanel: could not generate the Reklamo Form", {
        complaintId: complaint?.id,
        error,
      });
      toast.error(error?.message || "Could not generate the Reklamo Form.", { duration: 9000 });
    } finally {
      setGenerateBusy(false);
    }
  }, [received, caseNumber, documentInputs, reklamoDocs, hasOfficialForm, officialForm, supabase, complaint, user, onChanged]);

  const handleSignedUpload = useCallback(async (file) => {
    if (!file) return;
    const validationError = signedCopyValidationError(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (!received || !hasOfficialForm) {
      toast.error("Generate the official form before filing its signed copy.");
      return;
    }
    setSignedBusy(true);
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const storagePath = complaintStoragePath(
        complaint.id,
        "reklamo-signed",
        `v${bundle.version}-${Date.now()}-${safeName}`
      );

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const signedAt = new Date().toISOString();
      const { data: signedRow, error: rowError } = await supabase
        .from("official_documents")
        .insert({
          complaint_id: complaint.id,
          document_type: SIGNED_REKLAMO_TYPE,
          document_status: DOCUMENT_STATUS.SIGNED_AND_FILED,
          title: "Reklamo Form — Signed and Filed",
          filename: file.name,
          storage_path: storagePath,
          mime_type: file.type,
          file_size: file.size,
          visibility: "resident_visible",
          version: bundle.version,
          generated_at: signedAt,
          generated_by: user?.id || null,
          signed_at: signedAt,
          content_snapshot: reklamoSnapshotFromModel(buildReklamoFieldModel(fieldInputs)),
        })
        .select("id")
        .single();
      if (rowError) throw rowError;

      if (signedRow?.id) {
        await supabase.from("document_lifecycle_events").insert({
          document_id: signedRow.id,
          complaint_id: complaint.id,
          event_type: "signed",
          actor_id: user?.id || null,
          notes: `Signed copy of v${bundle.version} filed.`,
        });
      }

      await logComplaintActivity(supabase, {
        action: "reklamo_form_signed_copy_filed",
        complaintId: complaint.id,
        ref: caseNumber,
        details: { version: bundle.version, file_name: file.name, file_size: file.size },
      });

      toast.success("Signed Reklamo Form filed.");
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not file the signed copy.");
    } finally {
      setSignedBusy(false);
    }
  }, [received, hasOfficialForm, bundle, supabase, complaint, user, caseNumber, fieldInputs, onChanged]);

  // Opens the document that was actually filed, straight out of private storage.
  // The panel does not re-render a stand-in preview: what the barangay signs is
  // the stored master-template file, so that is what is shown here — in the
  // in-app viewer, so reading it no longer downloads the file.
  const openStoredDocument = useCallback(
    (doc) => {
      if (!doc?.storage_path) {
        toast.error("This document has no stored file.");
        return;
      }
      viewDocument({
        supabase,
        bucket: "documents",
        storagePath: doc.storage_path,
        title: doc.title || "Reklamo Form",
        subtitle: doc.document_type === "reklamo_form" ? "Reklamo Form" : null,
        filename: doc.filename || null,
        mime: doc.mime_type || null,
      });
    },
    [supabase, viewDocument]
  );

  return (
    <div className="rounded-xl border border-line bg-canvas p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-mirage">Reklamo Form</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            {received
              ? `Barangay Case No. ${caseNumber} · received ${formatDocumentDateTime(complaint.official_received_at)}`
              : "No Barangay Case Number yet"}
          </p>
        </div>
        <span className="rounded-full bg-white dark:bg-alt px-2.5 py-1 text-[11px] font-semibold text-muted">
          {bundle?.signed
            ? DOCUMENT_STATUS_LABELS[DOCUMENT_STATUS.SIGNED_AND_FILED]
            : bundle
              ? DOCUMENT_STATUS_LABELS[bundle.form.document_status] || "On file"
              : "Not generated"}
        </span>
      </div>

      {!received ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-white dark:bg-alt px-3 py-2.5 text-[12.5px] text-muted">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {hasPendingSubmittedForm
            ? `The resident's submitted Reklamo Form (v${bundle.version}) is on file pending review. The official form is generated only after the Receive action assigns the Barangay Case Number.`
            : "The official form is generated only after the Receive action assigns the Barangay Case Number."}
        </p>
      ) : null}

      {received ? (
        <p className="mt-3 text-[12px] text-muted">
          Received by{" "}
          <strong className="text-mirage">
            {complaint.received_by_name || complaint.received_by || "an authorized official"}
          </strong>{" "}
          on {formatDocumentDateTime(complaint.official_received_at)}.
        </p>
      ) : null}

      <div className="mt-4">
        <p className="mb-1.5 block text-[12.5px] font-semibold text-mirage">
          Signature over printed name
        </p>
        <p className="rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-mirage dark:bg-alt">
          {signature.name ? (
            <>
              <strong>{signature.name}</strong>
              {signature.title ? <span className="text-muted"> — {signature.title}</span> : null}
            </>
          ) : (
            <span className="text-muted">
              Taken from the signed-in official&apos;s profile. No profile name is available, so
              the printed block is left blank for the wet signature taken at the barangay hall.
            </span>
          )}
        </p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
          The form prints the authenticated official&apos;s own name and office title. Nothing is
          typed onto the document by hand.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <LoadingButton
          type="button"
          onClick={handleGenerate}
          disabled={!received || generateBusy || signedBusy}
          isLoading={generateBusy}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-secondary px-4 text-[12.5px] font-semibold text-white"
        >
          {!generateBusy ? <FileText className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {generateBusy
            ? "Generating…"
            : hasOfficialForm
              ? "Regenerate official form"
              : "Generate official form"}
        </LoadingButton>

        <button
          type="button"
          onClick={() => signedInputRef.current?.click()}
          disabled={!hasOfficialForm || signedBusy || generateBusy}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-4 text-[12.5px] font-semibold text-secondary disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          File signed copy
        </button>
        <input
          ref={signedInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          className="sr-only"
          onChange={(e) => {
            handleSignedUpload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {bundle?.form ? (
          <button
            type="button"
            onClick={() => openStoredDocument(bundle.form)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-4 text-[12.5px] font-semibold text-secondary"
            title="View the filed form without downloading it"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            View filed form
          </button>
        ) : null}

        {receipt ? (
          <button
            type="button"
            onClick={() => openStoredDocument(receipt)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-4 text-[12.5px] font-semibold text-secondary"
            title="View the resident's submission copy without downloading it"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            View submission copy
          </button>
        ) : null}
      </div>

      {bundle ? (
        <p className="mt-3 text-[12px] text-muted">
          Version {bundle.version}
          {bundle.signed
            ? ` · signed copy filed ${formatDocumentDateTime(bundle.signed.signed_at)}`
            : " · wet signature still outstanding at the barangay hall"}
        </p>
      ) : null}
    </div>
  );
}
