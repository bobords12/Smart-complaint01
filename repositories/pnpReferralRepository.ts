import { createClient } from "@/lib/supabase/client";

/**
 * PNP referral data access.
 *
 * WHO THIS IS FOR
 *   Two callers share this file:
 *     * the PNP portal, where every read is already narrowed by RLS
 *       to the referrals the signed-in officer is assigned to;
 *     * the Captain's referral tab, where the officer is reviewing a
 *       complaint of their own.
 *
 * THE ONE RULE
 *   Every mutation goes through a pnp_*() RPC. There is not a single
 *   .insert(), .update() or .delete() in this file, and that is not
 *   an oversight. complaint_referrals has no INSERT, UPDATE or
 *   DELETE policy at all, so a direct table write from the browser
 *   is refused by the database regardless of what this file does.
 *   The RPCs are the sanctioned path because they re-check the
 *   caller's role, the referral's current status and the transition
 *   being attempted, and because they write the timeline row and the
 *   audit entry as part of the same action.
 *
 * ON COLUMN LISTS
 *   The PNP reads use explicit column lists rather than select("*")
 *   so the shape of what leaves the database is decided here, in
 *   review, instead of by whatever column someone adds to the table
 *   next quarter. A referral snapshot is a deliberate minimum: a PNP
 *   officer reads the summary, the parties and the incident facts,
 *   never the complainant's full narrative or the case file.
 */

const supabase = createClient();

const REFERRAL_BUCKET = "evidence";
/** Short enough that a pasted URL dies quickly. */
const SIGNED_URL_TTL_SECONDS = 120;

export interface Referral {
  id: string;
  referral_reference: string;
  /** Barangay case number, snapshotted onto the referral at creation
   *  so the officer can cite it without the portal ever reading
   *  public.complaints. Null only for referrals predating migration 32. */
  complaint_reference: string | null;
  complaint_id: string;
  referral_request_id: string | null;
  summary: string;
  incident_date: string | null;
  incident_location: string | null;
  parties_involved: string | null;
  referral_basis: string;
  referral_reason: string;
  has_safety_concern: boolean;
  status: string;
  referred_by: string;
  referred_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  assigned_officer_id: string | null;
  assigned_at: string | null;
  assigned_unit_id: string | null;
  external_reference: string | null;
  external_reference_at: string | null;
  resolution_reason: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralTimelineEntry {
  id: string;
  referral_id: string;
  update_type: string;
  status_before: string | null;
  status_after: string | null;
  message: string | null;
  author_id: string | null;
  author_role: string | null;
  created_at: string;
}

export interface ReferralEvidenceFile {
  share_id: string;
  evidence_id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  shared_by: string;
  shared_at: string;
  note: string | null;
}

export interface ReferralActivityRow {
  id: string;
  action: string;
  entity_ref: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  referral_id: string | null;
}

export interface PnpOfficerDirectoryRow {
  officer_id: string;
  display_name: string;
  rank: string | null;
  station_name: string | null;
  unit_id: string | null;
  unit_code: string | null;
  unit_name: string | null;
  open_referrals: number;
}

export interface ReferralRequestRow {
  id: string;
  complaint_id: string;
  resident_user_id: string;
  reason: string;
  has_immediate_safety_concern: boolean;
  status: string;
  decision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  requested_at: string;
}

export interface WriteResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

const REFERRAL_COLUMNS = [
  "id",
  "referral_reference",
  "complaint_reference",
  "complaint_id",
  "referral_request_id",
  "summary",
  "incident_date",
  "incident_location",
  "parties_involved",
  "referral_basis",
  "referral_reason",
  "has_safety_concern",
  "status",
  "referred_by",
  "referred_at",
  "acknowledged_by",
  "acknowledged_at",
  "assigned_officer_id",
  "assigned_at",
  "assigned_unit_id",
  "external_reference",
  "external_reference_at",
  "resolution_reason",
  "due_at",
  "created_at",
  "updated_at",
].join(", ");

const TIMELINE_COLUMNS = [
  "id",
  "referral_id",
  "update_type",
  "status_before",
  "status_after",
  "message",
  "author_id",
  "author_role",
  "created_at",
].join(", ");

/* ── Casting helpers ──────────────────────────────────────── */

/**
 * supabase-js cannot infer a row type from a .select("a, b, c")
 * string literal, so `data` arrives typed as GenericStringError. These
 * two helpers are the single place that admits it, so the column lists
 * above stay the one written-out contract for every read in this file
 * and a reviewer only has to check them in one spot.
 */
function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function asRow<T>(data: unknown): T | null {
  return (data || null) as T | null;
}

/* ── Reads: the PNP portal ──────────────────────────────────── */

/**
 * The officer's referral queue.
 *
 * No role filter and no `assigned_officer_id` filter is applied here
 * on purpose. The RLS policy "PNP officers read assigned referrals"
 * is the filter, and a client-side copy of it would be a second,
 * weaker version of the same rule that could drift from the first.
 * If the officer is not assigned, the rows do not come back at all.
 */
export async function fetchMyReferrals(options: {
  status?: string | null;
  search?: string | null;
  limit?: number;
} = {}): Promise<{ referrals: Referral[]; unavailable: boolean }> {
  let query = supabase
    .from("complaint_referrals")
    .select(REFERRAL_COLUMNS)
    .order("referred_at", { ascending: false })
    .limit(Math.min(options.limit ?? 200, 200));

  if (options.status) {
    query = query.eq("status", options.status);
  }

  if (options.search && options.search.trim()) {
    // Matches the reference or a word in the summary. Escaped because
    // this is user input and the pattern is passed to Postgres.
    const term = options.search.trim().replace(/[%_,]/g, " ");
    query = query.or(
      `referral_reference.ilike.%${term}%,summary.ilike.%${term}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    // "unavailable" tells the page to say the migration has not been
    // applied, instead of rendering an empty queue that reads as
    // "you have no work".
    return { referrals: [], unavailable: true };
  }

  return { referrals: asRows<Referral>(data), unavailable: false };
}

/** One referral, or null when the officer is not assigned to it. */
export async function fetchMyReferral(
  referralId: string
): Promise<{ referral: Referral | null; unavailable: boolean }> {
  const { data, error } = await supabase
    .from("complaint_referrals")
    .select(REFERRAL_COLUMNS)
    .eq("id", referralId)
    .maybeSingle();

  if (error) return { referral: null, unavailable: true };
  return { referral: asRow<Referral>(data), unavailable: false };
}

/** The referral's timeline. RLS limits this to assigned referrals. */
export async function fetchReferralTimeline(
  referralId: string
): Promise<{ entries: ReferralTimelineEntry[]; unavailable: boolean }> {
  const { data, error } = await supabase
    .from("complaint_referral_updates")
    .select(TIMELINE_COLUMNS)
    .eq("referral_id", referralId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(500);

  if (error) return { entries: [], unavailable: true };
  return { entries: asRows<ReferralTimelineEntry>(data), unavailable: false };
}

/**
 * The officer's own assignment rows.
 *
 * pnp_officer is granted SELECT on its own rows here and nothing
 * else, so this cannot become a roster of other officers' work.
 */
export async function fetchMyAssignments(): Promise<
  { assignments: ReferralAssignment[]; unavailable: boolean }
> {
  const { data, error } = await supabase
    .from("pnp_referral_assignments")
    .select("id, referral_id, officer_id, assigned_by, assigned_at, released_at")
    .order("assigned_at", { ascending: false })
    .limit(200);

  if (error) return { assignments: [], unavailable: true };
  return { assignments: asRows<ReferralAssignment>(data), unavailable: false };
}

export interface ReferralAssignment {
  id: string;
  referral_id: string;
  officer_id: string;
  assigned_by: string;
  assigned_at: string;
  released_at: string | null;
}

/**
 * Evidence shared on one referral.
 *
 * This goes through pnp_referral_evidence_files() rather than a
 * nested PostgREST embed. `evidence` has no PNP read policy on
 * purpose, so an embed would resolve the share row and return a null
 * file object; granting read on `evidence` to make the embed work
 * would expose every filing in the barangay. The RPC returns a
 * fixed column list for the shared slice only.
 */
export async function fetchReferralEvidence(
  referralId: string
): Promise<{ files: ReferralEvidenceFile[]; unavailable: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("pnp_referral_evidence_files", {
    p_referral_id: referralId,
  });

  if (error) {
    return {
      files: [],
      unavailable: isMissingFunction(error),
      error: humanizePnpError(error, "the evidence list"),
    };
  }

  return { files: asRows<ReferralEvidenceFile>(data), unavailable: false };
}

/**
 * Mint a short-lived URL for one shared evidence file.
 *
 * The authorization is not here. It is the storage SELECT policy in
 * pnp-portal-05, which checks the assignment and the share row again
 * at request time, and which therefore also revokes the URL if the
 * assignment is released while the officer has the page open. The
 * URL is never stored anywhere.
 */
export async function createReferralEvidenceUrl(
  storagePath: string
): Promise<WriteResult & { url?: string }> {
  if (!storagePath || !storagePath.trim()) {
    return { success: false, error: "This file has no stored copy to open." };
  }

  const { data, error } = await supabase.storage
    .from(REFERRAL_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return {
      success: false,
      error:
        error?.message?.toLowerCase().includes("not found")
          ? "That file is no longer in storage."
          : "This file could not be opened. Ask the barangay to share it again.",
    };
  }

  return { success: true, url: data.signedUrl };
}

/** Referral-scoped audit rows, via the narrow SECURITY DEFINER reader. */
export async function fetchReferralActivity(
  referralId?: string | null,
  limit = 100
): Promise<{ rows: ReferralActivityRow[]; unavailable: boolean }> {
  const { data, error } = await supabase.rpc("pnp_referral_activity", {
    p_referral_id: referralId || null,
    p_limit: Math.min(limit, 500),
  });

  if (error) return { rows: [], unavailable: true };
  return { rows: asRows<ReferralActivityRow>(data), unavailable: false };
}

/* ── Writes: the PNP officer ────────────────────────────────── */

/** Take the referral on. The first move of a referral's life. */
export async function acknowledgeReferral(
  referralId: string,
  note?: string
): Promise<WriteResult> {
  return updateReferralStatus(referralId, "acknowledged", null, note);
}

/**
 * Drive a status transition.
 *
 * The permitted moves are decided in pnp_update_referral_status().
 * This function does not second-guess the server: if the move is
 * illegal, the database says so and the message is shown as-is.
 */
export async function updateReferralStatus(
  referralId: string,
  newStatus: string,
  reason?: string | null,
  note?: string | null
): Promise<WriteResult> {
  const trimmedReason = (reason || "").trim() || null;
  const trimmedNote = (note || "").trim() || null;

  if (["returned", "declined", "closed"].includes(newStatus) && !trimmedReason) {
    return {
      success: false,
      error: "Record a reason. This decision is permanent and must be explainable later.",
    };
  }

  const { error } = await supabase.rpc("pnp_update_referral_status", {
    p_referral_id: referralId,
    p_new_status: newStatus,
    p_reason: trimmedReason,
    p_note: trimmedNote,
  });

  if (error) return { success: false, error: humanizePnpError(error, "the status change") };
  return { success: true };
}

/** A note on the timeline. */
export async function addReferralNote(
  referralId: string,
  message: string
): Promise<WriteResult> {
  const trimmed = (message || "").trim();
  if (trimmed.length < 3) {
    return { success: false, error: "Write a note before saving." };
  }

  const { error } = await supabase.rpc("pnp_record_referral_note", {
    p_referral_id: referralId,
    p_message: trimmed,
  });

  if (error) return { success: false, error: humanizePnpError(error, "the note") };
  return { success: true };
}

/** Ask the barangay a question. Moves the referral to needs_information. */
export async function requestReferralInformation(
  referralId: string,
  question: string
): Promise<WriteResult> {
  const trimmed = (question || "").trim();
  if (trimmed.length < 5) {
    return { success: false, error: "Write the information you need." };
  }

  const { error } = await supabase.rpc("pnp_request_referral_information", {
    p_referral_id: referralId,
    p_question: trimmed,
  });

  if (error) return { success: false, error: humanizePnpError(error, "the request") };
  return { success: true };
}

/**
 * Record the PNP's own external reference.
 *
 * Required to be typed by hand. This system will not generate,
 * guess or infer a police reference number, and the field stays
 * empty until an officer holds a real one.
 */
export async function setReferralExternalReference(
  referralId: string,
  externalReference: string
): Promise<WriteResult> {
  const trimmed = (externalReference || "").trim();
  if (trimmed.length < 3) {
    return {
      success: false,
      error:
        "Enter the actual reference supplied by the PNP, or leave this field empty. This system does not generate police reference numbers.",
    };
  }

  const { error } = await supabase.rpc("pnp_set_external_reference", {
    p_referral_id: referralId,
    p_external_reference: trimmed,
  });

  if (error) {
    return { success: false, error: humanizePnpError(error, "the external reference") };
  }
  return { success: true };
}

/* ── Reads: the Captain / OIC referral tab ──────────────────── */

/** The formal referral for a complaint, if one has been created. */
export async function fetchReferralForComplaint(
  complaintId: string
): Promise<{ referral: Referral | null; unavailable: boolean }> {
  const { data, error } = await supabase
    .from("complaint_referrals")
    .select(REFERRAL_COLUMNS)
    .eq("complaint_id", complaintId)
    .order("referred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { referral: null, unavailable: true };
  return { referral: asRow<Referral>(data), unavailable: false };
}

/**
 * Which complaint evidence files are already on this referral.
 *
 * This is the Captain's read, not the PNP's, so it selects the share
 * table directly instead of going through
 * pnp_referral_evidence_files() — that RPC is PNP-only by design.
 * The "Referring officials read referral evidence" policy in
 * pnp-portal-04-referral-rls.sql is what permits it, and it returns
 * the whole complaint's share list to an official reviewing their own
 * case, which is data they already own.
 *
 * Only the id and the file name come back. The officer needs to know
 * which checkboxes are already ticked, and nothing more.
 */
export async function fetchSharedReferralEvidenceIds(
  referralId: string
): Promise<{ shared: { evidenceId: string; filename: string | null }[]; unavailable: boolean }> {
  const { data, error } = await supabase
    .from("complaint_referral_evidence")
    .select("evidence_id, original_filename")
    .eq("referral_id", referralId)
    .order("shared_at", { ascending: true });

  if (error) return { shared: [], unavailable: true };
  return {
    shared: (data || []).map((row) => ({
      evidenceId: row.evidence_id,
      filename: row.original_filename,
    })),
    unavailable: false,
  };
}

/** Resident requests attached to a complaint, for the review dialog. */
export async function fetchComplaintReferralRequests(
  complaintId: string
): Promise<{ requests: ReferralRequestRow[]; unavailable: boolean }> {
  const { data, error } = await supabase
    .from("pnp_referral_requests")
    .select(
      "id, complaint_id, resident_user_id, reason, has_immediate_safety_concern, status, decision_note, reviewed_by, reviewed_at, requested_at"
    )
    .eq("complaint_id", complaintId)
    .order("requested_at", { ascending: false });

  if (error) return { requests: [], unavailable: true };
  return { requests: asRows<ReferralRequestRow>(data), unavailable: false };
}

/** The assignable-officer roster for the assignment dialog. */
export async function fetchOfficerDirectory(
  unitId?: string | null
): Promise<{ officers: PnpOfficerDirectoryRow[]; unavailable: boolean }> {
  const { data, error } = await supabase.rpc("pnp_officer_directory", {
    p_unit_id: unitId || null,
  });

  if (error) return { officers: [], unavailable: true };
  return { officers: asRows<PnpOfficerDirectoryRow>(data), unavailable: false };
}

/* ── Writes: the Captain / OIC ──────────────────────────────── */

export type ReferralRequestDecision =
  | "approved"
  | "declined"
  | "more_information_required";

/**
 * Record the barangay's decision on a resident's referral request.
 *
 * This is the step that has to happen BEFORE pnp_create_referral().
 * The RPC refuses a request that is still 'pending_review':
 *
 *   IF v_request.status NOT IN ('approved', 'officially_referred') THEN
 *     RAISE EXCEPTION 'The resident request is still "%". Approve it
 *       first, or refer the case on a barangay basis instead.'
 *
 * so a Captain cannot create a referral that answers a request they
 * have not yet decided on. Approving first, then referring, also keeps
 * the resident's notification truthful: the trigger in
 * pnp-referral-requests.sql tells them the request was approved, and
 * only afterwards that the case was officially referred.
 *
 * This is a direct table UPDATE rather than a pnp_*() RPC, which is
 * the deliberate exception to the rule above. The
 * "Referring officials review referral requests" policy in
 * pnp-portal-01 allows exactly this for an active captain or oic, and
 * its WITH CHECK pins complaint_id and resident_user_id to their
 * original values so a reviewer cannot repoint the request at another
 * case mid-review. Note it does NOT restrict which status may be
 * written, so the role check on the client is for the officer's
 * benefit only, and this remains an unprivileged write.
 */
export async function reviewReferralRequest(
  requestId: string,
  decision: ReferralRequestDecision,
  decisionNote?: string | null
): Promise<WriteResult> {
  if (!requestId) return { success: false, error: "No request was selected." };

  const trimmed = (decisionNote || "").trim();
  if (decision !== "approved" && trimmed.length < 5) {
    return {
      success: false,
      error: "Write a short note for the resident. They are told why, and a bare decline is not an explanation.",
    };
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { success: false, error: "Please sign in again." };
  }

  const { error } = await supabase
    .from("pnp_referral_requests")
    .update({
      status: decision,
      decision_note: trimmed || null,
      reviewed_by: userData.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) {
    // The message used to claim, unconditionally, that only the Captain
    // or OIC may decide — which is wrong often enough to be harmful. A
    // failed token refresh, a dropped connection and a refused write all
    // land here, and telling an officer their own role is insufficient
    // sends them to check their permissions when permissions were never
    // the problem. The real reason is reported; the sentence that
    // follows is what is most likely true, not what is asserted.
    return {
      success: false,
      error:
        `The request could not be reviewed (${error.message}). ` +
        "Deciding on a referral request is limited to the Barangay Captain and the Officer-in-Charge.",
    };
  }
  return { success: true };
}

export interface CreateReferralInput {
  complaintId: string;
  summary: string;
  referralReason: string;
  basis: "resident_request" | "barangay_initiated";
  requestId?: string | null;
  hasSafetyConcern?: boolean;
  evidenceIds?: string[];
  incidentDate?: string | null;
  incidentLocation?: string | null;
  partiesInvolved?: string | null;
  dueAt?: string | null;
}

/**
 * Create the formal referral.
 *
 * Every eligibility rule is re-checked by pnp_create_referral():
 * the caller must be a Captain or OIC, the complaint must not already
 * have an open referral, and a named respondent on a KP-applicable
 * or KP-pending case is refused. The client checks are for the
 * officer's benefit, not for security.
 */
export async function createReferral(
  input: CreateReferralInput
): Promise<WriteResult & { referralId?: string }> {
  const summary = (input.summary || "").trim();
  const reason = (input.referralReason || "").trim();

  if (summary.length < 10) {
    return {
      success: false,
      error:
        "Write a referral summary of at least 10 characters. This is the only case narrative the PNP will see.",
    };
  }
  if (reason.length < 5) {
    return { success: false, error: "Record why this case is being referred." };
  }
  if (input.basis === "resident_request" && !input.requestId) {
    return {
      success: false,
      error: "Select the resident request this referral approves, or choose a barangay-initiated referral.",
    };
  }

  const { data, error } = await supabase.rpc("pnp_create_referral", {
    p_complaint_id: input.complaintId,
    p_summary: summary,
    p_referral_reason: reason,
    p_referral_basis: input.basis,
    p_referral_request_id: input.requestId || null,
    p_safety_concern: input.hasSafetyConcern ?? false,
    p_evidence_ids: input.evidenceIds?.length ? input.evidenceIds : null,
    p_incident_date: input.incidentDate || null,
    p_incident_location: (input.incidentLocation || "").trim() || null,
    p_parties_involved: (input.partiesInvolved || "").trim() || null,
    p_due_at: input.dueAt || null,
  });

  if (error) return { success: false, error: humanizePnpError(error, "the referral") };
  return { success: true, referralId: data as string };
}

/** Assign the referral to a PNP officer, optionally scoped to a unit. */
export async function assignReferral(
  referralId: string,
  officerId: string,
  unitId?: string | null,
  message?: string | null
): Promise<WriteResult> {
  if (!officerId) return { success: false, error: "Choose a PNP officer." };

  const { error } = await supabase.rpc("pnp_assign_referral", {
    p_referral_id: referralId,
    p_officer_id: officerId,
    p_unit_id: unitId || null,
    p_message: (message || "").trim() || null,
  });

  if (error) return { success: false, error: humanizePnpError(error, "the assignment") };
  return { success: true };
}

/** Release the current officer. Requires a reason. */
export async function releaseReferral(
  referralId: string,
  reason: string
): Promise<WriteResult> {
  const trimmed = (reason || "").trim();
  if (trimmed.length < 5) {
    return { success: false, error: "Record a reason for releasing the officer." };
  }

  const { error } = await supabase.rpc("pnp_release_referral", {
    p_referral_id: referralId,
    p_reason: trimmed,
  });

  if (error) return { success: false, error: humanizePnpError(error, "the release") };
  return { success: true };
}

/** Share one more complaint evidence file with the PNP. */
export async function shareReferralEvidence(
  referralId: string,
  evidenceId: string,
  note?: string | null
): Promise<WriteResult> {
  if (!evidenceId) return { success: false, error: "Choose a file to share." };

  const { error } = await supabase.rpc("pnp_share_referral_evidence", {
    p_referral_id: referralId,
    p_evidence_id: evidenceId,
    p_note: (note || "").trim() || null,
  });

  if (error) {
    return { success: false, error: humanizePnpError(error, "the evidence share") };
  }
  return { success: true };
}

/** The barangay's answer to the PNP's information request. */
export async function respondToReferralInformation(
  referralId: string,
  answer: string
): Promise<WriteResult> {
  const trimmed = (answer || "").trim();
  if (trimmed.length < 3) {
    return { success: false, error: "Write a response before sending." };
  }

  const { error } = await supabase.rpc("pnp_respond_to_referral_information", {
    p_referral_id: referralId,
    p_answer: trimmed,
  });

  if (error) return { success: false, error: humanizePnpError(error, "the response") };
  return { success: true };
}

/* ── Notifications ─────────────────────────────────────────── */

export interface PnpNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  related_referral_id: string | null;
  related_complaint_id: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * The officer's notifications, read here rather than through the
 * shared NotificationsProvider.
 *
 * The shared mapper (notificationRepository) exists to serve the
 * resident and official portals and keeps a fixed shape with no
 * related_referral_id, which is exactly the column a PNP officer
 * needs in order to click through to the referral. Widening that
 * mapper would add a dead field to two other portals; duplicating
 * one query is the cheaper trade. The bell badge in the header still
 * uses the shared provider, so the two agree on the unread count.
 */
export async function fetchMyNotifications(): Promise<PnpNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, type, title, message, related_referral_id, related_complaint_id, read_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return [];
  return asRows<PnpNotification>(data);
}

export async function markPnpNotificationRead(
  notificationId: string
): Promise<boolean> {
  const { error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });
  return !error;
}

export async function markAllPnpNotificationsRead(): Promise<boolean> {
  const { error } = await supabase.rpc("mark_all_notifications_read");
  return !error;
}

/* ── Errors ────────────────────────────────────────────────── */

function isMissingFunction(error: { message?: string; code?: string } | null): boolean {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("could not find the function") ||
    error?.code === "42883" ||
    message.includes("does not exist")
  );
}

/**
 * Turn a Postgres RAISE into something an officer can act on.
 *
 * The RPCs raise readable sentences, and those sentences are the most
 * useful thing in the error. PostgREST wraps them, so the useful
 * text is pulled out rather than replaced. Order matters: the
 * specific messages are checked before the generic fallbacks, and
 * the fallback is the RAISE text itself rather than a generic
 * apology, because a wrong-but-readable message costs an officer
 * more time than an honest one.
 */
function humanizePnpError(
  error: { message?: string; code?: string } | null,
  subject: string
): string {
  const raw = String(error?.message || "");
  const lower = raw.toLowerCase();

  if (isMissingFunction(error)) {
    return "The PNP referral database setup has not been applied yet. Run supabase/manual/pnp-portal-01 through -05 in order.";
  }
  if (lower.includes("could not find the function")) {
    return "The PNP referral database setup has not been applied yet. Run supabase/manual/pnp-portal-01 through -05 in order.";
  }
  if (lower.includes("not assigned to you")) {
    return "This referral is not assigned to you. Ask the Captain to assign it to you.";
  }
  if (lower.includes("your pnp account is not active")) {
    return "Your PNP account is not active. Contact the barangay administrator.";
  }
  if (lower.includes("only the barangay captain or the officer-in-charge")) {
    return "Only the Barangay Captain or the Officer-in-Charge can do this.";
  }
  if (lower.includes("only an active pnp officer")) {
    return "Only an active PNP officer can do this.";
  }
  if (lower.includes("your role cannot")) {
    return "Your role cannot perform this action.";
  }
  if (lower.includes("kp-applicable") || lower.includes("stays in barangay mediation")) {
    return "This case is KP-applicable, so it stays in barangay mediation. A PNP referral does not apply.";
  }
  if (lower.includes("kp applicability has not been assessed")) {
    return "A respondent is named but KP applicability has not been assessed. Record it in Routing Assessment first.";
  }
  if (lower.includes("already has an open referral")) {
    return "This complaint already has an open referral. Update that referral instead of creating a second one.";
  }
  if (lower.includes("does not belong to this complaint")) {
    return "That file belongs to a different complaint and cannot be shared on this referral.";
  }
  if (lower.includes("record a reason")) {
    return "Record a reason. This decision is permanent and must be explainable later.";
  }
  if (lower.includes("is still")) {
    return "Approve the resident's request first, or refer the case on a barangay basis instead.";
  }
  if (lower.includes("your account is not permitted") || error?.code === "42501") {
    return "Your account is not permitted to perform this action.";
  }

  // Prefer the SQL RAISE text over the wrapper.
  const match = raw.match(/^([\s\S]*?)(?:\s*\((?:[0-9a-f-]{36})\))?\s*$/);
  const cleaned = (match ? match[1] : raw).trim();
  if (cleaned && !/^(null|undefined)$/i.test(cleaned)) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return `Could not save ${subject}. Please try again.`;
}
