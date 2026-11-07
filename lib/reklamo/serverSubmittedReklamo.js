import { createAdminClient } from "@/lib/supabase/admin";
import { DOCX_MIME } from "@/lib/documents/docxTemplate";
import {
  buildReklamoFormModel,
  renderReklamoFormDocx,
  REKLAMO_RENDER_INVALID_XML_TEXT,
} from "@/lib/reklamo/reklamoForm";
import {
  complaintStoragePath,
  DOCUMENT_STATUS,
  isOfficiallyReceived,
  nextReklamoVersion,
  REKLAMO_FORM_TYPE,
  REKLAMO_SUBMITTED_TITLE,
  reklamoDocxFileIdentifier,
  reklamoFolder,
  reklamoFormDocxFileName,
} from "@/lib/reklamo/reklamoDocument";
import {
  resolveDocumentComplainantAddressLine1,
  resolveDocumentComplainantAddressLine2,
  resolveDocumentComplainantName,
  resolveDocumentRespondentAddressLine1,
  resolveDocumentRespondentName,
} from "@/components/captain/complaints/complaintMeta";

/**
 * Error categories for the trusted generation route. The browser only ever
 * sees a generic message; the real cause is logged server-side.
 */
export const REKLAMO_GENERATION_CODES = {
  SERVER_GENERATOR_NOT_CONFIGURED: "SERVER_GENERATOR_NOT_CONFIGURED",
  COMPLAINT_READ_FAILED: "COMPLAINT_READ_FAILED",
  DOCUMENT_RENDER_FAILED: "DOCUMENT_RENDER_FAILED",
  RENDER_INVALID_XML_TEXT: "REKLAMO_RENDER_INVALID_XML_TEXT",
  DOCUMENT_UPLOAD_FAILED: "DOCUMENT_UPLOAD_FAILED",
  DOCUMENT_RECORD_FAILED: "DOCUMENT_RECORD_FAILED",
};

/**
 * The resident-submitted Reklamo Form v1 (DOCX) for one complaint, generated
 * on the server with the programmatic form builder (no template is involved).
 *
 * This is a trusted path:
 *   1. the route handler has already verified the resident session owns the
 *      complaint (`complaints.resident_id` = the signed-in user),
 *   2. the DOCX is built in memory from the complaint row - no master template
 *      or private bucket read is ever needed,
 *   3. the generated DOCX is written to the private `documents` bucket and
 *      recorded in `official_documents` + `document_lifecycle_events` with an
 *      activity audit entry.
 *
 * Idempotent: rerunning it for a complaint whose submitted v1 already exists
 * is a no-op (returns `already: true`), so an automatic system retry can never
 * stack a second version of the same form. It never fails the submission -
 * callers treat any non-success result as "document pending / recoverable".
 *
 * @param {object} input
 * @param {string} input.complaintId
 * @param {string} [input.residentId] signed-in resident, recorded as generator
 */
export async function generateSubmittedReklamo({ complaintId, residentId }) {
  // The service-role client owns every write in the pipeline. If it cannot be
  // built, that is a configuration gap (SUPABASE_SERVICE_ROLE_KEY not in the
  // server env), NOT a document problem - it gets its own category.
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    const reason = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? "SUPABASE_SERVICE_ROLE_KEY and/or NEXT_PUBLIC_SUPABASE_URL is not readable in this process"
      : "SUPABASE_SERVICE_ROLE_KEY is missing from the server environment";
    console.error("[reklamo] server generator is not configured", {
      complaintId,
      reason,
      message: error?.message,
    });
    return {
      success: false,
      code: REKLAMO_GENERATION_CODES.SERVER_GENERATOR_NOT_CONFIGURED,
      message: "Document generation is not configured on this server.",
    };
  }

  // ── Complaint data ───────────────────────────────────────────────
  // Loaded with the embed the rest of the app uses, so the printed name and
  // address resolve exactly as the case file shows them (display name →
  // resident profile → submitted snapshot).
  const { data: complaint, error: fetchError } = await admin
    .from("complaints")
    .select(
      "*, profiles!complaints_resident_id_fkey(display_name, resident_profiles(first_name, middle_name, last_name, suffix, house_street, purok, barangay, city))"
    )
    .eq("id", complaintId)
    .maybeSingle();

  if (fetchError || !complaint) {
    console.error("[reklamo] complaint could not be read", complaintId, fetchError?.message);
    return {
      success: false,
      code: REKLAMO_GENERATION_CODES.COMPLAINT_READ_FAILED,
      message: "The complaint could not be read.",
    };
  }
  if (residentId && complaint.resident_id !== residentId) {
    console.error("[reklamo] ownership mismatch", complaintId, residentId);
    return { success: false, code: "NOT_OWNER", message: "Complaint not found." };
  }

  // Once the barangay has officially received the case, the printed official
  // form is the record; nothing more is generated for the resident here.
  if (isOfficiallyReceived(complaint)) {
    return { success: true, already: true, version: null, official: true };
  }

  const { data: documents, error: docsError } = await admin
    .from("official_documents")
    .select("id, document_type, document_status, version")
    .eq("complaint_id", complaintId)
    .eq("document_type", REKLAMO_FORM_TYPE);
  if (docsError) {
    console.error("[reklamo] documents could not be read", complaintId, docsError.message);
    return {
      success: false,
      code: REKLAMO_GENERATION_CODES.DOCUMENT_RECORD_FAILED,
      message: "The Reklamo Form could not be recorded.",
    };
  }

  const alreadySubmitted = (documents || []).find(
    (doc) => doc.document_status === DOCUMENT_STATUS.PENDING_REVIEW
  );
  if (alreadySubmitted) {
    // The submitted copy is ONE document per complaint. A success page or
    // complaint view that retries/refetches must get that same copy back, not
    // a freshly counted next version - otherwise every page load would stack
    // a duplicate v2, v3, ... until the complaint is officially received.
    return {
      success: true,
      already: true,
      version: Number(alreadySubmitted.version) || 1,
    };
  }

  const version = nextReklamoVersion(documents || []);

  // ── Render (programmatic, no template) ──────────────────────────
  let model;
  let blob;
  try {
    model = buildReklamoFormModel({
      complaint,
      complainantName: resolveDocumentComplainantName(complaint),
      complainantAddressLine1: resolveDocumentComplainantAddressLine1(complaint),
      complainantAddressLine2: resolveDocumentComplainantAddressLine2(complaint),
      respondentName: resolveDocumentRespondentName(complaint, {
        includePersonsInvolved: true,
      }),
      respondentAddressLine1: resolveDocumentRespondentAddressLine1(complaint),
      respondentAddressLine2: "",
      // The complaint narrative verbatim.
      narrative: complaint.description,
      now: new Date(),
      // The submitted form prints the EMPTY case-number blank: no Barangay
      // Case Number has been assigned yet. Only the official case number may
      // ever print there (never the reference number).
      requireCaseNumber: false,
    });
    blob = await renderReklamoFormDocx(model);
  } catch (error) {
    console.error("[reklamo] form render failed", complaintId, error?.message, error?.details);
    return {
      success: false,
      code:
        error?.code === REKLAMO_RENDER_INVALID_XML_TEXT
          ? REKLAMO_GENERATION_CODES.RENDER_INVALID_XML_TEXT
          : REKLAMO_GENERATION_CODES.DOCUMENT_RENDER_FAILED,
      message: "The Reklamo Form could not be prepared.",
      details: error?.code ? { code: error.code } : undefined,
    };
  }

  // ── Storage ──────────────────────────────────────────────────────
  // The reference number may label the FILE (there is nothing else to tell
  // the form apart before the case is numbered) but is never printed.
  const identifier = reklamoDocxFileIdentifier(complaint);
  const filename = reklamoFormDocxFileName(identifier, version);
  const storagePath = complaintStoragePath(complaint.id, reklamoFolder(), filename);

  const { error: uploadError } = await admin.storage
    .from("documents")
    .upload(storagePath, blob, { contentType: DOCX_MIME, upsert: true });
  if (uploadError) {
    console.error("[reklamo] document upload failed", {
      complaintId,
      storagePath,
      message: uploadError.message,
    });
    return {
      success: false,
      code: REKLAMO_GENERATION_CODES.DOCUMENT_UPLOAD_FAILED,
      message: "The Reklamo Form could not be saved.",
    };
  }

  const generatedAt = new Date().toISOString();
  const { data: inserted, error: insertError } = await admin
    .from("official_documents")
    .insert({
      complaint_id: complaint.id,
      document_type: REKLAMO_FORM_TYPE,
      document_status: DOCUMENT_STATUS.PENDING_REVIEW,
      title: REKLAMO_SUBMITTED_TITLE,
      filename,
      storage_path: storagePath,
      mime_type: DOCX_MIME,
      file_size: blob.size,
      visibility: "resident_visible",
      status: "active",
      version,
      generated_at: generatedAt,
      generated_by: residentId || null,
      content_snapshot: {
        // Exactly what this version printed, with the stage marker so the case
        // file can tell the resident-submitted form from the official one.
        ...model,
        stage: "submitted",
        generator: "programmatic",
      },
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    // Nothing in the case file points at the uploaded file, so take it back
    // out of the bucket rather than leaving it unreferenced.
    await admin.storage.from("documents").remove([storagePath]).catch(() => {});
    console.error("[reklamo] document row insert failed", {
      complaintId,
      storagePath,
      message: insertError?.message,
    });
    return {
      success: false,
      code: REKLAMO_GENERATION_CODES.DOCUMENT_RECORD_FAILED,
      message: "The Reklamo Form could not be recorded.",
    };
  }

  // ── Lifecycle + audit ────────────────────────────────────────────
  // Note: postgrest-js builders expose only `then`, not `catch`/`finally`.
  try {
    await admin
      .from("document_lifecycle_events")
      .insert({
        document_id: inserted.id,
        complaint_id: complaint.id,
        event_type: "prepared",
        actor_id: residentId || null,
        notes: `Reklamo Form v${version} generated programmatically from the complaint row.`,
      });
  } catch (error) {
    console.warn("[reklamo] lifecycle event failed", complaintId, error?.message);
  }

  try {
    await admin
      .rpc("log_activity", {
        p_action: "reklamo_form_generated",
        p_target_type: "complaint",
        p_target_id: complaint.id,
        p_entity_ref: complaint.barangay_case_number || null,
        p_details: {
          version,
          document_type: REKLAMO_FORM_TYPE,
          stage: "submitted",
          automatic: true,
          generator: "programmatic",
        },
        p_old_values: null,
        p_new_values: null,
      });
  } catch (error) {
    console.warn("[reklamo] activity log failed", complaintId, error?.message);
  }

  return {
    success: true,
    version,
    already: false,
    filename,
    storage_path: storagePath,
  };
}