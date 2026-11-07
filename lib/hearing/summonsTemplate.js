/**
 * Respondent Summons is now generated from the barangay's own printed form.
 *
 * The summons master (Summons_Template.docx) is derived from the Notice of
 * Hearing master: it keeps the barangay letterhead table — every logo and the
 * watermark — and the "Received by / O.R No. / Doc. Stamp" footer byte-for-byte,
 * and replaces only the title and body with Katarungang Pambarangay summons
 * wording. It lives beside the other masters in the private `templates` bucket
 * at `masters/respondent-summons/Summons_Template.docx` and is registered under
 * `MASTER_TEMPLATES.summons`.
 *
 * Rendering is done by lib/hearing/mediationDocuments.js#generateRespondentSummons
 * using the field map in lib/hearing/respondentSummonsDocx.js. Nothing here
 * invents an issuance, service or acknowledgement: a summons row is written to
 * `official_documents` with `document_type: "summons"` only when the portal
 * actually renders the document, and the service/acknowledgement state is still
 * tracked separately by the case file.
 */

export const RESPONDENT_SUMMONS_TEMPLATE_STATUS = "READY";

export const RESPONDENT_SUMMONS_TEMPLATE_NOTE =
  "The Respondent Summons is generated from the barangay's printed summons form, " +
  "keeping the official letterhead and footer.";

export function respondentSummonsBlockedReason() {
  return null;
}

/**
 * Can this portal produce a Respondent Summons right now?
 *
 * Yes: the `summons` master is registered in MASTER_TEMPLATES and the renderer
 * (generateRespondentSummons) exists. Kept as a single gate so the UI and the
 * generator can never disagree about availability.
 */
export function respondentSummonsGenerationAvailable() {
  return true;
}
