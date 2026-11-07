import {
  elapsedDays,
  remainingDays,
  clampProgress,
  formatDateLong,
} from "@/lib/kpDateUtils";

export const CATEGORY_OPTIONS = ["Criminal", "Civil", "Administrative"];
export const URGENCY_OPTIONS = ["Critical", "High", "Normal"];

/**
 * Case-type filter options — the legal/administrative classification of a
 * complaint. The values are exactly the `case_category` enum
 * (supabase/manual/01_extensions_and_enums.sql), so the filter reads the
 * persisted value rather than re-deriving a classification from the title.
 *
 * This is a different level of classification from the granular complaint
 * category ("Noise Disturbance", "Theft", "Vandalism", …) — that label is a
 * classifier presentation aid and has no column of its own; the case type it
 * maps to is what the schema stores.
 */
export const CASE_TYPE_FILTERS = [
  { value: "all", label: "All Types" },
  { value: "Civil", label: "Civil" },
  { value: "Administrative", label: "Administrative" },
  { value: "Criminal", label: "Criminal" },
];

export const STAGE_KEYS = {
  CHECK: "check",
  CATEGORIZATION: "categorization",
  MEDIATION: "mediation",
  CONCILIATION: "conciliation",
  CLOSED: "closed",
};

/**
 * The one place that maps a processing stage onto the persisted status pair.
 * `status` must be a value of the `complaint_status` enum; `stage` is the
 * free-text `current_stage` shown to residents and officials.
 *
 * 'For Official Categorization' is not a duplicate of any existing enum value:
 * 'Pending Review' is the information check, 'Received' is the post-confirmation
 * summons/hearing step, and 'In Progress' covers mediation and Pangkat. It is
 * added by supabase/manual/captain_workflow_categorization_stage.sql.
 */
export const CATEGORIZATION_STATUS = "For Official Categorization";
export const CATEGORIZATION_STAGE_LABEL = "For Official Categorization";

export const STAGE_META = {
  [STAGE_KEYS.CHECK]: {
    label: "Information Check",
    short: "Check",
    bar: "bg-[#b45309]",
    badge: "bg-[#b45309]/10 text-[#b45309] border-[#b45309]/20",
    soft: "bg-warning-soft",
  },
  [STAGE_KEYS.CATEGORIZATION]: {
    label: "For Official Categorization",
    short: "Categorize",
    bar: "bg-[#714bd8]",
    badge: "bg-[#714bd8]/10 text-[#714bd8] border-[#714bd8]/20",
    soft: "bg-[#f1edfb]",
  },
  [STAGE_KEYS.MEDIATION]: {
    label: "Captain Mediation",
    short: "Mediation",
    bar: "bg-[#1b4c8c]",
    badge: "bg-[#1b4c8c]/10 text-[#1b4c8c] border-[#1b4c8c]/20",
    soft: "bg-info-soft",
  },
  [STAGE_KEYS.CONCILIATION]: {
    label: "Pangkat Conciliation",
    short: "Conciliation",
    bar: "bg-[#714bd8]",
    badge: "bg-[#714bd8]/10 text-[#714bd8] border-[#714bd8]/20",
    soft: "bg-[#f1edfb]",
  },
  [STAGE_KEYS.CLOSED]: {
    label: "Closed",
    short: "Closed",
    bar: "bg-[#17774e]",
    badge: "bg-[#17774e]/10 text-[#17774e] border-[#17774e]/20",
    soft: "bg-success-soft",
  },
};

export const STAGE_ORDER = [
  STAGE_KEYS.CHECK,
  STAGE_KEYS.CATEGORIZATION,
  STAGE_KEYS.MEDIATION,
  STAGE_KEYS.CONCILIATION,
  STAGE_KEYS.CLOSED,
];

/**
 * Stage filter options. `value` is the internal stage key used by stageOf()
 * and by the workflow everywhere else — only the labels here are user-facing,
 * so no card, action or stored value changes when they change.
 */
export const STAGE_FILTERS = [
  { value: "all", label: "All Stages" },
  { value: STAGE_KEYS.CHECK, label: "Information Check" },
  { value: STAGE_KEYS.CATEGORIZATION, label: "Official Categorization" },
  { value: STAGE_KEYS.MEDIATION, label: "Mediation" },
  { value: STAGE_KEYS.CONCILIATION, label: "Conciliation / Pangkat" },
  { value: STAGE_KEYS.CLOSED, label: "Resolution / Documentation" },
];

/**
 * Status filters ("what currently needs to happen to this complaint"), in the
 * order the case flow reads them. Each entry matches against the routing
 * columns on the complaint row, so the filter works the same whether or not
 * the route has been decided.
 *
 * `value` is the persisted `routing_status` vocabulary from
 * supabase/manual/captain-complaint-routing-workflow.sql. Those values are
 * read by the workflow, the audit trail and the reports, so only the
 * user-facing `label` ever changes here.
 */
export const ROUTE_FILTERS = [
  { value: "all", label: "All Statuses" },
  {
    value: "awaiting_review",
    label: "Awaiting Review",
    match: (c) =>
      !c.routing_status || c.routing_status === "pending_assessment",
  },
  {
    value: "needs_information",
    label: "Needs Information",
    match: (c) =>
      c.completeness_status === "needs_information" ||
      c.routing_status === "request_additional_information",
  },
  {
    value: "route_assessment",
    label: "For Assessment",
    match: (c) =>
      !c.routing_status || c.routing_status === "pending_assessment",
  },
  {
    value: "kp_mediation",
    label: "For Mediation",
    match: (c) => c.routing_status === "kp_mediation",
  },
  {
    value: "pangkat_conciliation",
    label: "For Conciliation",
    match: (c) => c.routing_status === "pangkat_conciliation",
  },
  {
    value: "incident_documentation",
    label: "For Documentation",
    match: (c) =>
      c.routing_status === "incident_documentation" ||
      c.complaint_nature === "reported_incident",
  },
  {
    value: "service_action",
    label: "For Service Action",
    match: (c) => c.routing_status === "service_action",
  },
  {
    value: "administrative_review",
    label: "For Administrative Review",
    match: (c) =>
      c.routing_status === "administrative_review" ||
      c.routing_status === "administrative_handling",
  },
  {
    value: "closed",
    label: "Closed",
    match: (c) =>
      ["closed", "withdrawn", "rejected", "resolved_at_intake"].includes(c.routing_status) ||
      ["Resolved", "Closed", "Rejected"].includes(c.current_status),
  },
];

export function matchRouteFilter(complaint, route) {
  if (route === "all") return true;
  const filter = ROUTE_FILTERS.find((f) => f.value === route);
  return filter ? filter.match(complaint) : true;
}

/**
 * True once a complaint has reached a terminal disposition, using the same
 * two definitions the rest of the app already uses: the stage derivation
 * (current_status Resolved / Closed / Rejected) and the closed route
 * (routing_status closed / withdrawn / rejected / resolved_at_intake).
 *
 * This is what "active" means in the summary bar: everything that is not
 * closed or resolved.
 */
export function isClosedComplaint(complaint, kpTracker) {
  if (stageOf(complaint, kpTracker) === STAGE_KEYS.CLOSED) return true;
  return matchRouteFilter(complaint, "closed");
}

/**
 * Persisted status pair each stage resolves to when the case enters it.
 * Ordered by STAGE_ORDER so a stage can never be skipped.
 */
export const STAGE_TRANSITIONS = {
  [STAGE_KEYS.CHECK]: {
    status: "Pending Review",
    stage: "Awaiting Information Check",
  },
  [STAGE_KEYS.CATEGORIZATION]: {
    status: CATEGORIZATION_STATUS,
    stage: CATEGORIZATION_STAGE_LABEL,
  },
  [STAGE_KEYS.MEDIATION]: {
    status: "Received",
    stage: "Received — Pending Summons",
  },
  [STAGE_KEYS.CONCILIATION]: {
    status: "In Progress",
    stage: "Pangkat Conciliation",
  },
  [STAGE_KEYS.CLOSED]: {
    status: "Closed",
    stage: "Closed",
  },
};

/**
 * Actions each stage is permitted to offer. The "Continue Case Processing"
 * modal renders only these, so a later-stage action is never reachable
 * before the case has actually reached that stage.
 */
export const STAGE_ACTIONS = {
  [STAGE_KEYS.CHECK]: ["receive", "reject"],
  [STAGE_KEYS.CATEGORIZATION]: ["confirmCategory", "reject"],
  [STAGE_KEYS.MEDIATION]: ["startMediation", "startPangkat", "settled", "completed"],
  [STAGE_KEYS.CONCILIATION]: ["startPangkat", "settled", "completed"],
  [STAGE_KEYS.CLOSED]: ["archive"],
};

/** Roles allowed to make the official decisions in stages 1 and 2. */
export const DECISION_ROLES = ["captain", "oic"];

export function canDecide(role) {
  return DECISION_ROLES.includes(role);
}

export const TOTAL_STEPS = 7;

export const WORKFLOW_STEPS = [
  { key: "check", stage: STAGE_KEYS.CHECK, label: "Information Check" },
  { key: "receive", stage: STAGE_KEYS.CHECK, label: "Receive / Reject" },
  { key: "categorization", stage: STAGE_KEYS.CATEGORIZATION, label: "Categorization" },
  { key: "hearing", stage: STAGE_KEYS.MEDIATION, label: "Summons & Hearing" },
  { key: "mediation", stage: STAGE_KEYS.MEDIATION, label: "Mediation" },
  { key: "conciliation", stage: STAGE_KEYS.CONCILIATION, label: "Pangkat" },
  { key: "closed", stage: STAGE_KEYS.CLOSED, label: "Disposition" },
];

/** 1-based position of a stage in the required processing order. */
export function stepNumberFor(stage) {
  const first = WORKFLOW_STEPS.findIndex((s) => s.stage === stage);
  return first === -1 ? 0 : first + 1;
}

export function resolveComplainantName(complaint) {
  const display = printed(complaint?.profiles?.display_name);
  if (display) return display;

  const profile = residentProfileOf(complaint);
  const fromProfile = joinNameParts([
    profile?.first_name,
    profile?.middle_name,
    profile?.last_name,
    profile?.suffix,
  ]);
  if (fromProfile) return fromProfile;

  const snapshot = complainantSnapshotOf(complaint);
  return joinNameParts([
    snapshot?.first_name,
    snapshot?.middle_name,
    snapshot?.last_name,
    snapshot?.suffix,
  ]);
}

export function resolveComplainantInitials(name) {
  if (!name || name === "—") return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function resolveRespondent(complaint) {
  const raw = complaint?.persons_involved;
  return (raw || "—").trim() || "—";
}

/**
 * The identified respondent of a case, for official documents.
 *
 * This is deliberately not `persons_involved`, which is the free-text list of
 * everyone named in the narrative. A printed form states the respondent of the
 * case, so it reads the respondent columns the Captain recorded when a suspect
 * was identified. Returns null when no respondent has been identified, which is
 * a normal state for a one-party complaint and must never be filled with a
 * stand-in name.
 */
export function resolveRespondentName(complaint) {
  const value = complaint?.respondent_display_name || complaint?.respondent_name;
  return value && String(value).trim() ? String(value).trim() : null;
}

export function resolveRespondentAddress(complaint) {
  const value = complaint?.respondent_address;
  return value && String(value).trim() ? String(value).trim() : null;
}

/**
 * The parties line rendered under a case title.
 *
 * Before an official confirms the respondent, the header names the
 * complainant and the respondent exactly as filed — nothing is phrased
 * as a match-up that implies a confirmed other party. Once a respondent
 * is identified, the header reads "vs." with the confirmed name.
 */
export function resolveCaseHeaderParties(complaint) {
  const complainant = resolveComplainantName(complaint);
  const asFiled = resolveRespondent(complaint);
  const status = complaint?.respondent_status;
  if (status === "identified") {
    const confirmed = resolveRespondentName(complaint) || asFiled;
    return `${complainant} vs. ${confirmed}`;
  }
  if (status === "not_applicable") {
    return `${complainant} · No opposing respondent required`;
  }
  if (status === "unknown" || status === "insufficient_information") {
    return `${complainant} · Respondent: Not yet identified`;
  }
  if (asFiled && asFiled !== "—") {
    return `${complainant} · Respondent as filed: ${asFiled}`;
  }
  return `${complainant} · Respondent: Not yet identified`;
}

/** The complainant's own address as held on their resident profile. */
export function resolveComplainantAddress(complaint) {
  const profile = complaint?.profiles?.resident_profiles?.[0];
  if (!profile) return null;
  const parts = [profile.house_street, profile.purok, profile.barangay, profile.city]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// ── Document-generation resolution ─────────────────────────────────────────
//
// The card and list views print "—" for a value the barangay has not recorded,
// which is right on screen. A generated official document must never print a
// dash, the word "null" or any other stand-in, so these resolvers return an
// empty string instead and fall back to the walk-in snapshot that a kiosk or
// barangay-hall complaint is filed under when there is no resident account.

/** Anything missing or whitespace-only prints as blank on a document. */
function printed(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text || "";
}

/** A name built from whichever parts are recorded; missing parts are skipped. */
function joinNameParts(parts) {
  return parts
    .map((part) => printed(part))
    .filter(Boolean)
    .join(" ");
}

/** The walk-in snapshot written by the kiosk and the staff-assisted filing. */
function complainantSnapshotOf(complaint) {
  const snapshot = complaint?.complainant_snapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot
    : null;
}

function residentProfileOf(complaint) {
  const embedded = complaint?.profiles?.resident_profiles;
  return Array.isArray(embedded) ? embedded[0] || null : embedded || null;
}

/**
 * The complainant as a generated document prints them. Delegates to
 * `resolveComplainantName`, the single name chain (display name → resident
 * profile → walk-in snapshot → blank), so on-screen and printed names can
 * never diverge. Never a stand-in.
 */
export function resolveDocumentComplainantName(complaint) {
  return resolveComplainantName(complaint);
}

/** `house_street`, taken from the profile and only then from the snapshot. */
export function resolveDocumentComplainantAddressLine1(complaint) {
  const profile = residentProfileOf(complaint);
  const snapshot = complainantSnapshotOf(complaint);
  return printed(profile?.house_street) || printed(snapshot?.house_street);
}

/** "purok, barangay, city", joined from whichever of those are recorded. */
export function resolveDocumentComplainantAddressLine2(complaint) {
  const profile = residentProfileOf(complaint);
  const snapshot = complainantSnapshotOf(complaint);
  const join = (source) =>
    [source?.purok, source?.barangay, source?.city]
      .map((part) => printed(part))
      .filter(Boolean)
      .join(", ");
  return join(profile) || join(snapshot);
}

/**
 * The respondent as a generated document prints them - the identified
 * respondent of the case, or blank.
 *
 * The resident's own submitted form may pass `{ includePersonsInvolved: true }`
 * so that when the barangay has not confirmed a respondent yet, the persons
 * named in the complaint are printed as filed. Official documents never fall
 * back: for them, a respondent the barangay has not identified is a blank line,
 * never a stand-in name.
 */
export function resolveDocumentRespondentName(complaint, { includePersonsInvolved = false } = {}) {
  const identified =
    printed(complaint?.respondent_display_name) || printed(complaint?.respondent_name);
  if (identified) return identified;
  if (includePersonsInvolved) return printed(complaint?.persons_involved);
  return "";
}

/** The respondent's address as filed - one unstructured line, never split. */
export function resolveDocumentRespondentAddressLine1(complaint) {
  return printed(complaint?.respondent_address);
}

export function resolveReference(complaint) {
  return complaint?.reference_number || "No reference";
}

export function resolveConfirmedCategory(complaint) {
  return complaint?.confirmed_category || complaint?.confirmed_case_type || null;
}

/**
 * The official case type of a complaint: Civil, Administrative or Criminal.
 *
 * Only the confirmed columns count. `predicted_*` holds the AI suggestion,
 * which the schema documents as a recommendation ("Predicted (AI
 * classification — recommendations only)"), so a complaint whose case type is
 * still only suggested has no official case type yet and is matched by
 * "All Types" alone.
 */
export function resolveCaseType(complaint) {
  return resolveConfirmedCategory(complaint);
}

export function resolveConfirmedUrgency(complaint) {
  return complaint?.confirmed_urgency || complaint?.predicted_urgency || null;
}

export function resolvePredictedCategory(complaint) {
  return complaint?.predicted_category || complaint?.predicted_case_type || null;
}

/**
 * Current processing stage of a complaint, mapped to the reference buckets.
 * The tracker's active phase is used only as a hint for conciliation.
 */
export function stageOf(complaint, kpTracker) {
  const status = complaint?.current_status;
  if (["Resolved", "Closed", "Rejected"].includes(status)) return STAGE_KEYS.CLOSED;

  // Explicit stage wins over the tracker's phase hint: a case that has been
  // received but is still awaiting official categorization must not fall
  // through to mediation.
  if (status === CATEGORIZATION_STATUS) return STAGE_KEYS.CATEGORIZATION;

  const stage = (complaint?.current_stage || "").toLowerCase();
  if (stage.includes("pangkat") || stage.includes("concil")) return STAGE_KEYS.CONCILIATION;
  if (stage.includes("categoriz")) return STAGE_KEYS.CATEGORIZATION;

  if (kpTracker?.current_phase) {
    const phase = kpTracker.current_phase.toLowerCase();
    if (phase.includes("concil")) return STAGE_KEYS.CONCILIATION;
  }

  if (["In Progress", "Awaiting Meeting", "Received"].includes(status)) {
    return STAGE_KEYS.MEDIATION;
  }

  return STAGE_KEYS.CHECK;
}

/**
 * True when the official category/urgency decision is what is actually
 * outstanding.
 *
 * A case still sitting in the information check is excluded: what it is
 * waiting on is applicability, not categorization, and the
 * "Awaiting Information Check" summary card already counts it. Terminal
 * cases are excluded for the same reason. A case that advanced past the
 * gate without ever being confirmed is still reported, so the gap is
 * visible rather than silent.
 */
export function isAwaitingCategorization(complaint, kpTracker) {
  const stage = stageOf(complaint, kpTracker);
  if (stage === STAGE_KEYS.CATEGORIZATION) return true;
  if (stage === STAGE_KEYS.CHECK || stage === STAGE_KEYS.CLOSED) return false;
  return !resolveConfirmedCategory(complaint) && !resolveConfirmedUrgency(complaint);
}

export function isCritical(complaint) {
  return resolveConfirmedUrgency(complaint) === "Critical";
}

export function countsFor(complaints, kpTrackerMap = {}) {
  const counts = {
    [STAGE_KEYS.CHECK]: 0,
    categorization: 0,
    active: 0,
    critical: 0,
  };
  for (const c of complaints || []) {
    const stage = stageOf(c, kpTrackerMap[c.id]);
    if (stage === STAGE_KEYS.CHECK) counts[STAGE_KEYS.CHECK] += 1;
    if (isAwaitingCategorization(c, kpTrackerMap[c.id])) counts.categorization += 1;
    if (stage === STAGE_KEYS.MEDIATION || stage === STAGE_KEYS.CONCILIATION) counts.active += 1;
    if (isCritical(c)) counts.critical += 1;
  }
  return counts;
}

/**
 * One combined filter over every dimension of the list. Each dimension is
 * optional, "all" / "" / "All" means it does not restrict anything, and the
 * dimensions are combined with AND — a complaint has to satisfy all of them.
 *
 *   caseType -> what broad type of case it is   (Civil / Administrative / Criminal)
 *   route    -> what currently needs to happen  (the status vocabulary)
 *   stage    -> where it is in the workflow
 *   urgency  -> how urgent it is
 *   q        -> free-text search across reference, title, narrative and parties
 */
export function filterComplaints(
  complaints,
  { q = "", stage = "all", urgency = "All", route = "all", caseType = "all" },
  kpTrackerMap = {}
) {
  const query = (q || "").trim().toLowerCase();
  return (complaints || []).filter((c) => {
    if (caseType && caseType !== "all" && resolveCaseType(c) !== caseType) return false;
    if (stage !== "all" && stageOf(c, kpTrackerMap[c.id]) !== stage) return false;
    if (route !== "all" && !matchRouteFilter(c, route)) return false;
    const urgencyOf = resolveConfirmedUrgency(c);
    if (urgency && urgency !== "All" && urgencyOf !== urgency) return false;
    if (query) {
      const haystack = [
        c.reference_number,
        c.title,
        c.description,
        resolveComplainantName(c),
        resolveRespondent(c),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/**
 * Progress of a complaint through the generic workflow (0–100).
 */
export function progressPercent(complaint) {
  const status = complaint?.current_status;
  if (["Closed", "Rejected"].includes(status)) return 100;
  if (status === "Resolved") return 88;
  const map = {
    "Pending Review": 10,
    [CATEGORIZATION_STATUS]: 30,
    Received: 45,
    "In Progress": 55,
    "Awaiting Meeting": 70,
  };
  return map[status] ?? 5;
}

export function formatDateShort(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatTime(timeValue) {
  if (!timeValue) return "—";
  try {
    return new Date(`1970-01-01T${timeValue}`).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return timeValue;
  }
}

/**
 * Active KP phase (Mediation or Conciliation) of a complaint.
 */
export function activeKpPhase(complaint, kpTrackerMap) {
  return kpTrackerMap[complaint?.id]?.currentPhase || null;
}

/**
 * Deadline summary for a card/tracker.
 */
export function deadlineInfo(kpTracker) {
  const phase = kpTracker?.phases?.find((p) => p.status && p.status !== "Not Started");
  if (!phase || !phase.start_date) {
    return { hasDeadline: false, label: "Tracker pending first meeting", days: null };
  }
  const total = phase.duration_days || 15;
  const elapsed = elapsedDays(phase.start_date);
  const remaining = remainingDays(phase.deadline_date);
  const progress = clampProgress(elapsed, total);
  return {
    hasDeadline: true,
    label: `${remaining > 0 ? `${remaining} day${remaining === 1 ? "" : "s"} remaining` : "Deadline reached"}`,
    detail: `Day ${Math.min(elapsed, total)} of ${total}`,
    elapsed,
    total,
    remaining,
    progress,
    startDate: phase.start_date,
    deadlineDate: phase.deadline_date,
  };
}

export function nextActionFor(complaint, { hearings = [], kpTracker } = {}) {
  const stage = stageOf(complaint, kpTracker);
  const upcoming = (hearings || [])
    .filter((h) => h.status === "Upcoming" || h.status === "Confirmed" || h.status === "Scheduled")
    .sort(
      (a, b) =>
        new Date(`${a.hearing_date || ""}T${a.hearing_time || "00:00"}`) -
        new Date(`${b.hearing_date || ""}T${b.hearing_time || "00:00"}`)
    )[0];

  if (upcoming) {
    return {
      label: "Next hearing",
      value: `${formatDateShort(upcoming.hearing_date)} · ${formatTime(upcoming.hearing_time)}`,
      kind: "hearing",
    };
  }

  const dl = deadlineInfo(kpTracker);
  if (stage === STAGE_KEYS.CHECK) {
    return { label: "Determine KP applicability", value: dl.hasDeadline ? dl.label : "Not started", kind: "check" };
  }
  if (stage === STAGE_KEYS.CATEGORIZATION) {
    return { label: "Official categorization", value: dl.hasDeadline ? dl.label : "Awaiting official decision", kind: "categorization" };
  }
  if (stage === STAGE_KEYS.MEDIATION) {
    return { label: "Mediation session", value: dl.hasDeadline ? dl.label : "Record first meeting", kind: "mediation" };
  }
  if (stage === STAGE_KEYS.CONCILIATION) {
    return { label: "Pangkat session", value: dl.hasDeadline ? dl.label : "Schedule Pangkat", kind: "conciliation" };
  }
  return { label: "Archive record", value: dl.label, kind: "closed" };
}

export function legacyStatusToStage(slug) {
  switch (slug) {
    case "pending-review":
      return STAGE_KEYS.CHECK;
    case "for-official-categorization":
      return STAGE_KEYS.CATEGORIZATION;
    case "received":
      return STAGE_KEYS.MEDIATION;
    case "in-progress":
    case "awaiting-meeting":
      return STAGE_KEYS.MEDIATION;
    case "conciliation":
      return STAGE_KEYS.CONCILIATION;
    case "resolved":
    case "closed":
    case "rejected":
      return STAGE_KEYS.CLOSED;
    default:
      return "all";
  }
}

export { formatDateLong };