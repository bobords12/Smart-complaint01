/**
 * Preparation of the hearing documents for the mediation schedule.
 *
 * WHY THIS FILE EXISTS
 *   The Captain portal used to offer exactly one document generator, the
 *   Notice of Hearing, and it lived inside DocumentsTab as a component
 *   handler. Scheduling a mediation in the Summons / Mediation section had
 *   no way to prepare the same document, so the two views disagreed about
 *   what a saved schedule produced. This module holds that generator once,
 *   as plain data-layer code, so both call sites run the identical path:
 *   same master template, same field map, same version rule, same storage
 *   key, same `official_documents` row, same lifecycle event, same audit
 *   entry.
 *
 * ONE NOTICE PER HEARING
 *   There is a single Notice of Hearing per hearing, addressed to the
 *   complainant: it prints the complainant's name and address above the
 *   "Complainant/s" line, states the hearing the barangay has scheduled,
 *   and is signed by the Barangay Secretary. It is stored
 *   `resident_visible` so the complainant can open the very same file from
 *   the resident portal — the barangay and the complainant are never
 *   looking at two different renderings of the same hearing.
 *
 *   The respondent is served by the Summons, which is a separate document
 *   with its own addressee. generateRespondentSummons() is kept so case
 *   files that already hold a summons document stay verifiable; nothing in
 *   the Captain portal calls it any more.
 *
 * NOTHING IS FAKED
 *   Only a document the application can actually produce is written.
 *   Preparing a document writes the `official_documents` row and nothing
 *   else — no issuance, no service and no acknowledgement, because those
 *   are separate acts recorded elsewhere.
 *
 * NO MASTER TEMPLATE FOR THE NOTICE
 *   The Notice is built directly from the saved hearing data (see
 *   noticeOfHearingProgrammatic.js). The Word master sitting in the
 *   `templates` bucket is an older revision of the printed form, so filling
 *   it would file a document that no longer matches the paper the barangay
 *   hands out. The Respondent Summons still renders from its master.
 *
 * NO SILENT OVERWRITE
 *   Version numbers come from nextDocumentVersion(), and the upload runs
 *   with `upsert: false`, so a document that already exists is never
 *   replaced by a later print. Regeneration is only offered when no active
 *   document of that type exists yet.
 */

import { logComplaintActivity } from "@/lib/complaintQueries";
import {
  caseDocumentFileName,
  caseDocumentStoragePath,
  DOCX_MIME,
  fetchMasterTemplate,
  MASTER_TEMPLATES,
  nextDocumentVersion,
  renderDocx,
  TemplateRenderError,
} from "@/lib/documents/docxTemplate";
import {
  buildRespondentSummonsData,
  respondentSummonsFields,
  SUMMONS_MASTER_LABEL,
} from "@/lib/hearing/respondentSummonsDocx";
import { RESPONDENT_SUMMONS_TEMPLATE_NOTE } from "@/lib/hearing/summonsTemplate";
import { generateNoticeOfHearingProgrammatic } from "@/lib/hearing/noticeOfHearingProgrammatic";
import {
  resolveComplainantName,
  resolveRespondentAddress,
  resolveRespondentName,
} from "@/components/captain/complaints/complaintMeta";

/**
 * The one message shown to an officer when a document cannot be produced
 * because its master template is not configured. The technical reason is
 * kept separately for a "View Details" disclosure; it is never the status.
 */
export const TEMPLATE_UNAVAILABLE_MESSAGE =
  "Document generation unavailable. The required barangay template is not configured.";

/** True when a Respondent Summons master is registered for this portal. */
export function hasRespondentSummonsTemplate() {
  return Boolean(MASTER_TEMPLATES.summons);
}

/**
 * Informational only — not an availability gate.
 *
 * There is deliberately no hearingNoticeGenerationAvailable() alongside the
 * summons one. When the `hearing_notice` master cannot be read, or its layout
 * no longer matches the field map, generateNoticeOfHearing() falls through to
 * the programmatic generator, which builds the same document from the saved
 * hearing data and needs no master at all. A standing "can we make it?" flag
 * would therefore always read yes and would only invite the UI to trust it
 * over the generator. Whether a document could actually be produced is known
 * at the moment it is asked for, and is reported then.
 */
export const HEARING_NOTICE_TEMPLATE_STATUS = "READY";

export const HEARING_NOTICE_TEMPLATE_NOTE =
  "The Notice of Hearing is generated from the barangay's official notice form: " +
  "it carries the letterhead, names the complainant with their address above the " +
  "Complainant/s line, states the scheduled hearing, and closes with the Barangay " +
  "Secretary's block and the Received by / O.R No. / Doc. Stamp lines. The " +
  "respondent is served separately by the Summons.";

/** A failure raised while reading or rendering a master template. */
function isTemplateProblem(error) {
  return (
    error instanceof TemplateRenderError || error?.name === "TemplateRenderError"
  );
}

/**
 * Generate the Notice of Hearing for one saved hearing.
 *
 * Thin boundary: the document itself is built by
 * noticeOfHearingProgrammatic.js, which also owns the storage, versioning,
 * lifecycle event and audit entry. The caller still decides when to run it and
 * what to toast.
 *
 * @returns {Promise<{success: boolean, document?: object, error?: string,
 *                    detail?: string}>}
 */
export async function generateNoticeOfHearing(supabase, { complaint, user, hearing, documents = [] }) {
  if (!complaint?.id) {
    return { success: false, error: "This complaint could not be identified." };
  }
  if (!hearing) {
    return {
      success: false,
      error: "No hearing schedule has been saved for this case.",
    };
  }

  // The Notice is built from the saved hearing data rather than filled into a
  // Word master. The master sitting in the `templates` bucket is an older
  // revision of the printed form — it still opens with "To:" and addresses the
  // respondent — while the form the barangay hands out today is addressed to
  // the complainant and closes with the Barangay Secretary's block and the
  // Received by / O.R No. / Doc. Stamp lines. Filling the master would
  // therefore file a document that no longer matches the paper.
  //
  // Building it here also means there is no template to fetch, so a missing or
  // moved master can no longer block a hearing that is perfectly saveable.
  return generateNoticeOfHearingProgrammatic(supabase, {
    complaint,
    user,
    hearing,
    documents,
  });
}

/**
 * Generate the Respondent Summons for one saved hearing.
 *
 * Runs the same path as the Notice of Hearing: the registered `summons` master,
 * this portal's own field map, nextDocumentVersion(), upsert-stays-off, the
 * same `official_documents` row shape, the same lifecycle event and the same
 * audit entry. The row is filed under `document_type: "summons"`, which is what
 * the case file looks for when it reports the summons as generated.
 *
 * Preparing stops there. It does not insert a `summons` row, so no issuance,
 * service or acknowledgement is implied — "Issue Summons" in the case file is
 * what records the issuance, and service is recorded separately.
 *
 * @returns {Promise<{success: boolean, document?: object, error?: string,
 *                    detail?: string, templateUnavailable?: boolean}>}
 */
export async function generateRespondentSummons(
  supabase,
  { complaint, user, hearing, documents = [] }
) {
  if (!complaint?.id) {
    return { success: false, error: "This complaint could not be identified." };
  }
  if (!hearing) {
    return {
      success: false,
      error: "No hearing schedule has been saved for this case.",
    };
  }

  const respondent = resolveRespondentName(complaint);
  if (!respondent) {
    // A summons with a blank addressee is not a summons. The case file shows
    // "No respondent identified" for this same case, so the document is refused
    // rather than filed with an empty name on the To: line.
    return {
      success: false,
      error: "No respondent has been identified for this case, so the summons has no addressee.",
    };
  }

  try {
    const { bytes, file: masterFile } = await fetchMasterTemplate(supabase, "summons");

    const data = buildRespondentSummonsData({
      complaint,
      complainant: resolveComplainantName(complaint),
      respondent,
      respondentAddress: resolveRespondentAddress(complaint),
      hearing,
      officialProfile: user,
    });

    const blob = renderDocx(bytes, respondentSummonsFields(), data);
    const version = nextDocumentVersion(documents, "summons");
    const filename = caseDocumentFileName(complaint, `${SUMMONS_MASTER_LABEL}-v${version}`);
    const storagePath = caseDocumentStoragePath(complaint, `${SUMMONS_MASTER_LABEL}-v${version}`);

    // upsert stays off: a version that already exists is a real document that
    // somebody may already be holding, so it is never silently replaced.
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, blob, { contentType: DOCX_MIME, upsert: false });
    if (uploadError) throw uploadError;

    const { data: docInsert, error: docError } = await supabase
      .from("official_documents")
      .insert({
        complaint_id: complaint.id,
        document_type: "summons",
        title: `Respondent Summons — ${data.respondent}`,
        filename,
        storage_path: storagePath,
        mime_type: DOCX_MIME,
        file_size: blob.size,
        visibility: "official",
        status: "active",
        version,
        generated_at: new Date().toISOString(),
        generated_by: user?.id || null,
        // The exact values that were printed, so the case file can be checked
        // against the stored document later without opening it.
        content_snapshot: {
          master_template: masterFile,
          case_number: data.caseNumber,
          hearing_id: hearing.id,
          hearing_date: hearing.hearing_date,
          hearing_time: hearing.hearing_time,
          hearing_venue: hearing.venue,
          complainant: data.complainant,
          respondent: data.respondent,
          respondent_address: data.respondentAddress,
          issued_on: `${data.issueDay} ${data.issueMonth} ${data.issueYear}`,
          signed_by: data.officialName,
          signatory_title: data.officialTitle,
        },
        uploaded_by: user?.id || null,
      })
      .select("id")
      .single();

    if (docError) {
      // The file is in the bucket but nothing in the case file points at it.
      // Remove it so a failed print cannot leave an unreferenced document
      // sitting in the case folder.
      await supabase.storage.from("documents").remove([storagePath]);
      throw docError;
    }

    if (docInsert?.id) {
      await supabase.from("document_lifecycle_events").insert({
        document_id: docInsert.id,
        complaint_id: complaint.id,
        event_type: "prepared",
        actor_id: user?.id || null,
        notes: `Respondent Summons generated from ${masterFile} for the hearing of ${hearing.hearing_date}.`,
      });
    }

    // Best-effort audit entry: the document is stored either way.
    await logComplaintActivity(supabase, {
      action: "respondent_summons_generated",
      complaintId: complaint.id,
      ref: complaint.reference_number || undefined,
      details: {
        title: `Respondent Summons — ${data.respondent}`,
        master_template: masterFile,
        hearing_id: hearing.id,
      },
    });

    return { success: true, document: docInsert || null };
  } catch (caught) {
    console.error("mediationDocuments: could not generate Respondent Summons", {
      complaintId: complaint?.id,
      hearingId: hearing?.id,
      error: caught,
    });
    if (isTemplateProblem(caught)) {
      // Unlike the Notice, there is no second way to build a summons: the
      // printed form is the point. Report the missing template honestly
      // instead of filing some other artefact under `summons`.
      return {
        success: false,
        templateUnavailable: true,
        error: TEMPLATE_UNAVAILABLE_MESSAGE,
        detail: caught?.message || RESPONDENT_SUMMONS_TEMPLATE_NOTE,
      };
    }
    return {
      success: false,
      templateUnavailable: false,
      error: caught?.message || "Could not generate the summons.",
      detail: caught?.message || null,
    };
  }
}

/**
 * Prepare the hearing documents after a mediation schedule is saved.
 *
 * This is the boundary the schedule-save handler calls. It:
 *   1. reads the hearing that was just saved,
 *   2. generates the Notice of Hearing when the case has none yet,
 *   3. leaves the Respondent Summons alone — it is prepared deliberately from
 *      the case file, because preparing it is what puts a summons in front of
 *      an officer to be issued and served, not a side effect of scheduling,
 *
 * and it never creates, replaces or deletes a document on its own beyond
 * step 2. Rescheduling therefore cannot overwrite a notice that a party
 * already holds: a new version is only produced when no active notice
 * exists, and the manual regenerate button in Documents is where a second
 * version is printed on purpose.
 *
 * @returns {Promise<{hearing: object|null, notice: object, summons: object}>}
 */
export async function prepareMediationDocuments(supabase, { complaint, user, hearingId }) {
  // Not attempted here on purpose, and never reported as an error: the summons
  // is produced by generateRespondentSummons() from the Prepare Summons action.
  const summons = { success: false, skipped: true };

  if (!complaint?.id || !hearingId) {
    return {
      hearing: null,
      notice: {
        success: false,
        error: "No hearing schedule has been saved for this case.",
      },
      summons,
    };
  }

  const { data: hearing, error: hearingError } = await supabase
    .from("hearings")
    .select("*")
    .eq("id", hearingId)
    .maybeSingle();

  if (hearingError || !hearing) {
    return {
      hearing: null,
      notice: {
        success: false,
        error: hearingError?.message || "The saved hearing could not be read back.",
      },
      summons,
    };
  }

  const { data: documentRows, error: documentsError } = await supabase
    .from("official_documents")
    .select("*")
    .eq("complaint_id", complaint.id);

  if (documentsError) {
    return {
      hearing,
      notice: {
        success: false,
        error: documentsError.message,
      },
      summons,
    };
  }

  const existingNotice =
    (documentRows || []).find(
      (d) => d.document_type === "hearing_notice" && d.status !== "superseded"
    ) || null;

  if (existingNotice) {
    return {
      hearing,
      notice: { success: true, skipped: true, document: existingNotice },
      summons,
    };
  }

  const notice = await generateNoticeOfHearing(supabase, {
    complaint,
    user,
    hearing,
    documents: documentRows || [],
  });

  return { hearing, notice, summons };
}
