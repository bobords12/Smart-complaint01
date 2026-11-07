/**
 * The complaint row plus the resident profile the printed forms read the
 * complainant's name and full address from.
 *
 * The address columns have to be selected explicitly: a nested embed only
 * returns the fields it names, so without house_street / purok / barangay /
 * city the generated Reklamo Form would print a blank address line for every
 * registered resident. `complainant_snapshot` is carried by `*` and holds the
 * same name and address keys for a walk-in who has no resident account.
 */
import { formatResidentSchedule } from "@/lib/residentDates";
import {
  CATEGORIZATION_STATUS,
  CATEGORIZATION_STAGE_LABEL,
  STAGE_KEYS,
  STAGE_TRANSITIONS,
} from "@/components/captain/complaints/complaintMeta";

export const COMPLAINT_EMBED =
  "*, complainant_snapshot, profiles!complaints_resident_id_fkey(display_name, resident_profiles(first_name, middle_name, last_name, suffix, house_street, purok, barangay, city))";

/**
 * Optional overlay applied to complaint rows so the Reklamo Form can print the
 * receiving official's name. complaints.received_by is a bare uuid, and a
 * second embed of the same profiles row is not reliably resolvable by PostgREST,
 * so this comes from complaint_receipt_officials (see
 * supabase/manual/reklamo-form-document-workflow.sql).
 */
export const RECEIPT_OFFICIAL_EMBED = "complaint_receipt_officials(complaint_id, received_by_name)";

/**
 * Collapse an optional single-row read to a row or null.
 *
 * The optional-table reads below cannot use `maybeSingle()`: several of those
 * tables do not exist in every deployment, and a missing relation surfaces as a
 * query error rather than an empty result. They are therefore fetched as lists
 * and the error is swallowed by the caller. That leaves `null` and `[]` both
 * meaning "nothing here", so this collapses either shape to the one thing the
 * derivations read — a row object, or null.
 */
function singleRowOf(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Fetch the complaints list plus the per-complaint context the list page
 * needs (hearings, KP trackers + phases, completion timestamps).
 * Barangay-scale data: a handful of parallel queries instead of N+1.
 */
export async function fetchComplaintsContext(supabase) {
  const [complaintsRes, hearingsRes, trackersRes, kpPhasesRes] = await Promise.all([
    supabase
      .from("complaints")
      .select(COMPLAINT_EMBED)
      .order("submitted_at", { ascending: false }),
    supabase
      .from("hearings")
      .select("id, complaint_id, title, hearing_date, hearing_time, venue, status")
      .order("hearing_date", { ascending: true }),
    supabase
      .from("kp_trackers")
      .select("id, complaint_id, kp_applicable, current_phase, applicability_confirmed_by, applicability_confirmed_at"),
    supabase
      .from("kp_phases")
      .select("id, tracker_id, phase_type, start_date, deadline_date, duration_days, status, completed_at")
      .order("start_date", { ascending: true }),
  ]);

  const complaints = complaintsRes.error ? [] : complaintsRes.data;
  const hearings = hearingsRes.error ? [] : hearingsRes.data;
  const kpTrackers = trackersRes.error ? [] : trackersRes.data;
  const kpPhases = kpPhasesRes.error ? [] : kpPhasesRes.data;

  const hearingsByComplaint = {};
  for (const h of hearings) {
    (hearingsByComplaint[h.complaint_id] ||= []).push(h);
  }

  const kpTrackerMap = {};
  for (const t of kpTrackers) {
    kpTrackerMap[t.complaint_id] = {
      ...t,
      phases: kpPhases.filter((p) => p.tracker_id === t.id),
    };
  }

  // Route context for the cards: which complaint draws a blotter number,
  // has incident details on file, or has a recorded referral. Fetched
  // tolerantly so a list page still renders before the routing migration
  // has been applied.
  const [blotterRes, incidentRes, assistanceRes] = await Promise.all([
    supabase
      .from("blotter_records")
      .select("id, complaint_id, blotter_number, incident_date, incident_location, current_status"),
    supabase.from("complaint_incident_details").select("id, complaint_id"),
    supabase.from("complaint_assistance_records").select("id, complaint_id"),
  ]);

  const blotterMap = {};
  if (!blotterRes.error) {
    for (const r of blotterRes.data || []) {
      if (!r.complaint_id || blotterMap[r.complaint_id]) continue;
      blotterMap[r.complaint_id] = r;
    }
  }
  const incidentDetailMap = {};
  if (!incidentRes.error) {
    for (const r of incidentRes.data || []) incidentDetailMap[r.complaint_id] = true;
  }
  const assistanceMap = {};
  if (!assistanceRes.error) {
    for (const r of assistanceRes.data || []) {
      assistanceMap[r.complaint_id] = (assistanceMap[r.complaint_id] || 0) + 1;
    }
  }

  const error = [complaintsRes.error, hearingsRes.error, trackersRes.error, kpPhasesRes.error]
    .find(Boolean)?.message;

  return {
    complaints,
    hearingsByComplaint,
    kpTrackerMap,
    blotterMap,
    incidentDetailMap,
    assistanceMap,
    error,
  };
}

/**
 * Fetch every record the case viewer needs for a single complaint.
 * Tables added by 20_complaints_case_viewer.sql are fetched tolerantly so
 * the page still renders if the migration has not been applied yet.
 */
export async function fetchComplaintBundle(supabase, complaintId) {
  const base = [
    supabase.from("complaints").select(COMPLAINT_EMBED).eq("id", complaintId).maybeSingle(),
    supabase
      .from("complaint_reviews")
      .select("*")
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: false }),
    supabase
      .from("complaint_classification_logs")
      .select("*")
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: false }),
    supabase
      .from("case_statuses")
      .select("id, status, stage, resident_visible_message, created_at, changed_by")
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: true }),
    supabase
      .from("evidence")
      .select("*")
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: true }),
    supabase
      .from("hearings")
      .select("*, summons(id, storage_path, issued_at)")
      .eq("complaint_id", complaintId)
      .order("hearing_date", { ascending: true }),
    supabase
      .from("kp_trackers")
      .select("*, profiles(display_name)")
      .eq("complaint_id", complaintId)
      .maybeSingle(),
    supabase
      .from("official_documents")
      .select("*")
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: true }),
    supabase
      .from("lupon_panels")
      // Pinned to member_id: lupon_panels has three foreign keys to
      // profiles (member_id, assigned_by, replaced_by), so a bare embed is
      // rejected as ambiguous and this read silently returned no rows.
      .select("*, profiles!member_id(display_name, role)")
      .eq("complaint_id", complaintId)
      .eq("status", "active")
      .order("assigned_at", { ascending: true }),
    supabase
      .from("blotter_records")
      .select("id, blotter_number, incident_summary, incident_date, incident_location, current_status, respondent_name, recorded_at")
      .eq("complaint_id", complaintId)
      .order("recorded_at", { ascending: false })
      .limit(1),
    supabase
      .from("activity_logs")
      .select("id, actor_id, actor_role, action, target_type, target_id, entity_ref, details, old_values, new_values, created_at, profiles!actor_id(display_name, role)")
      .or(`target_type.eq.complaint,target_id.eq.${complaintId}`)
      .order("created_at", { ascending: false })
      .limit(100),
  ];

  const optional = [
    { key: "internalNotes", query: () => supabase.from("internal_notes").select("*").eq("complaint_id", complaintId).order("created_at", { ascending: false }) },
    { key: "lifecycleEvents", query: () => supabase.from("document_lifecycle_events").select("*, profiles(display_name)").eq("complaint_id", complaintId).order("event_date", { ascending: true }) },
    // Pinned to served_by: summons_service_records has two foreign keys to
    // profiles (served_by, acknowledged_by). An ambiguous embed failed the
    // whole read, which left serviceRecords empty and made every summons
    // report as "Not served".
    { key: "serviceRecords", query: () => supabase.from("summons_service_records").select("*, profiles!served_by(display_name)").eq("complaint_id", complaintId).order("created_at", { ascending: true }) },
    { key: "attendances", query: () => supabase.from("hearing_attendances").select("*").eq("complaint_id", complaintId).order("created_at", { ascending: true }) },
    // Meeting Records. Optional for the same reason as the rest: a case
    // filed before the meeting-record migration has none, and the case
    // file then reports its hearings as scheduled rather than inventing a
    // meeting that was never recorded.
    { key: "minutes", query: () => supabase.from("hearing_minutes").select("*").eq("complaint_id", complaintId).order("created_at", { ascending: true }) },
    // Added by captain-complaint-routing-workflow.sql. Optional for the
    // same reason as the four above: a case filed before the routing
    // migration must still open, so a missing table shows an empty
    // history rather than a broken case file.
    { key: "routingHistory", query: () => supabase.from("complaint_routing_history").select("id, respondent_status_before, respondent_status_after, respondent_name_before, respondent_name_after, kp_applicability_before, kp_applicability_after, routing_status_before, routing_status_after, complaint_nature_before, complaint_nature_after, completeness_status_before, completeness_status_after, reason, remarks, resident_message, acted_by_name, acted_by_role, created_at").eq("complaint_id", complaintId).order("created_at", { ascending: false }).limit(200) },
    { key: "assistanceRecords", query: () => supabase.from("complaint_assistance_records").select("id, assistance_type, agency_name, reference_number, assistance_given, assistance_summary, follow_up_required, follow_up_due_on, recorded_outcome, related_document_id, recorded_by_name, recorded_at").eq("complaint_id", complaintId).order("recorded_at", { ascending: false }) },
    { key: "incidentDetails", query: () => supabase.from("complaint_incident_details").select("id, property_description, incident_value, proof_of_ownership, plate_number, serial_number, engine_chassis_number, identifiable_marks, last_known_location, last_known_at, witnesses, cctv_available, cctv_notes, evidence_notes, safety_concern, safety_notes, already_reported_externally, externally_reported_where, external_reference, incident_details_other, recorded_by_name, updated_at").eq("complaint_id", complaintId).maybeSingle() },
    // The resident's answers to an information request, plus which of
    // the complaint's evidence files each answer carried. Optional for
    // the same reason as the rest.
    { key: "informationResponses", query: () => supabase.from("complaint_information_responses").select("id, response_text, created_at, complaint_information_response_files(evidence_id)").eq("complaint_id", complaintId).order("created_at", { ascending: false }) },
    // The Pangkat's own 15-day clock. Started only when the panel
    // officially convenes, so a case with members but no convening has
    // a row here that reports "Not Convened" rather than no row at all.
    // Optional for the same reason as the rest: a case file opened
    // before the Pangkat migration must still open.
    { key: "pangkatTracker", query: () => supabase.from("pangkat_trackers").select("*").eq("complaint_id", complaintId).maybeSingle() },
    // How the case ended — an amicable settlement and the date it
    // becomes binding, any repudiation of it, and any Certificate to
    // File Action released. Optional for the same reason as the rest.
    { key: "caseResolution", query: () => supabase.from("case_resolutions").select("*").eq("complaint_id", complaintId).maybeSingle() },
  ];

  const results = await Promise.all(base.map((p) => p));
  const optionalResults = await Promise.all(optional.map((o) => o.query()));

  const [
    complaintRes,
    reviewsRes,
    classLogsRes,
    caseStatusesRes,
    evidenceRes,
    hearingsRes,
    kpTrackerRes,
    documentsRes,
    luponRes,
    blotterRes,
    activityLogsRes,
  ] = results;

  let kpPhases = [];
  if (!kpTrackerRes.error && kpTrackerRes.data?.id) {
    const phasesRes = await supabase
      .from("kp_phases")
      .select("*")
      .eq("tracker_id", kpTrackerRes.data.id)
      .order("start_date", { ascending: true });
    kpPhases = phasesRes.error ? [] : phasesRes.data;
  }

  const optionalData = {};
  const optionalErrors = {};
  optionalResults.forEach((res, index) => {
    optionalData[optional[index].key] = res.error ? [] : res.data;
    optionalErrors[optional[index].key] = res.error || null;
  });

  return {
    complaint: complaintRes.error ? null : complaintRes.data,
    reviews: reviewsRes.error ? [] : reviewsRes.data,
    classificationLogs: classLogsRes.error ? [] : classLogsRes.data,
    caseStatuses: caseStatusesRes.error ? [] : caseStatusesRes.data,
    evidence: evidenceRes.error ? [] : evidenceRes.data,
    hearings: hearingsRes.error ? [] : hearingsRes.data,
    kpTracker: kpTrackerRes.error ? null : kpTrackerRes.data,
    kpPhases,
    documents: documentsRes.error ? [] : documentsRes.data,
    luponPanels: luponRes.error ? [] : luponRes.data,
    blotterRecord: blotterRes.error ? null : blotterRes.data?.[0] || null,
    activityLogs: activityLogsRes.error ? [] : activityLogsRes.data,
    internalNotes: optionalData.internalNotes,
    lifecycleEvents: optionalData.lifecycleEvents,
    serviceRecords: optionalData.serviceRecords,
    attendances: optionalData.attendances,
    minutes: optionalData.minutes,
    routingHistory: optionalData.routingHistory,
    assistanceRecords: optionalData.assistanceRecords,
    incidentDetails: optionalData.incidentDetails?.[0] || null,
    // A `maybeSingle()` read returns a row or null, never a list. The
    // loop above hands back `[]` when the table is missing, so both
    // are collapsed to the one shape the derivations expect.
    pangkatTracker: singleRowOf(optionalData.pangkatTracker),
    caseResolution: singleRowOf(optionalData.caseResolution),
    // Normalised to the same shape the resident-side helper returns, so
    // the Captain view and the resident view read one field name.
    informationResponses: (optionalData.informationResponses || []).map((row) => ({
      id: row.id,
      text: row.response_text || "",
      created_at: row.created_at,
      evidenceIds: (row.complaint_information_response_files || [])
        .map((f) => f.evidence_id)
        .filter(Boolean),
    })),
    // True when the routing tables are absent, so the UI can say
    // "apply the routing migration" instead of rendering as though
    // nothing had ever been recorded on this case.
    routingUnavailable: Boolean(
      optionalErrors.routingHistory || optionalErrors.assistanceRecords || optionalErrors.incidentDetails
    ),
    // True when the meeting-record table is absent. The UI can then say
    // "apply migration 29" instead of showing hearings with no way to
    // record whether they were actually held.
    meetingRecordsUnavailable: Boolean(optionalErrors.minutes),
  };
}

/**
 * Log an official action against a complaint via the SECURITY DEFINER RPC.
 */
export async function logComplaintActivity(supabase, { action, complaintId, ref, details, new_values, old_values }) {
  return supabase.rpc("log_activity", {
    p_action: action,
    p_target_type: "complaint",
    p_target_id: complaintId,
    p_entity_ref: ref || null,
    p_details: details || {},
    p_old_values: old_values || null,
    p_new_values: new_values || null,
  });
}

/**
 * Notify the complainant about a case event. Tolerant of failures.
 */
export async function notifyResident(supabase, complaintId, residentId, { type, title, message, hearingId }) {
  if (!residentId) return false;
  const { error } = await supabase.from("notifications").insert({
    user_id: residentId,
    type: type || "complaint",
    title,
    message: message || "",
    related_complaint_id: complaintId,
    related_hearing_id: hearingId || null,
  });
  return !error;
}

/**
 * Tell the complainant a session was set, moved or cancelled.
 *
 * A hearing is a fact about the resident's own case, so it has always been
 * something they should be told — but nothing wrote the row. The Resident
 * Portal therefore had no way to learn that a session existed until the
 * resident happened to open the hearings page, which is why scheduling was
 * invisible in the portal's own notification list and badge.
 *
 * Three rules govern the wording:
 *   * it is written for the person who filed, not for the officer;
 *   * it never says "summons", because a summons is served on the
 *     respondent and is not the complainant's document;
 *   * the date is rendered in Barangay Abuno's own calendar (Asia/Manila)
 *     by the shared formatter, so what the resident reads is exactly the
 *     `hearing_date` / `hearing_time` the Captain entered.
 *
 * The type is `hearing`, which the schema has always allowed, so the
 * portal's Hearings tab finds these rows on their own rather than having
 * to guess from the message text. Failure is swallowed: the hearing is
 * already committed and a notification that did not go out must never be
 * reported as a failed schedule.
 */
export async function notifyResidentHearingEvent(
  supabase,
  complaintId,
  residentId,
  hearing,
  event
) {
  if (!residentId || !hearing?.id) return false;

  const schedule = formatResidentSchedule(hearing.hearing_date, hearing.hearing_time);
  const venue = String(hearing.venue || "").trim() || "Barangay Abuno Hall";
  const session = String(hearing.title || hearing.hearing_type || "Your hearing");

  const WRITING = {
    scheduled: {
      title: "Hearing scheduled",
      message: `${session} is set for ${schedule} at ${venue}.`,
    },
    rescheduled: {
      title: "Hearing rescheduled",
      message: `${session} has been rescheduled to ${schedule} at ${venue}.`,
    },
    cancelled: {
      title: "Hearing cancelled",
      message: `${session} set for ${schedule} has been cancelled.`,
    },
  };

  const copy = WRITING[event];
  if (!copy) return false;

  return notifyResident(supabase, complaintId, residentId, {
    type: "hearing",
    title: copy.title,
    message: copy.message,
    hearingId: hearing.id,
  });
}

/** Sentinel used when no legal category fits and the decision stays open. */
export const NO_CATEGORY_CONFIRMED = "Unconfirmed / Further review";

/**
 * Persist the official category/urgency decision for a complaint.
 *
 * Shared by the Stage 2 "For Official Categorization" action in
 * WorkflowActions and by the Categorization tab so the two can never
 * disagree about what an official confirmation writes.
 *
 * The AI prediction columns (predicted_category / predicted_urgency /
 * prediction_confidence) are deliberately left untouched: the
 * recommendation is preserved for comparison and the confirmed_* columns
 * hold the official decision.
 *
 * @returns {{ success: boolean, error?: string, confirmed: boolean }}
 */
export async function confirmOfficialCategorization(
  supabase,
  { complaint, category, urgency, remarks, reviewed, reviewedBy, now }
) {
  if (!reviewed) {
    return { success: false, error: "Confirm that the complaint and its evidence were reviewed." };
  }

  // Remarks are optional: the Captain Portal classification card no longer
  // collects them, while the Stage 2 workflow dialog still requires its own
  // remarks before calling this helper. The review_notes column is retained.
  const note = remarks?.trim() || "";
  const chosen = category && category !== NO_CATEGORY_CONFIRMED ? category : null;
  const chosenUrgency = chosen && urgency ? urgency : null;
  const confirmed = Boolean(chosen && chosenUrgency);
  const at = now || new Date().toISOString();

  if (confirmed) {
    const { error } = await supabase
      .from("complaints")
      .update({
        confirmed_category: chosen,
        confirmed_case_type: chosen,
        confirmed_urgency: chosenUrgency,
        updated_at: at,
      })
      .eq("id", complaint.id);
    if (error) return { success: false, error: error.message };
  }

  const { error: reviewError } = await supabase
    .from("complaint_reviews")
    .upsert(
      {
        complaint_id: complaint.id,
        reviewed_by: reviewedBy || null,
        confirmed_category: confirmed ? chosen : null,
        confirmed_case_type: confirmed ? chosen : null,
        confirmed_urgency: confirmed ? chosenUrgency : null,
        review_notes: note,
        reviewed_at: at,
      },
      { onConflict: "complaint_id" }
    );
  if (reviewError) return { success: false, error: reviewError.message };

  const { error: logError } = await logComplaintActivity(supabase, {
    action: confirmed ? "confirmed_official_assessment" : "recorded_review_decision",
    complaintId: complaint.id,
    ref: complaint.reference_number || undefined,
    details: {
      category: confirmed ? chosen : "unconfirmed",
      urgency: confirmed ? chosenUrgency : "unconfirmed",
      remarks: note,
    },
  });
  if (logError) return { success: false, error: logError.message };

  return { success: true, confirmed };
}

/**
 * Move a complaint off the official-categorization stage once the decision it
 * was waiting for is actually on record.
 *
 * WHY THIS EXISTS
 *   `receive_complaint_official()` stamps a complaint 'For Official
 *   Categorization', and the Stage 2 action modal advanced it again after a
 *   confirmation — but the Review & Classification tab, which is the control
 *   the "Review Classification" button opens, only ever wrote the confirmed
 *   columns. The recorded stage was therefore left behind by the work: the
 *   Case Progress stepper showed Step 5 while the next-action ladder still
 *   offered "Review Classification", and pressing it changed nothing. Both
 *   entry points now run this same advance, so the recorded stage follows the
 *   decision instead of the two disagreeing.
 *
 * IT NEVER MOVES A CASE BACKWARDS
 *   Nothing is written unless the row is still on the categorization stage
 *   (status or stage label) and both official values are present. A case that
 *   has already moved on is left exactly as it is, and a decision still open
 *   on the "Unconfirmed / Further review" sentinel is never reported as
 *   waiting for a summons.
 *
 * @param {object} supabase the caller's client
 * @param {{ complaint: object, category?: string, urgency?: string,
 *           changedBy?: string|null, now?: string }} args
 *   `category` / `urgency` default to the values already on the row, so a
 *   re-confirmation of a saved decision still repairs a stage that an older
 *   save left behind.
 * @returns {Promise<boolean>} true when the stage was advanced.
 * @throws when the write fails, so no caller can report success over a case
 *   that is still parked on categorization.
 */
export async function advancePastCategorization(
  supabase,
  { complaint, category, urgency, changedBy = null, now } = {}
) {
  if (!complaint?.id) return false;

  const onCategorization =
    complaint.current_status === CATEGORIZATION_STATUS ||
    complaint.current_stage === CATEGORIZATION_STAGE_LABEL;
  if (!onCategorization) return false;

  const chosen = category ?? complaint.confirmed_category ?? complaint.confirmed_case_type;
  const chosenUrgency = urgency ?? complaint.confirmed_urgency;
  if (!chosen || chosen === NO_CATEGORY_CONFIRMED || !chosenUrgency) return false;

  const at = now || new Date().toISOString();
  const target = STAGE_TRANSITIONS[STAGE_KEYS.MEDIATION];

  const { error } = await supabase
    .from("complaints")
    .update({
      current_status: target.status,
      current_stage: target.stage,
      updated_at: at,
    })
    .eq("id", complaint.id);
  if (error) throw new Error(error.message);

  // The resident-facing timeline row. Same wording as the Stage 2 action, so
  // the two entry points read identically in the case history.
  const { error: statusError } = await supabase.from("case_statuses").insert({
    complaint_id: complaint.id,
    status: target.status,
    stage: "Categorization Confirmed — Pending Summons",
    resident_visible_message:
      "An official confirmed the category of your complaint. Summons scheduling follows.",
    changed_by: changedBy || null,
    created_at: at,
  });
  if (statusError) throw new Error(statusError.message);

  return true;
}
