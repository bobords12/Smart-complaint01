/**
 * Captain complaint workflow — derivation layer.
 *
 * WHY THIS FILE EXISTS
 *   The Captain's Complaints page has to answer, for every case, one
 *   question: "what is happening now, and what happens next?" Answering
 *   it needs several tables at once (complaints, summons,
 *   summons_service_records, hearings, hearing_attendances), and the
 *   rules that turn those rows into a workflow are not derivable from
 *   any single one of them.
 *
 *   Those rules live here, once, so the list card and the case file can
 *   never disagree about where a case is. That matters more than it
 *   sounds: a card that says "Summons issued" while the case file says
 *   "no summons on record" is worse than no card at all.
 *
 * SCOPE
 *   Captain Portal -> Complaints only. Nothing here is imported by the
 *   OIC or Secretary portals, and no resident page imports it.
 *
 * DATA HONESTY RULES
 *   1. No fabricated progress. Every state below is either read from a
 *      column or derived from the absence of a row. Nothing is invented
 *      from the stage label, the calendar, or a login.
 *   2. No invented respondent. A case with no identified respondent
 *      reads as "Unidentified", never as a blank party slot that could
 *      be mistaken for missing data.
 *   3. No absence is not a presence. An attendance row that was never
 *      filled in reads as "Not recorded". It is never promoted to
 *      Present, and it never counts as a failure to appear.
 *   4. No legal conclusion. This layer counts recorded absences and
 *      stops there. It does not know how many absences a rule requires
 *      before something may happen, does not name a legal process, and
 *      does not change complaint status. Only a Captain, through an
 *      explicit recorded action, can decide anything.
 *   5. No "held" without a record. A hearing reads as Held only when a
 *      saved meeting record says the meeting was conducted. A schedule,
 *      a past date, or an attendance entry is not a meeting.
 */

import { fetchComplaintsContext, logComplaintActivity } from "@/lib/complaintQueries";
import { activeHearing, manilaToday, sortHearings } from "@/lib/hearing/hearingSchedule";
// captainComplaintRouting imports nothing, so this cannot form a cycle. It is
// read here rather than re-derived so the action button and the gate strip on
// the case file always agree about whether routing has been settled.
import { isRoutingComplete } from "@/lib/captainComplaintRouting";

/* ── Complaint situation ──────────────────────────────────────── */

/**
 * Respondent states that mean "there is nobody to summon".
 * Mirrors the SQL vocabulary in captain-complaint-routing-workflow.sql.
 */
const UNIDENTIFIED_STATES = ["unknown", "insufficient_information", "not_applicable"];

/** Routes that describe an outside-referral / incident pathway. */
const REFERRAL_ROUTES = [
  "police_reporting_assistance",
  "external_agency_assistance",
  "incident_documentation",
];

/**
 * Routes that hand the case to an agency outside the barangay.
 *
 * A subset of REFERRAL_ROUTES. `incident_documentation` is deliberately NOT
 * here: documenting an incident is work the barangay still does itself, so
 * naming a suspect later must not leave the case stranded outside the
 * two-party pathway just because it was logged as an incident first.
 */
const OUTSIDE_REFERRAL_ROUTES = [
  "police_reporting_assistance",
  "external_agency_assistance",
];

export function respondentStateOf(complaint) {
  return complaint?.respondent_status || "pending";
}

/** True only when a real, named person exists on the other side. */
export function hasIdentifiedRespondent(complaint) {
  return respondentStateOf(complaint) === "identified";
}

/**
 * The one distinction that decides which workflow a case walks.
 *
 * Two-party  -> a respondent exists, so summons/hearing/mediation apply.
 * Unidentified -> nobody to put on notice (theft, damage, threat from
 *                 an unknown person), so the case follows the incident /
 *                 blotter pathway and mediation is NOT applicable.
 */
export function isTwoPartyDispute(complaint) {
  if (!complaint) return false;
  // Handed to an agency outside the barangay, so naming a respondent does
  // not pull it back into the village process.
  if (OUTSIDE_REFERRAL_ROUTES.includes(complaint.routing_status)) return false;
  // An identified respondent means there is now a person to put on notice.
  // This has to win over a recorded nature of "reported_incident": a theft
  // first reported against an unknown suspect and later traced to a named
  // person converts to the two-party pathway on the SAME record, and it
  // must not stay locked out of mediation just because the nature column
  // still reads "reported_incident".
  if (hasIdentifiedRespondent(complaint)) return true;
  if (complaint.complaint_nature === "reported_incident") return false;
  if (UNIDENTIFIED_STATES.includes(respondentStateOf(complaint))) return false;
  return complaint.complaint_nature === "two_party_dispute";
}

/**
 * A reported incident with no identified suspect — the "theft, suspect
 * unknown" case. These must NOT be pushed into a mediation workflow.
 */
export function isUnidentifiedIncident(complaint) {
  if (!complaint) return false;
  // Naming the suspect ends this pathway. The mirror image of the rule in
  // isTwoPartyDispute(): a case cannot be both, so once a respondent is
  // identified the suspect is no longer unidentified.
  if (hasIdentifiedRespondent(complaint)) return false;
  if (complaint.complaint_nature === "reported_incident") return true;
  if (REFERRAL_ROUTES.includes(complaint.routing_status)) return true;
  return UNIDENTIFIED_STATES.includes(respondentStateOf(complaint));
}

/** Short, honest label for the complaint situation. */
export function situationOf(complaint) {
  if (isUnidentifiedIncident(complaint)) {
    return {
      key: "unidentified",
      label: "Unidentified suspect",
      short: "Unidentified",
      tone: "critical",
    };
  }
  if (hasIdentifiedRespondent(complaint)) {
    return {
      key: "two_party",
      label: "Two-party dispute",
      short: "Two-party",
      tone: "ok",
    };
  }
  if (complaint?.complaint_nature === "two_party_dispute") {
    return {
      key: "dispute_pending",
      label: "Dispute — respondent not yet confirmed",
      short: "Dispute",
      tone: "warning",
    };
  }
  if (complaint?.complaint_nature === "service_concern") {
    return { key: "service", label: "Service concern", short: "Service", tone: "neutral" };
  }
  if (complaint?.complaint_nature === "administrative_concern") {
    return { key: "admin", label: "Administrative concern", short: "Admin", tone: "neutral" };
  }
  return { key: "unassessed", label: "Not yet assessed", short: "Unassessed", tone: "warning" };
}

/**
 * The respondent as it should be displayed. Never returns a name that
 * was not officially recorded, and never returns a blank cell that
 * could be read as "data missing" rather than "not identified yet".
 */
export function respondentDisplay(complaint) {
  const state = respondentStateOf(complaint);
  if (state === "identified") {
    const name = (complaint?.respondent_display_name || "").trim();
    return { identified: true, name: name || "Identified (name not recorded)", label: name || "Identified" };
  }
  const labels = {
    pending: "Not yet confirmed",
    unknown: "Unidentified",
    insufficient_information: "Insufficient information to identify",
    not_applicable: "No other party",
  };
  return {
    identified: false,
    name: null,
    label: labels[state] || "Not yet confirmed",
  };
}

/* ── Summons state ────────────────────────────────────────────── */

/**
 * Complaint-level summons states.
 *
 * Derived, never stored, because the schema has no single summons
 * status column: a summons is "issued" when a row exists in `summons`,
 * it is "prepared" when the document exists but no summons row does,
 * and it has been "sent" once a `summons_service_records` row records
 * service on a date.
 */
export const SUMMONS_STATES = [
  { key: "not_issued", label: "Notice of Hearing not yet issued", short: "Not issued" },
  { key: "prepared", label: "Notice of Hearing prepared", short: "Prepared" },
  { key: "issued", label: "Notice of Hearing issued", short: "Issued" },
  { key: "sent", label: "Notice of Hearing served", short: "Served" },
  { key: "acknowledged", label: "Notice of Hearing received / acknowledged", short: "Acknowledged" },
  { key: "hearing_scheduled", label: "Hearing scheduled", short: "Hearing set" },
];

/**
 * Walk the summons state for one complaint.
 *
 * @param {object} args
 * @param {Array}  args.summons         summons rows for the complaint
 * @param {Array}  args.serviceRecords  summons_service_records rows
 * @param {Array}  args.documents       official_documents rows
 * @param {Array}  args.hearings        hearings rows
 * @returns {{ state: string, label: string, short: string, index: number,
 *             total: number, detail: string, document: object|null,
 *             issuedAt: string|null, servedOn: string|null }}
 */
export function summonsStateFor({ summons = [], serviceRecords = [], documents = [], hearings = [] } = {}) {
  const total = SUMMONS_STATES.length;

  const summonsRow = summons[0] || null;
  // The document behind this track is the Notice of Hearing, which is
  // addressed to the respondent by name and address. A separate Respondent
  // Summons is no longer produced, so "prepared" now means the one notice
  // both parties are named on is on file.
  const preparedDoc =
    documents.find((d) => d.document_type === "hearing_notice" && d.status === "active") || null;
  const issuedDoc =
    documents.find((d) => d.document_type === "hearing_notice" && d.status !== "active") || null;

  // Service records are per-party. The respondent's record is what
  // moves the summons to "sent"; a service record on the complainant
  // is the copy, not the service of process.
  const respondentService = serviceRecords.find((r) => r.party_role === "respondent") || null;
  const complainantService = serviceRecords.find((r) => r.party_role === "complainant") || null;

  const hearing = activeHearing(hearings);

  const issuedAt = summonsRow?.issued_at || null;
  const servedOn = respondentService?.served_on || null;
  // Read from the recorded column. It used to be inferred by looking for
  // words like "received" or "signed" in the free-text notes, which
  // could both miss a real acknowledgment and invent a false one.
  const acknowledged = Boolean(respondentService?.acknowledged_on);

  let state = "not_issued";
  let detail = "No Notice of Hearing has been prepared for this case yet.";

  if (issuedRowPresent(summonsRow)) {
    state = "issued";
    detail = `Notice of Hearing issued on ${issuedAt || "record date unknown"}.`;
    if (servedOn) {
      state = "sent";
      detail = `Notice of Hearing served on the respondent on ${servedOn}.`;
      if (acknowledged) {
        state = "acknowledged";
        detail = `Notice of Hearing served on the respondent on ${servedOn} and acknowledged on ${
          respondentService?.acknowledged_on
        }.`;
      }
    }
  } else if (preparedDoc || issuedDoc) {
    state = "prepared";
    detail = preparedDoc
      ? `Notice of Hearing "${preparedDoc.title}" is on file but has not been issued.`
      : "A Notice of Hearing exists but has been superseded or archived.";
  }

  // The hearing is reported as a separate fact rather than being
  // promoted into the summons state. Collapsing the two is what let a
  // card read "Hearing set" on a case with no summons at all.
  if (hearing) {
    detail = `${detail} Hearing set for ${hearing.hearing_date || "a date to be confirmed"}.`;
  }

  const meta = SUMMONS_STATES.find((s) => s.key === state) || SUMMONS_STATES[0];

  return {
    state: meta.key,
    label: meta.label,
    short: meta.short,
    index: SUMMONS_STATES.findIndex((s) => s.key === meta.key),
    total,
    detail,
    document: preparedDoc || issuedDoc || null,
    summonsRow,
    issuedAt,
    servedOn,
    acknowledged,
    hasCopyForComplainant: Boolean(complainantService) || Boolean(preparedDoc),
    hearing,
  };
}

function issuedRowPresent(summonsRow) {
  return Boolean(summonsRow && summonsRow.issued_at);
}

/* ── Section status for the mediation section header ──────────── */

/**
 * The four states of the "Summons, Mediation & Attendance" section header.
 *
 * One chip for the whole section, so the Captain reads where the section
 * stands without scanning every block inside it. Each label is derived from
 * rows that exist; none of them is stored, and none of them implies a step
 * that has not been recorded.
 */
export const MEDIATION_SECTION_STATES = [
  { key: "awaiting_schedule", label: "Awaiting Schedule", tone: "warning" },
  { key: "scheduled", label: "Scheduled", tone: "info" },
  { key: "documents_ready", label: "Documents Ready", tone: "ok" },
  { key: "hearing_held", label: "Hearing Held", tone: "ok" },
];

/**
 * The single header status for the mediation section.
 *
 *   Hearing Held      a saved meeting record says the meeting was
 *                     conducted — the same rule the tracker uses
 *   Awaiting Schedule no live hearing on the case at all
 *   Documents Ready   a live hearing, the Notice of Hearing on file,
 *                     and the Respondent Summons document on file
 *   Scheduled         a live hearing, with documents still outstanding
 *
 * Nothing else feeds it: no store status, no template label, no chip from
 * a lifecycle that has not been recorded.
 *
 * @param {object} args
 * @param {Array}  args.hearings   hearings rows
 * @param {Array}  args.minutes    meeting records
 * @param {Array}  args.documents  official_documents rows
 */
export function mediationSectionStatusFor({
  hearings = [],
  minutes = [],
  documents = [],
} = {}) {
  const meetingByHearing = meetingRecordsByHearing(minutes);
  const held = (hearings || []).some(
    (h) =>
      h?.status !== "Cancelled" &&
      hearingLifecycleFor(h, meetingByHearing.get(h.id) || null)?.held
  );
  if (held) return stateOf("hearing_held");

  const hearing = activeHearing(hearings, { today: manilaToday() });
  if (!hearing) return stateOf("awaiting_schedule");

  const activeDocs = (documents || []).filter((d) => d?.status !== "superseded");
  // One document now serves both parties, so the section is complete as soon
  // as that Notice of Hearing is on file. It used to wait for a separate
  // summons as well, which meant a case could sit at "Scheduled" forever
  // once the summons stopped being produced.
  const noticeReady = activeDocs.some((d) => d.document_type === "hearing_notice");
  if (noticeReady) return stateOf("documents_ready");

  return stateOf("scheduled");
}

function stateOf(key) {
  const meta = MEDIATION_SECTION_STATES.find((s) => s.key === key) || MEDIATION_SECTION_STATES[0];
  return { ...meta, index: MEDIATION_SECTION_STATES.findIndex((s) => s.key === meta.key) };
}

/* ── Party-level summons and service status ───────────────────── */

/**
 * The respondent summons, tracked on its own.
 *
 * SUMMONS_STATES (above) is left untouched because the complaint-list card
 * reads it, and the list card is outside the scope of this work. This is
 * the separate track the case file needs: generation, issuance, service and
 * acknowledgment are four different recorded events, and the old single
 * "Sent" state collapsed issuance and service into one, which is what made
 * it impossible to tell whether the respondent had actually been served.
 */
export const RESPONDENT_SUMMONS_TRACK = [
  { key: "not_generated", label: "Not Generated" },
  { key: "generated", label: "Generated" },
  { key: "issued", label: "Issued" },
  { key: "served", label: "Served" },
  { key: "acknowledged", label: "Acknowledged" },
];

/** The hearing track. Scheduling is not issuance. */
export const HEARING_TRACK = [
  { key: "not_scheduled", label: "Not Scheduled" },
  { key: "scheduled", label: "Scheduled" },
  { key: "held", label: "Hearing Held" },
];

/**
 * What the complainant has received.
 *
 * `notice_pending` is a real state rather than a silently-completed
 * rung: it means no Notice of Hearing document exists yet. The old
 * ladder had no such state, so a missing notice reported itself as
 * "Notice Generated".
 *
 * `viewed` is only ever reached from a recorded 'viewed' lifecycle
 * event on the document. Absence of that row means the read is not
 * knowable from the Captain side, which is different from not viewed.
 */
export const COMPLAINANT_COPY_TRACK = [
  { key: "notice_pending", label: "Notice Not Generated" },
  { key: "notice_generated", label: "Notice Generated" },
  { key: "physical_recorded", label: "Physical Copy Recorded" },
  { key: "digital_sent", label: "Digital Copy Sent" },
  { key: "viewed", label: "Viewed" },
];

/** The respondent's physical service. There is no respondent portal. */
export const RESPONDENT_SERVICE_TRACK = [
  { key: "not_served", label: "Not Served" },
  { key: "served", label: "Served" },
  { key: "acknowledged", label: "Acknowledged" },
];

/** Document types that hold the complaint / Reklamo copy for a case. */
const COMPLAINT_COPY_TYPES = ["reklamo_form", "signed_reklamo_form", "submission_receipt"];

/** Audit actions this section reads. Written by DocumentsTab and here. */
const AUDIT_GENERATED = "respondent_summons_generated";
const AUDIT_ISSUED = "respondent_summons_issued";
const AUDIT_COPY_SENT = "summons_copy_sent_to_complainant";

function latestAudit(activityLogs, action) {
  const rows = (activityLogs || []).filter((a) => a?.action === action);
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

function latestService(serviceRecords, partyRole) {
  const rows = (serviceRecords || []).filter((r) => r?.party_role === partyRole);
  if (!rows.length) return null;
  return rows
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}

function listenerOf(record) {
  return record?.profiles?.display_name || null;
}

/**
 * Derive everything the Summons & Hearing section shows, for both parties.
 *
 * NOTHING HERE IS STORED AS A NEW STATUS. Every state is derived from a
 * row that already exists:
 *
 *   hearing notice       official_documents(document_type='hearing_notice')
 *                        -> the ONE document both party columns show
 *                        -> summons row (issued_at) as its issuance ledger
 *                        -> summons_service_records(party_role='respondent')
 *   complainant copy     summons_service_records(party_role='complainant')
 *   complainant digital  activity_logs(action='summons_copy_sent_to_complainant')
 *   complaint copy       official_documents(reklamo/signed/receipt)
 *
 * Each rung is reached only when its own record exists, so "generated" can
 * never imply "issued" and "issued" can never imply "served".
 *
 * The complainant's digital copy is proven from the audit entry written by
 * the send action. Whether the resident later OPENED it is not knowable
 * from the Captain side: RLS allows a resident to read only their own
 * notifications, so there is no officer-readable record of the read. That
 * is reported as untracked rather than guessed.
 *
 * @param {object} args
 * @param {object} args.complaint
 * @param {string} args.complainantName resolved by the caller's meta module
 * @param {Array}  args.summons
 * @param {Array}  args.serviceRecords
 * @param {Array}  args.documents
 * @param {Array}  args.hearings
 * @param {Array}  args.activityLogs
 */
export function summonsPartyStatusFor({
  complaint = null,
  complainantName = "—",
  summons = [],
  serviceRecords = [],
  documents = [],
  hearings = [],
  activityLogs = [],
  minutes = [],
  lifecycleEvents = [],
} = {}) {
  const activeDocs = (documents || []).filter((d) => d.status !== "superseded");

  // ── Hearing ────────────────────────────────────────────────────
  const hearing = activeHearing(hearings, { today: manilaToday() });
  const minutesByHearing = meetingRecordsByHearing(minutes);
  const meeting = hearing ? minutesByHearing.get(hearing.id) || null : null;

  // "Held" now means what it says. It is true only when a saved meeting
  // record says the meeting was conducted. A status column alone is a
  // claim someone typed, and the old code treated it as proof.
  const lifecycle = hearing ? hearingLifecycleFor(hearing, meeting) : null;
  const hearingHeld = Boolean(lifecycle?.held);
  const hearingScheduled = Boolean(lifecycle?.scheduled);
  const hearingKey = hearingHeld ? "held" : hearingScheduled ? "scheduled" : "not_scheduled";

  // ── The one Notice of Hearing ──────────────────────────────────
  // Both party columns point at this single document. It names the
  // respondent by name and address and the complainant on the
  // "Complainant/s:" line, so there is no second file for a second party
  // to hold — the barangay and the complainant read the same bytes.
  const noticeDoc = activeDocs.find((d) => d.document_type === "hearing_notice") || null;

  // ── Issuance and service of that notice ────────────────────────
  // The `summons` table is the issuance and service ledger this track has
  // always used; what it points at is now the Notice of Hearing. Rows
  // written before the separate summons was retired still name a summons
  // file, so those are kept readable rather than silently reinterpreted.
  const issuedSummonsRow = (summons || []).find((s) => s?.issued_at) || null;
  const summonsDoc = noticeDoc;

  const respondentService = latestService(serviceRecords, "respondent");
  const servedOn = respondentService?.served_on || null;
  // Acknowledgment is read from the recorded columns, never inferred
  // from the wording of the notes. Keyword matching both missed real
  // acknowledgments and invented false ones, which is the same class of
  // bug as reading attendance off a derived boolean.
  const respondentAcknowledged = Boolean(respondentService?.acknowledged_on);

  const summonsKey = respondentAcknowledged
    ? "acknowledged"
    : servedOn
      ? "served"
      : issuedSummonsRow
        ? "issued"
        : summonsDoc
          ? "generated"
          : "not_generated";

  const generatedAudit = latestAudit(activityLogs, AUDIT_GENERATED);
  const issuedAudit = latestAudit(activityLogs, AUDIT_ISSUED);

  // ── Complainant copies ─────────────────────────────────────────
  // noticeDoc is already the one Notice of Hearing, computed above.
  const complainantService = latestService(serviceRecords, "complainant");
  const copySentAudit = latestAudit(activityLogs, AUDIT_COPY_SENT);

  // "Viewed" is only true when somebody actually opened the document and
  // that was recorded as a 'viewed' lifecycle event on it. Without such
  // a row the state is "not tracked", which is a different statement from
  // "not viewed" and is reported as such. Nothing here infers a read
  // from a send, a login, or the passage of time.
  const viewedEvents = (lifecycleEvents || []).filter((e) => e?.event_type === "viewed");
  const viewedDocIds = new Set(viewedEvents.map((e) => e.document_id).filter(Boolean));
  const viewedDoc =
    (noticeDoc && viewedDocIds.has(noticeDoc.id) ? noticeDoc : null) ||
    activeDocs.find((d) => viewedDocIds.has(d.id)) ||
    null;
  const digitalViewed = Boolean(viewedDoc);

  // The physical copy is recorded as a summons_service_record for the
  // complainant, which is a real row with a real recorder. Its absence
  // means the copy was not recorded, so the track must not claim it was.
  const physicalRecorded = Boolean(complainantService?.served_on);

  const complainantCopyKey = !noticeDoc
    ? "notice_pending"
    : !physicalRecorded
      ? "notice_generated"
      : !copySentAudit
        ? "physical_recorded"
        : !digitalViewed
          ? "digital_sent"
          : "viewed";

  // ── Complaint / Reklamo copy on the case ───────────────────────
  const complaintCopyDoc =
    activeDocs.find((d) => d.document_type === "signed_reklamo_form") ||
    activeDocs.find((d) => d.document_type === "reklamo_form") ||
    activeDocs.find((d) => d.document_type === "submission_receipt") ||
    null;

  // ── Respondent name, and what is still missing ─────────────────
  const respondent = respondentDisplay(complaint);
  const respondentName = respondent.identified ? respondent.name : null;

  const missing = [];
  if (!respondent.identified) {
    missing.push(
      "No respondent has been identified on this complaint. Record the respondent before the Notice of Hearing can be addressed."
    );
  }
  if (!hearing) {
    missing.push("No hearing or mediation session is scheduled.");
  } else {
    if (!hearing.hearing_date) missing.push("The scheduled hearing has no date.");
    if (!hearing.hearing_time) missing.push("The scheduled hearing has no time.");
    if (!String(hearing.venue || "").trim()) missing.push("The scheduled hearing has no venue.");
  }
  if (!complaint?.reference_number) missing.push("This complaint has no reference number.");

  // ── The one next action ────────────────────────────────────────
  const nextAction = buildSummonsNextAction({
    hearingKey,
    lifecycle,
    summonsKey,
    respondentService,
    physicalRecorded,
    noticeDoc,
    copySentAudit,
    missing,
  });

  return {
    hearing: hearing
      ? {
          ...hearing,
          trackKey: hearingKey,
          trackIndex: HEARING_TRACK.findIndex((h) => h.key === hearingKey),
          held: hearingHeld,
          scheduled: hearingScheduled,
          lifecycle,
          meeting,
        }
      : { trackKey: "not_scheduled", trackIndex: 0, held: false, scheduled: false },

    respondentSummons: {
      key: summonsKey,
      index: RESPONDENT_SUMMONS_TRACK.findIndex((s) => s.key === summonsKey),
      label: RESPONDENT_SUMMONS_TRACK.find((s) => s.key === summonsKey)?.label,
      respondentName,
      caseNo: complaint?.reference_number || "—",
      document: summonsDoc,
      issuedRow: issuedSummonsRow,
      generatedAt: generatedAudit?.created_at || summonsDoc?.created_at || null,
      generatedBy: listenerOf(generatedAudit) || null,
      issuedAt: issuedSummonsRow?.issued_at || issuedAudit?.created_at || null,
      issuedBy: listenerOf(issuedAudit) || null,
      canGenerate: missing.length === 0 && summonsKey === "not_generated",
      canIssue: missing.length === 0 && summonsKey === "generated",
      missing,
    },

    complainant: {
      name: complainantName,
      noticeDoc,
      noticeGenerated: Boolean(noticeDoc),
      service: complainantService,
      physicalRecorded,
      physicalServedOn: complainantService?.served_on || null,
      physicalServedTo: complainantService?.served_to || complainantService?.party_label || null,
      physicalRecordedBy: complainantService?.served_by || null,
      recordedBy: listenerOf(complainantService),
      digitalSent: Boolean(copySentAudit),
      digitalSentAt: copySentAudit?.created_at || null,
      digitalAvailable: Boolean(copySentAudit),
      // Truthful either way. True only when a 'viewed' lifecycle event
      // exists for the document; otherwise the read is genuinely not
      // knowable from the Captain side and is reported as untracked
      // rather than as "not viewed".
      digitalViewed,
      digitalViewedTracked: digitalViewed,
      digitalViewedAt: viewedDoc
        ? viewedEvents.find((e) => e.document_id === viewedDoc.id)?.event_date ||
          viewedEvents.find((e) => e.document_id === viewedDoc.id)?.created_at ||
          null
        : null,
      canGenerateNotice: hearingScheduled && !noticeDoc,
      copyKey: complainantCopyKey,
      copyIndex: COMPLAINANT_COPY_TRACK.findIndex((c) => c.key === complainantCopyKey),
    },

    respondent: {
      name: respondentName || respondent.label,
      summonsKey,
      service: respondentService,
      served: Boolean(servedOn),
      acknowledged: respondentAcknowledged,
      acknowledgedOn: respondentService?.acknowledged_on || null,
      acknowledgedBy: respondentService?.acknowledged_by || null,
      servedOn,
      servedTo: respondentService?.served_to || respondentService?.party_label || null,
      servedBy: listenerOf(respondentService),
      modeOfService: respondentService?.mode_of_service || null,
      proofDocumentId: respondentService?.proof_document_id || null,
      serviceKey: respondentAcknowledged ? "acknowledged" : servedOn ? "served" : "not_served",
      serviceIndex: RESPONDENT_SERVICE_TRACK.findIndex(
        (s) => s.key === (respondentAcknowledged ? "acknowledged" : servedOn ? "served" : "not_served")
      ),
    },

    // There is no respondent portal, so a digital respondent copy is not
    // offered and is not invented.
    respondentDigitalAvailable: false,

    complaintCopy: {
      document: complaintCopyDoc,
      attached: Boolean(complaintCopyDoc),
      // The summons builder in lib/summonsPdf.js does not attach a copy of
      // the complaint to the respondent summons, so there is no template
      // requirement to satisfy and no issuance block to apply.
      requiredByTemplate: false,
    },

    nextAction,
  };
}

/**
 * The single incomplete action for the section. One message only, so the
 * Captain is never given a list of things that may or may not apply.
 *
 * Each branch is one persisted fact, checked in the order the work
 * actually happens. Nothing here is gated on a threshold or a legal
 * rule; if the record exists the step is done, and if it does not the
 * step is still open.
 *
 * There is one hearing document, the Notice of Hearing, so the ladder is
 * simply generate -> issue -> serve -> record the complainant's copy ->
 * send the digital copy. It used to wait on a separate summons as well,
 * which put "generate the summons" ahead of generating the notice and
 * could leave a case parked on a step that no longer exists.
 */
function buildSummonsNextAction({
  hearingKey,
  lifecycle,
  summonsKey,
  respondentService,
  physicalRecorded,
  noticeDoc,
  copySentAudit,
  missing,
}) {
  if (hearingKey === "not_scheduled") {
    return {
      key: "schedule_hearing",
      message: "Schedule the mediation before the hearing documents are prepared.",
    };
  }

  if (missing.length && summonsKey === "not_generated" && !noticeDoc) {
    return {
      key: "complete_information",
      message: `Complete the information the case documents require: ${missing[0]}`,
    };
  }

  // One document serves both parties, so this single branch is the whole
  // generate step for the case.
  if (!noticeDoc) {
    return {
      key: "generate_notice",
      message: "Generate the Notice of Hearing for the complainant and respondent.",
    };
  }

  // Generated. Issuing is the officer's own act and is never assumed here.
  if (summonsKey === "generated") {
    return {
      key: "issue_notice",
      message: "Review and issue the Notice of Hearing.",
    };
  }

  // Issued. The respondent's service of process comes before anything else.
  if (!respondentService) {
    return {
      key: "serve_respondent",
      message: "Record physical service to the respondent and complainant.",
    };
  }

  if (!physicalRecorded) {
    return {
      key: "record_complainant_copy",
      message: "Record delivery of the complainant's copy of the hearing documents.",
    };
  }

  if (!copySentAudit) {
    return {
      key: "send_digital_copy",
      message: "Send the complainant's official digital copy to the Resident Account.",
    };
  }

  // What happens next now depends on what has actually been recorded about
  // the hearing itself.
  if (lifecycle?.held) {
    return {
      key: "record_disposition",
      message: "The meeting record is saved. Record the disposition of this case.",
    };
  }

  if (lifecycle?.heldWithoutRecord) {
    return {
      key: "reconcile_meeting",
      message: lifecycle.detail,
    };
  }

  if (!lifecycle?.meeting) {
    return {
      key: "await_hearing",
      message: "The hearing documents are complete. Wait for the hearing, then record what happened.",
    };
  }

  return {
    key: "await_hearing",
    message: "Proceed with the scheduled mediation/hearing.",
  };
}

/* ── Attendance ───────────────────────────────────────────────── */

/**
 * The only attendance statuses this layer will accept. Mirrors the
 * CHECK constraint in 29_captain-hearing-casework.sql.
 *
 * "Not recorded" is first and is the default everywhere. The database
 * stores it whenever a status is missing or unrecognised, so it is what
 * makes "we did not write it down" visibly different from "the party
 * was there" - the distinction the old boolean-only column could not
 * express, and the reason a hearing with nothing recorded on it used
 * to display "Appeared".
 */
export const ATTENDANCE_STATUS_VALUES = [
  "Not recorded",
  "Present",
  "Absent",
  "Excused",
];

/**
 * Legacy rows written by the Lupon path can still carry "Late", and the
 * database still accepts it. It is read as an arrival rather than being
 * quietly downgraded to "Not recorded", because downgrading would turn
 * a recorded arrival into missing data.
 */
const ATTENDANCE_LEGACY_PRESENT = new Set(["Late"]);

export const ATTENDANCE_STATUS_OPTIONS = [
  { value: "Not recorded", label: "Not recorded" },
  { value: "Present", label: "Present" },
  { value: "Absent", label: "Absent" },
  { value: "Excused", label: "Excused" },
];

/** The attendance options for any party. Excused is never withheld. */
export function attendanceOptionsFor() {
  return ATTENDANCE_STATUS_OPTIONS;
}

/**
 * One row per hearing, carrying the recorded attendance of each party
 * and the meeting record saved against that hearing.
 *
 * `attendance_status` is authoritative and the legacy `attended`
 * boolean is deliberately ignored. The trigger
 * hearing_attendance_sync_attended() rewrites `attended` from
 * `attendance_status` on every write, so the boolean is not a record
 * of anything an officer chose - it is a derived mirror that reads
 * `false` for any row that never set a status. Reading it back is how
 * a hearing with nothing recorded on it came to display "Appeared".
 */
export function attendanceRowsFor(hearings = [], attendances = [], minutes = []) {
  const byHearing = new Map();
  for (const row of attendances || []) {
    if (!row.hearing_id) continue;
    if (!byHearing.has(row.hearing_id)) byHearing.set(row.hearing_id, []);
    byHearing.get(row.hearing_id).push(row);
  }

  const minutesByHearing = meetingRecordsByHearing(minutes);

  const ordered = sortHearings(hearings).filter((h) => h?.status !== "Cancelled");

  return ordered.map((hearing, index) => {
    const rows = byHearing.get(hearing.id) || [];
    const pick = (role) => rows.find((r) => r.party_role === role) || null;
    const meeting = minutesByHearing.get(hearing.id) || null;
    const lifecycle = hearingLifecycleFor(hearing, meeting);

    return {
      sequence: index + 1,
      hearing,
      hearingId: hearing.id,
      date: hearing.hearing_date || null,
      time: hearing.hearing_time || null,
      status: hearing.status || null,
      lifecycle,
      held: lifecycle.held,
      meeting,
      meetingRecorded: Boolean(meeting),
      // "Recorded" means an officer wrote something down. It is not the
      // same as the hearing having happened, and it is not the same as
      // a party having attended.
      recorded: rows.length > 0,
      complainant: attendanceStateOf(pick("complainant")),
      respondent: attendanceStateOf(pick("respondent")),
      minutes: meeting?.narrative || null,
      rows,
    };
  });
}

/**
 * Normalise one attendance row to a displayable state.
 *
 * Returns null when no row exists at all, so "not recorded" is never
 * confused with "did not appear". A row that exists but carries no
 * status reads as explicitly "Not recorded" rather than being guessed
 * into an appearance.
 *
 * This function is where the reported bug lived. It used to fall back
 * to the legacy `attended` boolean, so a row written by an older code
 * path with `attended = true` and no status displayed "Appeared" on a
 * hearing that was still in the future. That boolean is a derived
 * mirror, not a record of a decision, so it is no longer consulted.
 */
export function attendanceStateOf(row) {
  if (!row) return null;

  const raw = typeof row.attendance_status === "string" ? row.attendance_status.trim() : "";
  const present = raw === "Present" || ATTENDANCE_LEGACY_PRESENT.has(raw);
  const status = ATTENDANCE_STATUS_VALUES.includes(raw)
    ? raw
    : present
      ? "Present"
      : "Not recorded";

  return {
    state: status,
    attended: status === "Present",
    late: ATTENDANCE_LEGACY_PRESENT.has(raw),
    absent: status === "Absent",
    // Only an explicit absence is a failure to appear. "Not recorded"
    // and "Excused" are missing data and a stated excuse, not a
    // failure, and neither may be counted as one.
    failure: status === "Absent",
    label: ATTENDANCE_LEGACY_PRESENT.has(raw) ? "Present (late)" : status,
    excuseReason: row.excuse_reason || null,
    recordedBy: row.recorded_by || null,
    recordedAt: row.recorded_at || row.created_at || null,
  };
}

/**
 * Recorded absences per party, counted from the attendance rows.
 *
 * Each hearing is counted once per party however many rows it has, and
 * only where the status is an explicit "Absent". Hearings with no
 * attendance row at all are reported separately, because "we have not
 * recorded who came" and "nobody came" are different facts and a count
 * that cannot tell them apart is not evidence of anything.
 *
 * There is no threshold here and no legal process is named. This layer
 * records what was written down and stops. What, if anything, follows
 * from a number of absences is a Captain decision recorded through the
 * explicit action workflow, never something a panel decides by
 * reaching a number and printing a consequence beside it.
 */
export function absenceSummaryFor(rows = []) {
  const tally = (partyRole) => {
    const seen = new Set();
    const counts = { absent: 0, excused: 0, present: 0, notRecorded: 0 };

    for (const row of rows || []) {
      if (row?.party_role !== partyRole) continue;
      if (!row?.hearing_id) continue;
      if (seen.has(row.hearing_id)) continue;
      seen.add(row.hearing_id);

      const status = attendanceStateOf(row)?.state || "Not recorded";
      if (status === "Absent") counts.absent += 1;
      else if (status === "Excused") counts.excused += 1;
      else if (status === "Present") counts.present += 1;
      else counts.notRecorded += 1;
    }
    return counts;
  };

  const hearingsTouched = new Set();
  for (const row of rows || []) {
    if (row?.hearing_id) hearingsTouched.add(row.hearing_id);
  }

  const respondent = tally("respondent");
  const complainant = tally("complainant");

  return {
    respondent,
    complainant,
    hearingsWithRecords: hearingsTouched.size,
    headline: buildAbsenceHeadline(respondent),
  };
}

function buildAbsenceHeadline(respondent) {
  const parts = [];
  if (respondent.absent) {
    parts.push(`${respondent.absent} recorded absence${respondent.absent === 1 ? "" : "s"}`);
  }
  if (respondent.excused) {
    parts.push(`${respondent.excused} recorded excuse${respondent.excused === 1 ? "" : "s"}`);
  }
  if (respondent.notRecorded) {
    parts.push(
      `${respondent.notRecorded} hearing${respondent.notRecorded === 1 ? "" : "s"} with attendance not recorded`
    );
  }
  if (!parts.length) return "No respondent attendance has been recorded yet.";
  return `Respondent - ${parts.join(", ")}.`;
}

/* ── Meeting record ───────────────────────────────────────────── */

/**
 * The Meeting Record vocabulary, mirroring the CHECK constraints in
 * 29_captain-hearing-casework.sql. The database is the authority; these
 * are the same list so the UI cannot offer something the write would
 * reject.
 */
export const MEETING_CONDUCTED_VALUES = ["Not recorded", "Yes", "No"];

export const MEETING_OUTCOME_VALUES = [
  "Settled",
  "No settlement",
  "Continued",
  "Party failed to appear",
  "Other",
];

export const MEETING_CONDUCTED_OPTIONS = [
  { value: "Not recorded", label: "Not recorded", hint: "Nothing has been recorded yet." },
  { value: "Yes", label: "Yes", hint: "The meeting took place and can be recorded as Held." },
  { value: "No", label: "No", hint: "The meeting did not take place. The hearing stays scheduled." },
];

export const MEETING_OUTCOME_OPTIONS = [
  { value: "Settled", label: "Settled", hint: "The parties agreed." },
  { value: "No settlement", label: "No settlement", hint: "The parties did not agree." },
  {
    value: "Continued",
    label: "Continued",
    hint: "Another meeting is needed. Schedule the next hearing separately.",
  },
  {
    value: "Party failed to appear",
    label: "Party failed to appear",
    hint: "A recorded fact only. Any next step is a separate recorded action.",
  },
  { value: "Other", label: "Other", hint: "Needs an explanation before it can be saved." },
];

/** Latest non-final meeting record per hearing. */
export function meetingRecordsByHearing(minutes = []) {
  const byHearing = new Map();
  for (const row of minutes || []) {
    if (!row?.hearing_id) continue;
    const existing = byHearing.get(row.hearing_id);
    if (!existing) {
      byHearing.set(row.hearing_id, row);
      continue;
    }
    // Prefer a Final record over a live one, then the most recently
    // updated, so a case that has been attested reads from the attested
    // record rather than a leftover draft.
    const existingFinal = existing.status === "Final";
    const candidateFinal = row.status === "Final";
    if (
      (candidateFinal && !existingFinal) ||
      (candidateFinal === existingFinal &&
        String(row.updated_at || row.created_at || "") >
          String(existing.updated_at || existing.created_at || ""))
    ) {
      byHearing.set(row.hearing_id, row);
    }
  }
  return byHearing;
}

/** Whether a meeting record says the meeting actually took place. */
export function meetingWasConducted(meeting) {
  return meeting?.conducted === "Yes";
}

/**
 * Where one hearing stands, and what that claim rests on.
 *
 * `Held` is only ever true when a saved meeting record says the meeting
 * was conducted. The legacy 'Completed' value is accepted as held for
 * rows written before the migration, but the returned `heldWithoutRecord`
 * flag says out loud when that is the case, so the UI can show the gap
 * instead of quietly treating an unexplained 'Completed' as proof.
 */
export function hearingLifecycleFor(hearing, meeting) {
  const status = hearing?.status || null;
  const conducted = meetingWasConducted(meeting);

  if (conducted) {
    return {
      key: "held",
      label: "Held",
      tone: "ok",
      held: true,
      scheduled: false,
      cancelled: false,
      rescheduled: false,
      meeting,
      meetingRecorded: true,
      heldWithoutRecord: false,
    };
  }

  if (status === "Cancelled") {
    return {
      key: "cancelled",
      label: "Cancelled",
      tone: "neutral",
      held: false,
      scheduled: false,
      cancelled: true,
      rescheduled: false,
      meeting,
      meetingRecorded: Boolean(meeting),
      heldWithoutRecord: false,
      detail: hearing?.cancel_reason || null,
    };
  }

  if (status === "Rescheduled") {
    return {
      key: "rescheduled",
      label: "Rescheduled",
      tone: "neutral",
      held: false,
      scheduled: false,
      cancelled: false,
      rescheduled: true,
      meeting,
      meetingRecorded: Boolean(meeting),
      heldWithoutRecord: false,
    };
  }

  if (status === "Completed") {
    // A pre-migration row. Reported honestly rather than trusted.
    return {
      key: "unverified",
      label: "Held - meeting record missing",
      tone: "warning",
      held: false,
      scheduled: false,
      cancelled: false,
      rescheduled: false,
      meeting,
      meetingRecorded: Boolean(meeting),
      heldWithoutRecord: true,
      detail: meeting
        ? "This meeting record does not say the meeting was conducted. Record what actually happened."
        : "This hearing is marked as completed but has no meeting record. Record what actually happened.",
    };
  }

  return {
    key: "scheduled",
    label: status === "Upcoming" ? "Upcoming" : status || "Scheduled",
    tone: "info",
    held: false,
    scheduled: true,
    cancelled: false,
    rescheduled: false,
    meeting,
    meetingRecorded: Boolean(meeting),
    heldWithoutRecord: false,
  };
}

/**
 * The first actual mediation meeting on a case.
 *
 * This is the only thing that starts the mediation period. A scheduled
 * hearing does not, a service record does not, and a hearing whose date
 * has passed does not. Only a saved meeting record whose conducted
 * value is 'Yes' counts, and its own date is the start date.
 */
export function firstActualMeeting(minutes = [], hearings = []) {
  const hearingsById = new Map();
  for (const h of hearings || []) {
    if (h?.id) hearingsById.set(h.id, h);
  }

  let best = null;

  for (const row of minutes || []) {
    if (!meetingWasConducted(row)) continue;
    const hearing = hearingsById.get(row.hearing_id);
    const date = hearing?.hearing_date || null;
    if (!date) continue;

    const sortKey = `${date} ${String(hearing?.hearing_time || "")} ${String(row.hearing_id)}`;
    if (!best || sortKey < best.sortKey) {
      best = { sortKey, date, hearing, minutes: row };
    }
  }

  if (!best) return null;
  return {
    date: best.date,
    hearingId: best.hearing?.id || null,
    minutesId: best.minutes?.id || null,
    outcome: best.minutes?.outcome || null,
  };
}

/* ── Workflow steps ───────────────────────────────────────────── */

const TERMINAL_STATUSES = ["Resolved", "Closed", "Rejected"];

/* ── The statutory clocks ─────────────────────────────────────── */

/**
 * The three periods the Katarungang Pambarangay process runs on.
 * They are named constants rather than literals scattered through
 * the derivations, because every one of them is also quoted back to
 * the officer in the UI and to the resident in a case update.
 */
/** Captain mediation: "within fifteen (15) days from the first meeting". */
export const MEDIATION_PERIOD_DAYS = 15;
/** Pangkat: "within fifteen (15) days from its constitution". */
export const PANGKAT_PERIOD_DAYS = 15;
/** The extra 15 days a meritorious case may be granted, once. */
export const PANGKAT_EXTENSION_MAX_DAYS = 15;
/** A settlement binds "upon the expiry of ten (10) days". */
export const SETTLEMENT_EFFECTIVENESS_DAYS = 10;
/** The window in which either party may repudiate a settlement. */
export const REPUDIATION_WINDOW_DAYS = 10;

/** Barangay Abuno keeps Asia/Manila time: UTC+08:00, no DST. */
const MANILA_OFFSET_MS = 8 * 3600000;

/**
 * Milliseconds in a calendar day.
 *
 * `manilaDayNumber` converts a day to a day-number by dividing its
 * midnight timestamp, so it needs this constant. It was referenced but
 * never declared, which made every clock throw a ReferenceError the
 * moment it had a start date to count from — mediation, the Pangkat
 * period and the case deadline all failed silently and returned
 * nothing rather than reporting a day count.
 */
const DAY_MS = 86400000;

/**
 * The calendar day a value falls on, as Barangay Abuno keeps it.
 *
 * Every deadline here is counted in whole calendar days in the
 * barangay's own timezone, not in elapsed milliseconds. Reading
 * `new Date(value).getDate()` would use the *server's* timezone, so
 * a hearing held at 7:00 PM Manila on the 12th would be counted as
 * the 12th for a reviewer in Manila and as the 11th for a build
 * machine in UTC — and the same case would report a different day
 * of the period depending on who looked at it. Shifting by the
 * fixed +08:00 offset first makes the calendar day unambiguous.
 *
 * @returns {number|null} days since the epoch, or null when the
 *   value is missing or not a date.
 */
function manilaDayNumber(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const shifted = new Date(parsed.getTime() + MANILA_OFFSET_MS);
  return Math.floor(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) / DAY_MS);
}

/** `value` plus whole days, as the same kind of value it was given. */
function plusDays(value, days) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const shifted = new Date(parsed.getTime() + MANILA_OFFSET_MS);
  const atMidnight = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  atMidnight.setUTCDate(atMidnight.getUTCDate() + days);
  return atMidnight.toISOString();
}

/**
 * Whole calendar days between two Manila days, floored at zero.
 * A period runs "within" its number of days, so day 15 is still
 * inside it and only day 16 counts as lapsed.
 */
function daysSince(start, end = Date.now()) {
  const from = manilaDayNumber(start);
  const to = manilaDayNumber(end);
  if (from === null || to === null) return null;
  return Math.max(0, to - from);
}

/**
 * The 15-day Captain mediation period, as a clock.
 *
 * WHY THIS EXISTS
 *   "If the Barangay Captain fails to mediate the conflict within
 *   fifteen (15) days, the case moves to the Pangkat." That is a
 *   rule about elapsed time, and until now nothing in the workflow
 *   computed it: the officer had to notice the date themselves and
 *   remember that the second stage was now the required one.
 *
 * WHERE THE START COMES FROM
 *   Counted from the first recorded mediation meeting — the same
 *   anchor the DeadlineTracker panel already quotes — in the order
 *   the case can have recorded it: a saved Mediation phase, and
 *   then any hearing a meeting record says was conducted. When
 *   neither exists the clock has not started and it never reports
 *   itself as lapsed: a case the barangay simply has not met on
 *   yet is waiting for a hearing, not for the Pangkat.
 *
 * @param {object} complaint the complaint row
 * @param {{ kpPhases?: object[], hearings?: object[],
 *           attendances?: object[], minutes?: object[] }} ctx
 * @returns {{ started: boolean, start: string|null,
 *            deadline: string|null, elapsed: number,
 *            remaining: number|null, lapsed: boolean,
 *            settled: boolean }}
 */
export function mediationClockFor(complaint, ctx = {}) {
  const { kpPhases = [], hearings = [], attendances = [], minutes = [] } = ctx;

  const anchors = [];

  for (const phase of kpPhases || []) {
    if (
      String(phase?.phase_type || "").trim().toLowerCase() === "mediation" &&
      phase?.start_date
    ) {
      anchors.push(phase.start_date);
    }
  }

  for (const row of attendanceRowsFor(hearings, attendances, minutes)) {
    if (row?.held && row?.date) anchors.push(row.date);
  }

  const start = anchors.filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
  const settled = TERMINAL_STATUSES.includes(complaint?.current_status);

  if (!start) {
    return { started: false, start: null, deadline: null, elapsed: 0, remaining: null, lapsed: false, settled };
  }

  const elapsed = daysSince(start) ?? 0;
  return {
    started: true,
    start,
    deadline: plusDays(start, MEDIATION_PERIOD_DAYS),
    elapsed,
    remaining: Math.max(0, MEDIATION_PERIOD_DAYS - elapsed),
    // "within 15 days" — day 15 is still inside the period.
    lapsed: !settled && elapsed > MEDIATION_PERIOD_DAYS,
    settled,
  };
}

/**
 * Whether the recorded mediation outcome says the case did not settle.
 *
 * The Meeting Record's outcome is the officer's own account of what the
 * mediation produced, and "No settlement" is the one that hands the case
 * to the Pangkat: the second stage follows from that record whether or
 * not the fifteen days have run out. Without this the case file only
 * opened the Pangkat section once the clock lapsed, so an officer who
 * had just recorded "No settlement" found the selection UI still behind
 * a collapsed header.
 *
 * Only a conducted meeting counts — an outcome saved against a meeting
 * that did not take place says nothing — and only the most recent
 * conducted meeting counts, so a later hearing that settled the case
 * takes the case back out of the second stage. A case that has already
 * reached a disposition is not waiting on a Pangkat either, which is
 * the same rule `mediationClockFor` applies to `lapsed`.
 *
 * @param {object} complaint
 * @param {{ hearings?: object[], attendances?: object[], minutes?: object[] }} ctx
 * @returns {boolean}
 */
export function mediationFailedFor(complaint, ctx = {}) {
  if (TERMINAL_STATUSES.includes(complaint?.current_status)) return false;
  return latestMeetingOutcomeFor(ctx) === "No settlement";
}

/**
 * The outcome recorded on the latest meeting that actually took place,
 * or "" when no such meeting is on file.
 *
 * Shared by every rule that reads what the mediation produced. Rows
 * arrive earliest first, so the last conducted row is the most recent
 * meeting, and only a meeting an officer recorded as conducted speaks
 * for the case — a schedule or a cancelled session says nothing. This
 * deliberately has no terminal-status guard: `mediationFailedFor`
 * applies that rule itself, while the settlement rule below must read
 * the outcome even on a closed case to know whether the close still
 * holds.
 *
 * @param {{ hearings?: object[], attendances?: object[], minutes?: object[] }} ctx
 * @returns {string}
 */
export function latestMeetingOutcomeFor(ctx = {}) {
  const { hearings = [], attendances = [], minutes = [] } = ctx;
  const conducted = attendanceRowsFor(hearings, attendances, minutes).filter(
    (row) => row?.held && row?.meeting?.outcome
  );
  return conducted[conducted.length - 1]?.meeting?.outcome || "";
}

/**
 * The stage stamped on a complaint when its settlement closes it.
 *
 * It doubles as the marker that tells this close apart from every other
 * way of reaching `Closed` — an archived record, an intake close — so
 * the rule only ever reopens the cases it closed itself, and only while
 * their stage still says so.
 */
export const SETTLEMENT_CLOSED_STAGE = "Case Closed — Amicable Settlement";

/**
 * What the "settled and documented" rule asks for on this case, if
 * anything: close it, reopen it, or leave it alone.
 *
 * WHY THIS EXISTS
 *   The Captain stamps a case Closed the moment both halves of a settled
 *   ending are on file: the recorded outcome says the parties agreed,
 *   AND the Amicable Settlement that writes that agreement down has been
 *   generated. Either half alone leaves the case open — a Meeting Record
 *   without its paper still owes the document, and the paper without a
 *   settlement record proves nothing about what the parties decided.
 *
 * THE RULE
 *   close    an active Amicable Settlement is on file, the latest
 *            conducted meeting recorded "Settled" (or, when no meeting
 *            record exists at all, a settlement was formally recorded
 *            on Resolution & Outcomes), the settlement has not been
 *            repudiated — and the case is not already Closed or
 *            Rejected. A Resolved case holding its document is closed
 *            by this rule too: the document is what the settled ending
 *            owed, and it is now on file.
 *
 *   reopen   the case is Closed by this very rule (its stage still
 *            reads SETTLEMENT_CLOSED_STAGE) and one of those conditions
 *            has since stopped holding: the outcome was corrected to
 *            something other than "Settled", the settlement was
 *            repudiated, or the document was revoked. The case must not
 *            sit behind a disposition its own record no longer supports
 *            — there is no action offered on a Closed case, so a
 *            stranded case could never be put right.
 *
 *   null     everything else. An archived record and a rejection are
 *            never reopened (their stage does not carry the marker), a
 *            case already closed by the rule asks for nothing again,
 *            and so does any case the rule does not concern.
 *
 * Everything read here is a persisted column — the Meeting Record, the
 * document's status, the resolution row, and the complaint's own
 * status and stage. Nothing is inferred from a label or the calendar.
 *
 * @param {object} complaint
 * @param {{ hearings?: object[], attendances?: object[], minutes?: object[],
 *           documents?: object[], caseResolution?: object|null }} ctx
 * @returns {"close"|"reopen"|null}
 */
export function settlementCloseDecisionFor(complaint, ctx = {}) {
  if (!complaint?.id || complaint.isDemo) return null;
  const status = complaint.current_status;
  if (status === "Rejected") return null;

  const { documents = [], caseResolution = null } = ctx;
  const settlementOnFile = (documents || []).some(
    (doc) =>
      doc?.document_type === "settlement" && !INACTIVE_DOCUMENT_STATUSES.includes(doc?.status)
  );

  // The Meeting Record governs whenever there is one — it is the
  // officer's own account of what happened, so correcting it away from
  // "Settled" must take the case back out of the closed state. The
  // recorded settlement covers the cases that never got a Meeting
  // Record but recorded and attested their agreement on the tab.
  const outcome = latestMeetingOutcomeFor(ctx);
  const settled = outcome ? outcome === "Settled" : Boolean(caseResolution?.settlement_date);

  const eligible = settlementOnFile && settled && !caseResolution?.repudiated;

  if (eligible && status !== "Closed") return "close";
  if (status === "Closed" && complaint.current_stage === SETTLEMENT_CLOSED_STAGE && !eligible) {
    return "reopen";
  }
  return null;
}

/**
 * The Pangkat's own 15-day period, counted from when the panel
 * officially convened, plus any extension that has been approved.
 *
 * The tracker's clock starts only on convening and never before, so
 * a panel that has been constituted but not yet convened reports
 * no day count at all — the same answer the Lupon portal gives,
 * because both read pangkat_trackers.
 *
 * @param {{ pangkatTracker?: object|null }} ctx
 */
export function pangkatWindowFor(ctx = {}) {
  const tracker = ctx.pangkatTracker || null;
  const convenedAt = tracker?.convenes_at || null;

  if (!convenedAt) {
    return {
      convened: false,
      convenedAt: null,
      deadline: null,
      elapsed: 0,
      totalDays: tracker?.period_days || PANGKAT_PERIOD_DAYS,
      extensionDays: tracker?.extension_days || 0,
      remaining: null,
      lapsed: false,
      concluded: false,
    };
  }

  const totalDays = (tracker?.period_days || PANGKAT_PERIOD_DAYS) + (tracker?.extension_days || 0);
  const elapsed = daysSince(convenedAt) ?? 0;
  const concluded = Boolean(tracker?.concluded_at) ||
    ["Concluded", "Terminated"].includes(tracker?.status);

  return {
    convened: true,
    convenedAt,
    deadline: plusDays(convenedAt, totalDays),
    elapsed,
    totalDays,
    extensionDays: tracker?.extension_days || 0,
    remaining: Math.max(0, totalDays - elapsed),
    // A concluded panel keeps reporting the period it finished, not
    // a period that is still running against today's date.
    lapsed: !concluded && elapsed > totalDays,
    concluded,
  };
}

/**
 * Has the Pangkat actually been constituted on this case?
 *
 * Constituted means three members have been recorded — the panel
 * the statute requires. One or two names are a partial selection,
 * not a panel, and the second stage has not begun.
 */
export function isPangkatConstituted(luponPanels = []) {
  const active = (luponPanels || []).filter((row) => row?.status === "active");
  return new Set(active.map((row) => row?.member_id).filter(Boolean)).size >= 3;
}

/**
 * The complaint-centred progress track shown on the Captain's page.
 *
 * Every step's state is derived from persisted columns. A step is
 * "done" only when the column that records it is set; a step is
 * "current" only when the case is actually sitting in it. Nothing is
 * marked complete because the case simply moved past it.
 */
export function workflowStepsFor(complaint, ctx = {}) {
  const {
    hearings = [],
    attendances = [],
    minutes = [],
    summons = [],
    serviceRecords = [],
    documents = [],
    blotterRecord = null,
    kpPhases = [],
    luponPanels = [],
    pangkatTracker = null,
  } = ctx;

  const summonsState = summonsStateFor({ summons, serviceRecords, documents, hearings });
  const attendanceRows = attendanceRowsFor(hearings, attendances, minutes);
  const absence = absenceSummaryFor(attendances);
  const stage = complaint?.current_stage || complaint?.current_status || "";

  const received = Boolean(
    complaint?.official_received_at || complaint?.received_at
  );
  const completenessDone =
    complaint?.completeness_status === "complete" ||
    complaint?.completeness_status === "duplicate" ||
    complaint?.completeness_status === "invalid_unrelated";
  const respondentRecorded = respondentStateOf(complaint) !== "pending";
  const respondentIdentified = hasIdentifiedRespondent(complaint);
  const classified = Boolean(complaint?.confirmed_category || complaint?.confirmed_urgency);
  const routed = Boolean(complaint?.routing_status) &&
    complaint.routing_status !== "pending_assessment";
  // "Held" is true only where a saved meeting record says the meeting
  // was conducted. It used to also be true for any hearing with an
  // attendance row, which meant a case sitting in the future could
  // report its mediation hearing as already over.
  const hearingHeld = attendanceRows.some((r) => r.held);
  const settled = TERMINAL_STATUSES.includes(complaint?.current_status);
  const mediationClock = mediationClockFor(complaint, { kpPhases, hearings, attendances, minutes });
  const pangkatConstituted = isPangkatConstituted(luponPanels);
  const pangkatWindow = pangkatWindowFor({ pangkatTracker });

  const steps = [];

  steps.push({
    key: "filed",
    label: "Complaint Filed",
    detail: complaint?.submitted_at
      ? `Resident submitted the complaint on ${shortDate(complaint.submitted_at)}.`
      : "Complaint submitted by a resident.",
    done: Boolean(complaint?.submitted_at),
    current: !complaint?.submitted_at,
  });

  steps.push({
    key: "reviewed",
    label: "Complaint Reviewed",
    detail: completenessDone
      ? `Completeness review recorded: ${labelise(complaint?.completeness_status)}.`
      : routed
        ? "Routing assessment has been recorded on this case."
        : "Awaiting the Captain's completeness review.",
    done: Boolean(completenessDone || routed),
    current: !completenessDone && !routed,
  });

  steps.push({
    key: "situation",
    label: respondentIdentified ? "Respondent Identified" : "Complaint Situation Recorded",
    detail: respondentIdentified
      ? `Respondent recorded as ${respondentDisplay(complaint).label}.`
      : respondentRecorded
        ? `Respondent recorded as ${respondentDisplay(complaint).label}.`
        : "The nature of the complaint has not been assessed yet.",
    done: respondentRecorded,
    current: !respondentRecorded,
  });

  steps.push({
    key: "classified",
    label: "Classified",
    detail: classified
      ? `${complaint.confirmed_category || complaint.confirmed_case_type || "Category"} · ${
          complaint.confirmed_urgency || "urgency pending"
        }`
      : complaint?.predicted_category || complaint?.predicted_case_type
        ? `AI suggestion: ${complaint.predicted_category || complaint.predicted_case_type}${
            complaint.predicted_urgency ? ` · ${complaint.predicted_urgency}` : ""
          } — awaiting official confirmation.`
        : "No classification is available yet.",
    done: classified,
    current: !classified && routed,
  });

  if (isUnidentifiedIncident(complaint)) {
    // The incident pathway stops here on purpose: there is no summons and
    // no hearing, because there is nobody to put on notice.
    steps.push({
      key: "incident",
      label: blotterRecord ? "Blotter Record Opened" : "Identification / Investigation",
      detail: blotterRecord
        ? `Blotter record ${blotterRecord.blotter_number} is linked to this complaint.`
        : "The barangay is recording what is known about the incident and working toward identifying a suspect.",
      done: Boolean(blotterRecord),
      current: !blotterRecord,
    });
  } else {
    const heldRows = attendanceRows.filter((r) => r.held);
    const upcomingRows = attendanceRows.filter((r) => r.lifecycle?.scheduled);

    steps.push({
      key: "summons",
      label: "Notice of Hearing",
      detail: summonsState.detail,
      done: summonsState.index >= 2,
      current: summonsState.index === 1,
    });

    steps.push({
      key: "hearing",
      label: heldRows.length ? "Mediation Hearing Held" : "Mediation Hearing",
      detail: attendanceRows.length
        ? `${attendanceRows.length} hearing${attendanceRows.length === 1 ? "" : "s"} on record · ${
            heldRows.length
          } held · ${absence.respondent.absent} recorded absence${
            absence.respondent.absent === 1 ? "" : "s"
          }.`
        : "No hearing has been scheduled yet.",
      // Done when a meeting record says the meeting happened, or when the
      // case has been disposed of. Not done because a number was reached.
      done: heldRows.length > 0 || settled,
      current: !heldRows.length && upcomingRows.length > 0 && !settled,
    });

    /**
     * Second stage. The Pangkat is not an optional next step the
     * officer may or may not reach — it is where the case goes when
     * Captain mediation has had its fifteen days and the conflict is
     * still live — so it has a step of its own rather than being
     * implied by the disposition one.
     */
    steps.push({
      key: "pangkat",
      label: pangkatConstituted ? "Pangkat Tagapagkasundo Convened" : "Pangkat Tagapagkasundo",
      detail: settled
        ? pangkatConstituted
          ? `The Pangkat convened and the case was later recorded as ${complaint.current_stage || complaint.current_status}.`
          : "Not reached — the case was disposed of during Captain mediation."
        : pangkatConstituted
          ? pangkatWindow.convened
            ? `Convened ${shortDate(pangkatWindow.convenedAt)} · day ${Math.min(
                pangkatWindow.elapsed,
                pangkatWindow.totalDays
              )} of ${pangkatWindow.totalDays}${
                pangkatWindow.extensionDays ? ` (incl. ${pangkatWindow.extensionDays}-day extension)` : ""
              } · ${
                pangkatWindow.concluded
                  ? "result recorded"
                  : pangkatWindow.lapsed
                    ? "period elapsed"
                    : `${pangkatWindow.remaining} day${pangkatWindow.remaining === 1 ? "" : "s"} left`
              }.`
            : "Panel selected — the 15-day period starts only when it officially convenes."
          : mediationClock.lapsed
            ? `Captain mediation ran past its ${MEDIATION_PERIOD_DAYS}-day period (started ${shortDate(
                mediationClock.start
              )}) without a settlement. The case now goes to the three-member Pangkat.`
            : mediationClock.started
              ? `Only reached if Captain mediation does not settle the case within ${MEDIATION_PERIOD_DAYS} days — ${mediationClock.remaining} left.`
              : `Only reached if Captain mediation does not settle the case within ${MEDIATION_PERIOD_DAYS} days.`,
      done: pangkatConstituted || settled,
      current: !pangkatConstituted && !settled && mediationClock.lapsed,
    });
  }

  steps.push({
    key: "disposition",
    label: settled ? "Disposition Recorded" : "Disposition",
    detail: settled
      ? `Case recorded as ${complaint.current_stage || complaint.current_status}.`
      : stage
        ? `Currently at: ${stage}.`
        : "No disposition has been recorded yet.",
    done: settled,
    current: !settled && hearingHeld,
  });

  /**
   * Normalise to ONE current step, in order.
   *
   * Each `done` flag above is a fact about a different table — a completeness
   * review, a respondent column, a confirmed category, a meeting record — so
   * they are computed independently, and a case can easily satisfy a later
   * step while an earlier one is still open. Rendered as-is, two steps would
   * light up as "current" at once, and a progress bar that shows two places
   * at once is not a progress bar.
   *
   * The first unfinished step is the one the case is actually waiting on.
   * Everything before it stays done, everything at or after it is simply not
   * current. No `done` flag is rewritten: completed work is reported as
   * completed, and only the marker of "now" is corrected.
   */
  const firstOpen = steps.findIndex((step) => !step.done);
  steps.forEach((step, index) => {
    step.current = index === firstOpen;
  });

  return steps;
}

/**
 * The single "current action" / "next action" pair for a complaint.
 * Uses the same routing vocabulary the existing CTA logic uses, so the
 * card and the case file name the same step.
 */
export function currentAndNextAction(complaint, ctx = {}) {
  const { hearings = [], attendances = [], minutes = [], summons = [], serviceRecords = [], documents = [], blotterRecord = null } =
    ctx;

  const attendanceRows = attendanceRowsFor(hearings, attendances, minutes);
  const absence = absenceSummaryFor(attendances);
  const summonsState = summonsStateFor({ summons, serviceRecords, documents, hearings });
  const status = complaint?.routing_status || "pending_assessment";

  const terminal = ["closed", "withdrawn", "rejected", "resolved_at_intake"].includes(status);
  if (terminal) {
    return {
      current: `Case file closed${complaint?.routing_status ? ` (${labelise(complaint.routing_status)})` : ""}.`,
      next: "No further action. The record remains available for reference.",
      tone: "neutral",
    };
  }

  if (isUnidentifiedIncident(complaint)) {
    return {
      current: blotterRecord
        ? `Identification / investigation - blotter ${blotterRecord.blotter_number} is linked.`
        : "Identification / investigation - recording what is known about the incident.",
      next: blotterRecord
        ? "Update this complaint once the suspect or respondent has been identified."
        : "Record what is known about the incident and open or link a blotter record to identify the suspect.",
      tone: "critical",
    };
  }

  if (status === "pending_assessment" || complaint?.completeness_status === "pending_review") {
    return {
      current: "Complaint review - the submission has not been checked yet.",
      next: "Review the complaint, record its situation, and confirm the AI classification.",
      tone: "warning",
    };
  }

  if (!hasIdentifiedRespondent(complaint)) {
    return {
      current: `Respondent assessment - ${respondentDisplay(complaint).label}.`,
      next: "Confirm or update the respondent assessment. Summons and mediation stay unavailable until a respondent is identified.",
      tone: "warning",
    };
  }

  const upcoming = attendanceRows.find((r) => r.lifecycle?.scheduled);

  if (upcoming) {
    return {
      current: `Mediation hearing scheduled - ${shortDate(upcoming.date)}${
        upcoming.time ? ` at ${upcoming.time}` : ""
      }.`,
      // Attendance and the meeting record are separate acts. Saving
      // who attended never marks the hearing held, so the instruction
      // names the two steps the officer actually has to take.
      next: "After the hearing, record each party's attendance, then save the Meeting Record with what was conducted and decided.",
      tone: "action",
    };
  }

  // No hearing is still to happen. Whatever is left is about what
  // actually happened at the ones that already did.
  const unrecorded = attendanceRows.find((r) => !r.held && !r.meetingRecorded);
  if (unrecorded) {
    return {
      current: `Hearing on ${shortDate(unrecorded.date)} has no meeting record.`,
      next: "Record whether the meeting took place, the attendance of each party, and the outcome.",
      tone: "action",
    };
  }

  const unverified = attendanceRows.find((r) => r.lifecycle?.heldWithoutRecord);
  if (unverified) {
    return {
      current: `Hearing on ${shortDate(unverified.date)} is marked completed with no meeting record.`,
      next: unverified.lifecycle?.detail || "Record what actually happened at this hearing.",
      tone: "warning",
    };
  }

  const notConducted = attendanceRows.find((r) => r.meetingRecorded && !r.meeting?.conducted);
  if (notConducted) {
    return {
      current: `The meeting on ${shortDate(notConducted.date)} is recorded as not conducted.`,
      next: "Reschedule the hearing or cancel it with a reason.",
      tone: "action",
    };
  }

  const noOutcome = attendanceRows.find(
    (r) => r.meeting?.conducted === "Yes" && !r.meeting?.outcome
  );
  if (noOutcome) {
    return {
      current: `The meeting on ${shortDate(noOutcome.date)} has no recorded outcome.`,
      next: "Record the outcome of that meeting.",
      tone: "action",
    };
  }

  const lastHeld = [...attendanceRows].reverse().find((r) => r.held);
  if (lastHeld) {
    return {
      current: `Mediation held on ${shortDate(lastHeld.date)} - outcome: ${lastHeld.meeting?.outcome || "not recorded"}.`,
      next:
        lastHeld.meeting?.outcome === "Continued"
          ? "Schedule the next mediation hearing."
          : "Record the disposition of this case.",
      tone: "action",
    };
  }

  if (attendanceRows.length) {
    return {
      current: absence.headline,
      next: "Record the next hearing or the outcome of mediation.",
      tone: "action",
    };
  }

  if (summonsState.index >= 2) {
    return {
      current: summonsState.detail,
      next: "Schedule the mediation hearing.",
      tone: "action",
    };
  }

  return {
    current: "Respondent identified - preparing the party process.",
    next: "Prepare and issue the summons, then schedule the mediation hearing.",
    tone: "action",
  };
}

/** Contextual primary action for a complaint, per the requested button rules. */
export function primaryActionFor(complaint, ctx = {}) {
  const { hearings = [], attendances = [], minutes = [], summons = [], serviceRecords = [], documents = [] } = ctx;
  const attendanceRows = attendanceRowsFor(hearings, attendances, minutes);
  const summonsState = summonsStateFor({ summons, serviceRecords, documents, hearings });
  const status = complaint?.routing_status || "pending_assessment";

  if (["closed", "withdrawn", "rejected", "resolved_at_intake"].includes(status)) {
    return null;
  }

  if (isUnidentifiedIncident(complaint)) {
    return { label: "Update Progress", kind: "routing" };
  }

  if (!hasIdentifiedRespondent(complaint) || complaint?.completeness_status === "pending_review") {
    return { label: "Review", kind: "routing" };
  }

  if (summonsState.index < 2) {
    return { label: "Prepare / Issue Summons", kind: "hearings" };
  }

  const upcoming = attendanceRows.find((r) => r.lifecycle?.scheduled);
  if (upcoming) {
    // Meeting record, not attendance alone. Recording who was in the
    // room does not close the hearing out, so the button names the step
    // that actually closes it.
    return { label: "Record Meeting Record", kind: "hearings" };
  }

  const needsRecord = attendanceRows.some(
    (r) => !r.held && (!r.meetingRecorded || !r.meeting?.outcome)
  );
  if (needsRecord) {
    return { label: "Record Meeting Record", kind: "hearings" };
  }

  if (attendanceRows.length) {
    return { label: "Update Progress", kind: "hearings" };
  }

  return { label: "Record / Update Hearing", kind: "hearings" };
}

/* ── The single next action ──────────────────────────────────── */

/** Routes that end a case file. No action is offered on any of them. */
const CLOSED_ROUTES = ["closed", "withdrawn", "rejected", "resolved_at_intake"];

/** Statuses that mean disposition has been recorded. */
const DISPOSITION_STATUSES = ["Resolved", "Closed", "Rejected"];

/** An `official_documents` status that no longer points at a live file. */
const INACTIVE_DOCUMENT_STATUSES = ["superseded", "revoked"];

/**
 * Is rejecting this complaint still a valid action right now?
 *
 * Mirrors STAGE_ACTIONS in complaintMeta.js: rejection is an information-check
 * and categorization decision. Once the case is in mediation or conciliation
 * the route — not the status — is what ends it, so offering "Reject" there
 * would put two different ways of ending a case in front of the officer.
 */
function rejectionStillValid(complaint) {
  const status = complaint?.current_status;
  if (DISPOSITION_STATUSES.includes(status)) return false;
  if (status === "For Official Categorization") return true;
  if (["Received", "In Progress", "Awaiting Meeting"].includes(status)) return false;
  return true;
}

/**
 * The ONE next official action for a complaint.
 *
 * WHY THIS EXISTS
 *   The case file used to offer two competing entry points: a primary button
 *   derived from one rule set, and a generic "Official Action" button that
 *   opened a picker over a second. An officer had to guess which of the two
 *   carried the step the case was actually waiting for.
 *
 *   This returns exactly one action, derived only from the complaint's own
 *   recorded columns and the saved hearings/documents — never from which
 *   section happens to be open. The ladder is the case flow itself:
 *
 *     Review → Receive & Docket → Review Classification → Open Case Routing
 *            → Schedule Hearing → Generate Notice → Record Outcome
 *
 *   with one branch in it: once the fifteen days of Captain mediation
 *   have run out without a settlement, the rung after the Notice is
 *   "Constitute Pangkat Tagapagkasundo" rather than "Record Outcome",
 *   because the second stage is required by law and not optional.
 *
 *   A rung is only reached when every rung before it is satisfied, so the
 *   panel never offers an action the case is not ready for, and a case that
 *   has closed returns null rather than a button that does nothing.
 *
 * ONE-PARTY CASES
 *   A complaint with no respondent to summon never reaches the hearing rungs:
 *   routing settles it into documentation, referral or service, and the
 *   existing derivation (primaryActionFor) describes that path. Rather than
 *   invent a rung for it, the ladder hands over to it.
 *
 * @param {object} complaint the complaint row
 * @param {{ hearings?: object[], documents?: object[] }} ctx case bundle
 * @returns {null | { key, label, hint, kind, section, focus?, workflowAction?,
 *                    secondary: object[] }}
 *   `kind` is where the button goes: "routing" opens the routing section on
 *   `focus`, "hearings" opens `section`, "workflow" opens the compact action
 *   modal on `workflowAction`.
 */
export function nextOfficialAction(complaint, ctx = {}) {
  const { hearings = [], documents = [] } = ctx;  const c = complaint || {};
  const route = c.routing_status || "pending_assessment";
  const secondary = rejectionStillValid(c)
    ? [
        {
          key: "reject",
          label: "Reject Complaint",
          hint: "Record that this complaint was not accepted. A written reason is required.",
          workflowAction: "reject",
        },
      ]
    : [];

  /**
   * A case that has reached its disposition is not offered anything else.
   *
   * The document an outcome owes is produced while the case is still
   * open — the ladder points at it before "Record Outcome", and
   * Resolution & Outcomes holds the generator afterwards whether or not
   * the case file has any action left. A case marked Resolved, Closed
   * or Rejected must never come back asking the officer for a next
   * step, which is what the regression test in scripts/test-actions.mjs
   * pins down.
   */
  if (CLOSED_ROUTES.includes(route) || DISPOSITION_STATUSES.includes(c.current_status)) {
    return null;
  }

  // 1 ─ Review. The single initial action, and only ever about the
  // information check: completeness, who the other party is, and a basic
  // assessment. Summons, mediation and disposition are not part of it.
  if (!c.completeness_status || c.completeness_status === "pending_review") {
    return {
      key: "review",
      label: "Review Complaint",
      hint:
        "Check the submission for completeness, confirm the respondent named in it, and record a basic assessment.",
      kind: "routing",
      focus: "completeness",
      section: "routing",
      secondary,
    };
  }

  // 2 ─ Receive & Docket. Only when the review concluded the submission is
  // one the barangay can accept: a submission still marked "needs more
  // information" (or a duplicate) has to go back through the routing
  // assessment first, not be docketed.
  if (!c.official_received_at && c.completeness_status === "complete") {
    return {
      key: "receive",
      label: "Receive & Docket Complaint",
      hint:
        "Issue the Barangay Case Number, stamp the official receipt and start the official categorization. The copy the resident submitted is kept as it was filed.",
      kind: "workflow",
      workflowAction: "receive",
      section: "routing",
      secondary,
    };
  }

  // 3 ─ Review Classification. Both fields are needed: an official category
  // with no official urgency (or the reverse) is only half a decision.
  //
  // Only reached for a submission the barangay has actually accepted. A
  // submission still marked "needs information", or one the review found to
  // be a duplicate, cannot be classified — there is no case yet to give a
  // category — so it falls through to the routing rung, which is where the
  // review itself is re-opened or the record is closed out.
  if (
    c.completeness_status === "complete" &&
    (!c.confirmed_category || !c.confirmed_urgency)
  ) {
    return {
      key: "classify",
      label: "Review Classification",
      hint:
        "Verify the category and urgency against the complaint and its evidence, and confirm them officially.",
      kind: "routing",
      focus: "categorization",
      section: "classification",
      secondary,
    };
  }

  // 4 ─ Open Case Routing. A route has been decided, or a route is being
  // waited on; either way this is the assessment the case needs.
  if (route === "pending_assessment" || route === "request_additional_information") {
    return {
      key: "routing",
      label: "Open Case Routing",
      hint:
        "Decide — or re-decide — where this case goes, and confirm the respondent and KP applicability that the next steps depend on.",
      kind: "routing",
      focus: null,
      section: "routing",
      secondary,
    };
  }

  // An older case may have a saved route and hearing while its recorded status
  // is still at official categorization. Never offer a disposition action that
  // the case's own stage cannot execute. Let an officer reconcile the recorded
  // stage and decision; do not silently advance or alter the case.
  if (c.current_status === "For Official Categorization") {
    return {
      key: "classify",
      label: "Review Classification",
      hint: "This case is still recorded as awaiting official categorization. Verify the decision before proceeding.",
      kind: "routing",
      focus: "categorization",
      section: "classification",
      secondary,
    };
  }

  // 5 ─ The party-facing ladder. Only reachable once routing is settled:
  // schedule the hearing, produce the notice it needs, then record what
  // came of it.
  if (isRoutingComplete(c)) {
    const scheduled = hearings.some((h) => h && h.status !== "Cancelled");
    if (!scheduled) {
      return {
        key: "schedule",
        label: "Schedule Hearing",
        hint: "Set the date and time of the mediation hearing both parties are to attend.",
        kind: "hearings",
        section: "mediation",
        secondary,
      };
    }

    const hasNotice = documents.some(
      (d) =>
        d?.document_type === "hearing_notice" &&
        !INACTIVE_DOCUMENT_STATUSES.includes(d?.status)
    );
    if (!hasNotice) {
      return {
        key: "notice",
        label: "Generate Notice of Hearing",
        hint:
          "Produce the official Notice of Hearing for the saved schedule. Rescheduling later issues a new version and keeps this one on file.",
        kind: "hearings",
        section: "documents",
        secondary,
      };
    }

    if (!DISPOSITION_STATUSES.includes(c.current_status)) {
      /**
       * The statutory second stage.
       *
       * If Captain mediation has had its fifteen days without a
       * settlement, the case does not simply sit waiting for the
       * officer to remember the Pangkat exists — it moves there, and
       * this is the rung that says so. Constituting the Pangkat is
       * itself the action offered, so pressing the one button the
       * case file points at performs it.
       *
       * It is only offered while the case has no panel yet. Once
       * three members are recorded the second stage is under way and
       * what the case is waiting for is the panel's result, which is
       * an outcome like any other.
       */
      const mediation = mediationClockFor(c, ctx);
      const panelConstituted = isPangkatConstituted(ctx.luponPanels || []);
      if (mediation.lapsed && !panelConstituted) {
        return {
          key: "pangkat",
          label: "Constitute Pangkat Tagapagkasundo",
          hint: `Captain mediation ran past its ${MEDIATION_PERIOD_DAYS}-day period${
            mediation.start ? ` (started ${shortDate(mediation.start)})` : ""
          } without a settlement. The case now goes to a three-member Pangkat: one member chosen by each party, and the third by those two.`,
          kind: "workflow",
          workflowAction: "startPangkat",
          section: "pangkat",
          secondary,
        };
      }

      /**
       * The panel's own hearing.
       *
       * A constituted Pangkat still needs somewhere to sit. The
       * sessions on file before it existed belong to the mediation
       * that just failed, so what the case is now waiting for is a
       * hearing on or after the day the panel was constituted — and
       * the ${PANGKAT_PERIOD_DAYS} days the panel has to settle the
       * case run from the day it convenes, not from the filing date.
       *
       * Offered only while no such session exists, so scheduling one
       * moves the case forward instead of offering the same step
       * forever.
       */
      if (panelConstituted) {
        const panelSince = earliestDate(ctx.luponPanels, "created_at");
        const hasPanelHearing = hearings.some(
          (h) =>
            h &&
            h.status !== "Cancelled" &&
            h.hearing_date &&
            (!panelSince || String(h.hearing_date).slice(0, 10) >= panelSince),
        );
        if (!hasPanelHearing) {
          return {
            key: "pangkat_hearing",
            label: "Schedule Pangkat Conciliation Hearing",
            hint: `The Pangkat is constituted. Set the hearing the three members will sit at — the panel has ${PANGKAT_PERIOD_DAYS} days from the day it convenes to settle the case.`,
            kind: "hearings",
            section: "mediation",
            secondary,
          };
        }
      }

      // What the recorded outcome still owes on paper, before the case is
      // asked to record anything else.
      const owedDoc = owedResolutionDocumentRung(c, ctx, documents, secondary);
      if (owedDoc) return owedDoc;

      return {
        key: "outcome",
        label: "Record Outcome",
        hint:
          "Record how the mediation ended: a settlement, or completion without one.",
        kind: "workflow",
        // The two ways a mediation ends. Naming both keeps the modal down to
        // the outcome choice instead of offering to schedule another hearing
        // the case has already had.
        workflowAction: "settled,completed",
        section: "mediation",
        secondary,
      };
    }

    return null;
  }

  // 6 ─ One-party, referral and incident paths have no hearing to schedule,
  // so they are described by the existing derivation rather than by a rung
  // invented here. Its own labels apply verbatim.
  const fallback = primaryActionFor(complaint, ctx);
  if (!fallback) return null;
  return { ...fallback, key: "progress", section: fallback.kind === "hearings" ? "mediation" : "routing", secondary };
}

/* ── Small helpers ────────────────────────────────────────────── */

function labelise(value) {
  if (!value) return "";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function shortDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A stored `date` as the same phrase shortDate() produces.
 *
 * `shortDate()` builds a Date, which reads a bare "YYYY-MM-DD" as UTC
 * midnight and can print the previous day on a machine west of UTC. A
 * settlement date or a certificate date is a calendar fact, not a
 * moment, so its parts are read out of the stored text instead.
 */
function shortCaseDate(value) {
  if (!value) return "—";
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return shortDate(value);
  const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The earliest calendar date on any row of a list, as "YYYY-MM-DD".
 *
 * Asks "did anything happen on or after the day the Pangkat was
 * constituted?" Comparing the stored dates as text keeps that boundary
 * on the barangay's calendar instead of letting the generating
 * machine's clock move it.
 */
function earliestDate(rows, field) {
  const values = (rows || [])
    .map((row) => (row && row[field] ? String(row[field]).slice(0, 10) : null))
    .filter(Boolean)
    .sort();
  return values.length ? values[0] : null;
}

/**
 * The document a recorded outcome still owes, when none is on file.
 *
 * The two endings the process exists to reach are the two that leave
 * something in the officer's hands: a settlement that must be written
 * down and attested, and a failed conciliation that must be certified
 * so the complainant can go to court. Until the paper exists the case
 * file points at producing it — and it keeps pointing there after the
 * case itself has been marked Settled or Completed, because a
 * disposition does not print the document by itself.
 *
 * @returns {object|null} a ladder rung, or null when nothing is owed.
 */
function owedResolutionDocumentRung(complaint, ctx, documents, secondary) {
  const resolution = ctx?.caseResolution || null;
  if (!resolution) return null;

  const onFile = (type) =>
    (documents || []).some(
      (d) => d && d.document_type === type && !INACTIVE_DOCUMENT_STATUSES.includes(d.status),
    );

  if (resolution.settlement_date && !onFile("settlement")) {
    return {
      key: "settlement_doc",
      label: "Generate Amicable Settlement",
      hint:
        `Both parties signed the settlement on ${shortCaseDate(resolution.settlement_date)}. ` +
        "Produce it for both parties — the terms, the attestation, and the day it acquires " +
        "the force of a court judgment.",
      kind: "hearings",
      section: "resolution",
      secondary,
    };
  }

  if (resolution.cfa_required && !onFile("certificate_to_file_action")) {
    return {
      key: "cfa_doc",
      label: "Generate Certificate to File Action",
      hint:
        `Conciliation failed${
          resolution.cfa_issued_at
            ? ` and the certificate was released on ${shortCaseDate(resolution.cfa_issued_at)}`
            : ""
        }. Produce the certificate that lets the complainant file the case in the proper court.`,
      kind: "hearings",
      section: "resolution",
      secondary,
    };
  }

  return null;
}

/* ── Data access ──────────────────────────────────────────────── */

/**
 * The Captain complaints list context: the shared list context plus the
 * summons, service, document and attendance rows the workflow tracker
 * needs.
 *
 * The shared fetchComplaintsContext() is reused rather than copied so
 * the Captain list and the OIC/Secretary lists cannot drift on the
 * complaint fields they share. Only the additional workflow tables are
 * new, and they are fetched tolerantly: if a migration has not been
 * applied the tracker shows "not recorded" instead of breaking the page.
 */
export async function fetchCaptainComplaintsContext(supabase) {
  const base = await fetchComplaintsContext(supabase);

  const [summonsRes, serviceRes, documentsRes, attendancesRes, luponRes, pangkatRes] =
    await Promise.all([
      supabase
        .from("summons")
        .select("id, complaint_id, hearing_id, storage_path, issued_at, created_at"),
      supabase
        .from("summons_service_records")
        .select(
          "id, complaint_id, summons_id, party_role, party_label, mode_of_service, served_on, served_to, notes, created_at"
        ),
      supabase
        .from("official_documents")
        .select("id, complaint_id, document_type, title, status, visibility, storage_path, created_at"),
      supabase
        .from("hearing_attendances")
        .select("id, complaint_id, hearing_id, attendee_label, party_role, attended, attendance_status, minutes, created_at"),
      // The Pangkat members chosen for each party, and the panel's own
      // 15-day clock. The second stage cannot be reported without them,
      // so they belong in the captain context rather than in the shared
      // one every portal reads.
      supabase
        .from("lupon_panels")
        .select(
          "id, complaint_id, member_id, role, selected_by, status, assigned_by, assigned_at, created_at"
        ),
      supabase
        .from("pangkat_trackers")
        .select(
          "id, complaint_id, convenes_at, convened_by, period_days, extension_days, status, concluded_at, conclusion_note"
        ),
    ]);

  const groupByComplaint = (rows) => {
    const out = {};
    for (const row of rows || []) {
      if (!row.complaint_id) continue;
      (out[row.complaint_id] ||= []).push(row);
    }
    return out;
  };

  const summonsMap = groupByComplaint(summonsRes.error ? [] : summonsRes.data);
  const serviceMap = groupByComplaint(serviceRes.error ? [] : serviceRes.data);
  const documentsMap = groupByComplaint(documentsRes.error ? [] : documentsRes.data);
  const attendanceMap = groupByComplaint(attendancesRes.error ? [] : attendancesRes.data);
  const luponPanelsMap = groupByComplaint(luponRes.error ? [] : luponRes.data);

  // The Pangkat tracker is one row per complaint, so a keyed map
  // rather than a group.
  const pangkatTrackerMap = {};
  if (!pangkatRes.error) {
    for (const row of pangkatRes.data || []) {
      if (row?.complaint_id) pangkatTrackerMap[row.complaint_id] = row;
    }
  }

  // kp_phases rows are keyed by tracker, and the shared context already
  // holds the tracker for every complaint. Flipping that into a
  // per-complaint map lets the 15-day mediation clock be derived from
  // the list context without another query.
  const kpPhasesMap = {};
  if (!base.error) {
    for (const complaint of base.complaints || []) {
      const phases = base.kpTrackerMap?.[complaint.id]?.phases;
      if (phases?.length) kpPhasesMap[complaint.id] = phases;
    }
  }

  // True when the workflow tables are absent, so the UI can say so
  // rather than showing an empty tracker as though nothing was recorded.
  const workflowUnavailable = Boolean(
    summonsRes.error || serviceRes.error || documentsRes.error || attendancesRes.error
  );

  return {
    ...base,
    summonsMap,
    serviceMap,
    documentsMap,
    attendanceMap,
    luponPanelsMap,
    pangkatTrackerMap,
    kpPhasesMap,
    workflowUnavailable,
  };
}

/**
 * The workflow context for one complaint, shaped for the helpers above.
 */
export function workflowContextFor(complaintId, source = {}) {
  return {
    summons: source.summonsMap?.[complaintId] || [],
    serviceRecords: source.serviceMap?.[complaintId] || [],
    documents: source.documentsMap?.[complaintId] || [],
    attendances: source.attendanceMap?.[complaintId] || [],
    hearings: source.hearingsByComplaint?.[complaintId] || [],
    blotterRecord: source.blotterMap?.[complaintId] || null,
    // The two statutory clocks read these. Tolerant: when a caller has
    // not loaded them the second stage simply is not reported, rather
    // than the derivation throwing.
    kpPhases: source.kpPhasesMap?.[complaintId] || [],
    kpTracker: source.kpTrackerMap?.[complaintId] || null,
    pangkatTracker: source.pangkatTrackerMap?.[complaintId] || null,
    luponPanels: source.luponPanelsMap?.[complaintId] || [],
    // How the case ended, if it has. The ladder needs it to offer the
    // document an outcome owes: a settlement produces the Amicable
    // Settlement, a failed conciliation the Certificate to File Action.
    caseResolution: source.caseResolutionMap?.[complaintId] || null,
  };
}

/* ── Writes ───────────────────────────────────────────────────── */

/**
 * Send the complainant a notification that the Notice of Hearing issued
 * for their case is available.
 *
 * Uses the application's existing notification mechanism (the
 * `notifications` table, which the RLS policy "Officials insert
 * notifications" already permits for captain/oic/secretary) and the
 * existing activity-log RPC. No new table, no new RPC, and no change
 * to any resident page: the resident receives it through the account
 * workflow that already exists.
 *
 * Guarded so the button is only offered when the notice actually
 * exists — there is no point telling a complainant to look for a
 * document the barangay has not produced.
 */
export async function sendSummonsCopyToComplainant(
  supabase,
  { complaint, summonsRow, documentRow, hearingId }
) {
  const residentId = complaint?.resident_id;
  if (!residentId) {
    return { success: false, error: "This complaint has no complainant on record." };
  }
  if (!summonsRow && !documentRow) {
    return {
      success: false,
      error: "No summons document or issued summons exists yet, so there is no copy to send.",
    };
  }

  const ref = complaint.reference_number || "this complaint";
  // The copy this action delivers is the Notice of Hearing that names both
  // parties — `SendSummonsCopyButton` says so in its own header, toast and
  // empty state. A summons is the document issued to the *respondent*, and
  // the Resident Portal must never name one to a complainant, so the words
  // the resident reads here have to be the notice's. Only the function
  // name and the `summons_copy_sent_to_complainant` audit key keep the old
  // wording: they are read back for state and history.
  //
  // This also makes the link land: `resolveNotificationTarget` recognises a
  // notice by the text, so saying "Notice of Hearing" is what puts the
  // resident on `/resident/hearings?hearing=<id>&section=notice`.
  const title = "Notice of Hearing available";
  const message =
    `A copy of the Notice of Hearing issued to you in ${ref} is now available on your ` +
    `complaint record. Open your complaint to view the notice and the hearing information.`;

  const { error: notifyError } = await supabase.from("notifications").insert({
    user_id: residentId,
    type: "complaint",
    title,
    message,
    related_complaint_id: complaint.id,
    related_hearing_id: hearingId || summonsRow?.hearing_id || null,
  });

  if (notifyError) return { success: false, error: notifyError.message };

  // Best-effort audit entry. The notification is what matters to the
  // complainant; a logging failure must not undo the delivery.
  await logComplaintActivity(supabase, {
    action: "summons_copy_sent_to_complainant",
    complaintId: complaint.id,
    ref: complaint.reference_number || undefined,
    details: {
      summons_id: summonsRow?.id || null,
      document_id: documentRow?.id || null,
      hearing_id: hearingId || summonsRow?.hearing_id || null,
    },
  });

  return { success: true };
}

/**
 * Stamp a settled, documented case Closed.
 *
 * THE TWO WRITES THE WORKFLOW ALREADY READS
 *   `complaints.current_status/current_stage` is what every derivation
 *   on the case file (the ladder, the stepper, the list filters) turns
 *   into "the case is over", and the `case_statuses` row is the timeline
 *   the officer and the resident read the closure from. Same columns and
 *   same message shape as the "Mark Settled" transition — this simply
 *   goes one step further to `Closed`, because a case holding its
 *   Amicable Settlement has produced the paper the settled ending owed
 *   and has nothing left to point at.
 *
 * IDEMPOTENT BY RE-READ
 *   The caller derives this decision from bundle rows that may be one
 *   refresh behind, so the complaint's own current status is read fresh
 *   first: a case already Closed reports `changed: false` and writes
 *   nothing, which is what keeps a stale render or a double effect from
 *   filing a second closure into the timeline.
 *
 * The timeline row is best-effort after the status write: a failure to
 * append history must never leave the status change half-reported as an
 * error while the case is in fact closed. The audit entry is
 * best-effort for the same reason, matching every other write here.
 */
export async function closeCaseOnSettlement(supabase, { complaint, user }) {
  if (!complaint?.id) return { success: false, error: "No complaint to close." };

  const { data: fresh, error: readError } = await supabase
    .from("complaints")
    .select("current_status, current_stage, resolved_at")
    .eq("id", complaint.id)
    .maybeSingle();
  if (readError) return { success: false, error: readError.message };
  if (!fresh || fresh.current_status === "Closed") return { success: true, changed: false };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("complaints")
    .update({
      current_status: "Closed",
      current_stage: SETTLEMENT_CLOSED_STAGE,
      resolved_at: fresh.resolved_at || now,
      updated_at: now,
    })
    .eq("id", complaint.id);
  if (error) return { success: false, error: error.message };

  const { error: historyError } = await supabase.from("case_statuses").insert({
    complaint_id: complaint.id,
    status: "Closed",
    stage: SETTLEMENT_CLOSED_STAGE,
    resident_visible_message:
      "Your case was settled through an amicable agreement and has been closed.",
    changed_by: user?.id || null,
    created_at: now,
  });
  if (historyError) {
    await logComplaintActivity(supabase, {
      action: "case_closed_on_settlement_history_failed",
      complaintId: complaint.id,
      ref: complaint.reference_number || undefined,
      details: { error: historyError.message },
    });
  }

  await logComplaintActivity(supabase, {
    action: "case_closed_on_settlement",
    complaintId: complaint.id,
    ref: complaint.reference_number || undefined,
    details: {
      stage: SETTLEMENT_CLOSED_STAGE,
      resolved_at: fresh.resolved_at || now,
    },
  });

  return { success: true, changed: true };
}

/**
 * Take the settlement stamp back off — the other half of the same rule.
 *
 * Only ever runs on a case this rule closed itself (the stage marker is
 * re-checked against a fresh read for the same reason the close is), so
 * an archived or intake-closed record can never be reopened by it. The
 * case returns to the persisted in-progress pair the workflow already
 * uses — "In Progress" + "Mediation" is exactly what recording the
 * start of mediation writes — which puts the ladder, the stepper and
 * the resident's status mapping back on an open case without inventing
 * a stage anything has to learn. `resolved_at` is cleared because the
 * disposition it recorded no longer stands.
 *
 * `reason` lands in the audit entry only: it names which half of the
 * rule stopped holding (the corrected outcome, a repudiation, or a
 * document no longer on file), so the reopen can be explained later
 * from the trail alone.
 */
export async function reopenCaseAfterSettlement(supabase, { complaint, user, reason }) {
  if (!complaint?.id) return { success: false, error: "No complaint to reopen." };

  const { data: fresh, error: readError } = await supabase
    .from("complaints")
    .select("current_status, current_stage")
    .eq("id", complaint.id)
    .maybeSingle();
  if (readError) return { success: false, error: readError.message };
  if (
    !fresh ||
    fresh.current_status !== "Closed" ||
    fresh.current_stage !== SETTLEMENT_CLOSED_STAGE
  ) {
    return { success: true, changed: false };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("complaints")
    .update({
      current_status: "In Progress",
      current_stage: "Mediation",
      resolved_at: null,
      updated_at: now,
    })
    .eq("id", complaint.id);
  if (error) return { success: false, error: error.message };

  await supabase.from("case_statuses").insert({
    complaint_id: complaint.id,
    status: "In Progress",
    stage: "Mediation",
    resident_visible_message: "Your case was reopened; the settlement no longer applies to it.",
    changed_by: user?.id || null,
    created_at: now,
  });

  await logComplaintActivity(supabase, {
    action: "case_reopened_after_settlement",
    complaintId: complaint.id,
    ref: complaint.reference_number || undefined,
    details: { reason: reason || null },
  });

  return { success: true, changed: true };
}

/**
 * Record, change or clear one party's attendance at one hearing.
 *
 * Goes through captain_record_attendance() rather than writing the table
 * directly, because three of the rules that matter are not the caller's
 * to enforce:
 *
 *   * a missing or unrecognised status is stored as 'Not recorded',
 *     never promoted to 'Present'
 *   * 'Excused' requires a reason
 *   * the hearing status is left alone, so recording who attended can
 *     never mark the hearing as held
 *
 * Passing attendanceStatus of null, "" or "Not recorded" clears a
 * mistaken entry and returns the row to the state every hearing starts
 * in.
 */
export async function recordHearingAttendance(
  supabase,
  { complaintId, hearingId, partyRole, attendeeLabel, attendanceStatus, excuseReason }
) {
  if (!hearingId) return { success: false, error: "No hearing reference." };
  if (!partyRole) return { success: false, error: "No party selected for this attendance." };
  if (!attendeeLabel?.trim()) return { success: false, error: "Name the party this is for." };

  const { data, error } = await supabase.rpc("captain_record_attendance", {
    p_hearing_id: hearingId,
    p_party_role: partyRole,
    p_attendee_label: attendeeLabel.trim(),
    p_attendance_status: attendanceStatus || null,
    p_excuse_reason: excuseReason?.trim() || null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, id: data };
}

/**
 * Save the whole Meeting Record for one hearing.
 *
 * One call, one transaction: attendance, whether the meeting was
 * conducted, its outcome, the minutes, what the parties agreed, the next
 * step, and the hearing status that all of that justifies. The hearing
 * only becomes 'Held' when conducted is 'Yes'.
 *
 * The client-side checks here mirror the database constraints so the
 * officer gets an immediate message instead of a round trip. The
 * database remains the authority.
 */
export async function saveMeetingRecord(
  supabase,
  {
    hearingId,
    conducted,
    outcome,
    outcomeExplanation,
    minutes,
    agreements,
    nextStep,
    documentId = null,
    attendance = [],
  }
) {
  if (!hearingId) return { success: false, error: "No hearing reference." };

  const conductedValue = conducted || "Not recorded";
  if (!MEETING_CONDUCTED_VALUES.includes(conductedValue)) {
    return { success: false, error: "Meeting Conducted must be Yes, No, or Not recorded." };
  }

  const wasConducted = conductedValue === "Yes";

  if (wasConducted && !outcome) {
    return {
      success: false,
      error: "A meeting that was conducted needs a recorded outcome.",
    };
  }
  if (outcome && !MEETING_OUTCOME_VALUES.includes(outcome)) {
    return { success: false, error: "That is not a meeting outcome this system records." };
  }
  if (outcome === "Other" && !outcomeExplanation?.trim()) {
    return { success: false, error: "An outcome of Other needs an explanation." };
  }
  if (!wasConducted && outcome) {
    return {
      success: false,
      error: "A meeting that was not conducted cannot have an outcome.",
    };
  }

  for (const entry of attendance) {
    if (entry?.attendanceStatus === "Excused" && !entry.excuseReason?.trim()) {
      return {
        success: false,
        error: `${entry.partyLabel || entry.attendeeLabel || "A party"} is marked excused but has no reason.`,
      };
    }
  }

  const payload = (attendance || []).map((entry) => ({
    party_role: entry.partyRole || "other",
    attendee_label: String(entry.attendeeLabel || "").trim(),
    attendance_status: entry.attendanceStatus || "Not recorded",
    excuse_reason: entry.excuseReason?.trim() || null,
  }));

  const { data, error } = await supabase.rpc("captain_save_meeting_record", {
    p_hearing_id: hearingId,
    p_conducted: conductedValue,
    p_outcome: wasConducted ? outcome : null,
    p_outcome_explanation: outcomeExplanation?.trim() || null,
    p_minutes: minutes?.trim() || null,
    p_agreements: agreements?.trim() || null,
    p_next_step: nextStep?.trim() || null,
    p_attendance: payload,
    p_document_id: documentId || null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, result: data };
}

/**
 * Move a scheduled hearing to a new date.
 *
 * The original row is preserved and marked Rescheduled, a new Upcoming
 * hearing is created, and the two are cross-linked. Nothing is
 * overwritten, so the date that was originally set stays in the record.
 */
export async function rescheduleHearing(supabase, { hearingId, date, time, venue }) {
  if (!hearingId) return { success: false, error: "No hearing reference." };
  if (!date) return { success: false, error: "Select the new hearing date." };
  if (!time) return { success: false, error: "Select the new hearing time." };
  if (!String(venue || "").trim()) return { success: false, error: "Enter a venue for the hearing." };

  const { data, error } = await supabase.rpc("captain_reschedule_hearing", {
    p_hearing_id: hearingId,
    p_new_date: date,
    p_new_time: time,
    p_new_venue: String(venue).trim(),
  });

  if (error) return { success: false, error: error.message };
  return { success: true, newHearingId: data };
}

/** Cancel a scheduled hearing. A reason is required and is stored. */
export async function cancelHearing(supabase, { hearingId, reason }) {
  if (!hearingId) return { success: false, error: "No hearing reference." };
  if (!String(reason || "").trim()) {
    return { success: false, error: "A cancelled hearing needs a reason." };
  }

  const { error } = await supabase.rpc("captain_cancel_hearing", {
    p_hearing_id: hearingId,
    p_reason: String(reason).trim(),
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * One readable sentence for a failed schedule or reschedule, whatever
 * Supabase threw.
 *
 * The database guards already raise exact, actionable sentences (the
 * workflow-gate and lifecycle triggers), so their text is kept as-is.
 * Only the transport-level failures are translated, because their raw
 * text is either empty or a developer message the operator cannot act
 * on — an expired session, a policy block, a dropped connection. An
 * empty message is the worst case: the operator sees a failure with no
 * reason at all, and the console entry is the only place the truth is
 * left, so the callers log this sentence together with the raw code.
 *
 * @param {unknown} caught  whatever the failed call threw or returned
 * @returns {string} a sentence that can be shown to the official
 */
export function scheduleFailureMessage(caught) {
  const raw =
    typeof caught === "string"
      ? caught
      : caught?.message || (caught instanceof Error ? String(caught) : "");
  const code = String(caught?.code || "");

  if (!raw) return "Could not schedule the hearing.";
  if (code === "401" || /jwt|expired|invalid claim/i.test(raw)) {
    return "Your session has expired. Sign in again, then retry scheduling.";
  }
  if (code === "42501" || /row-level security/i.test(raw)) {
    return "This account is not allowed to save a hearing. Sign in with an official account (Barangay Captain, OIC, or Secretary).";
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Could not reach the server. Check the connection, then try again.";
  }
  return raw;
}
