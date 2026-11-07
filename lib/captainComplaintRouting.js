/**
 * Captain complaint routing — data layer and shared rules.
 *
 * WHY A SEPARATE FILE
 *   The gate rule is used in at least five places: the list card, the
 *   case viewer header, the routing tab, the summons tab and the Lupon
 *   tab. If each of those re-derived "can we start a 15-day clock
 *   yet?", they would eventually disagree, and the one that disagreed
 *   most would be the one a resident noticed. So the rule lives here,
 *   once, and everything else asks.
 *
 * WRITES
 *   Every write goes through one of the SECURITY DEFINER RPCs created
 *   by supabase/manual/captain-complaint-routing-workflow.sql. There
 *   is no direct table write in this file, on purpose:
 *
 *     * The RPC re-checks the caller's role server-side. A role check
 *       in JavaScript is a check the client controls.
 *     * The RPC takes a row lock, so two officials deciding a route at
 *       the same time cannot interleave into a half-applied state.
 *     * The RPC writes the before/after history row. A client that
 *       forgets is a case file that cannot be explained later.
 *     * The RPC writes the resident-safe message. The wording is
 *       therefore defined in SQL, where it cannot drift from what a
 *       resident is actually shown.
 */

/* ── Vocabulary ──────────────────────────────────────────────── */

/**
 * Respondent status. `identified` is the only state in which the
 * respondent is a real, named person; every other state is an honest
 * statement that we do not know who they are.
 */
export const RESPONDENT_STATUSES = [
  {
    value: "pending",
    label: "Pending confirmation",
    short: "Pending",
    hint: "The other party has not been confirmed yet. Summons, mediation and the Pangkat are unavailable.",
    tone: "warning",
  },
  {
    value: "identified",
    label: "Identified",
    short: "Identified",
    hint: "The other party is known. KP applicability still has to be confirmed before any party step.",
    tone: "ok",
  },
  {
    value: "unknown",
    label: "Not identified",
    short: "Unknown",
    hint: "The other party could not be identified. Record what you checked, so the reason survives.",
    tone: "critical",
  },
  {
    value: "insufficient_information",
    label: "Insufficient information",
    short: "Incomplete",
    hint: "The complaint does not carry enough detail to identify the other party.",
    tone: "critical",
  },
  {
    value: "not_applicable",
    label: "No respondent applicable",
    short: "No respondent required",
    hint: "No opposing party applies to this complaint, so no party-facing step is needed.",
    tone: "neutral",
  },
];

/** Statuses that require a written reason when they are recorded. */
export const RESPONDENT_STATUSES_NEEDING_REASON = [
  "unknown",
  "insufficient_information",
  "not_applicable",
];

export const KP_APPLICABILITIES = [
  {
    value: "pending",
    label: "Pending assessment",
    short: "Pending",
    hint: "Not yet assessed. Party steps stay unavailable.",
    tone: "warning",
  },
  {
    value: "applicable",
    label: "Applicable — within KP jurisdiction",
    short: "Applicable",
    hint: "May be mediated before the Punong Barangay. Available only once the respondent is identified.",
    tone: "ok",
  },
  {
    value: "not_applicable",
    label: "Not applicable — outside KP jurisdiction",
    short: "Not applicable",
    hint: "Outside Katarungang Pambarangay. A written reason is required and the gate stays shut.",
    tone: "critical",
  },
  {
    value: "deferred_unknown_respondent",
    label: "Deferred — respondent not identified",
    short: "Deferred",
    hint: "Cannot be assessed until the other party is known. A written reason is required.",
    tone: "warning",
  },
  {
    value: "requires_legal_review",
    label: "Requires legal review",
    short: "Legal review",
    hint: "Held for legal review. The gate stays shut and no 15-day period runs.",
    tone: "critical",
  },
];

/** Applicability values that must carry a reason. */
export const KP_APPLICABILITIES_NEEDING_REASON = [
  "not_applicable",
  "deferred_unknown_respondent",
];

export const ROUTING_STATUSES = [
  {
    value: "pending_assessment",
    label: "Pending assessment",
    short: "Unassessed",
    hint: "No route decided yet.",
    tone: "warning",
  },
  {
    value: "kp_mediation",
    label: "KP mediation (Captain)",
    short: "KP mediation",
    hint: "Captain mediation before the Punong Barangay. Requires an identified respondent, KP applicability, and a reason.",
    tone: "ok",
  },
  {
    value: "pangkat_conciliation",
    label: "Pangkat conciliation",
    short: "Pangkat",
    hint: "Referral to the Pangkat. Requires an identified respondent, KP applicability, and a reason.",
    tone: "ok",
  },
  {
    value: "police_reporting_assistance",
    label: "Police reporting assistance",
    short: "PNP assistance",
    hint: "The barangay assisted the complainant in reporting to the PNP. This is a record only: it does not create a police case.",
    tone: "neutral",
  },
  {
    value: "external_agency_assistance",
    label: "External agency assistance",
    short: "Other agency",
    hint: "Referred to another government office. This is a record only.",
    tone: "neutral",
  },
  {
    value: "incident_documentation",
    label: "Incident documentation",
    short: "Incident",
    hint: "The case is a reported incident (no other party who can be summoned). The barangay records the incident details and may open or link a blotter record.",
    tone: "neutral",
  },
  {
    value: "service_action",
    label: "Service action",
    short: "Service",
    hint: "Referred to the appropriate barangay service (e.g. health, welfare, clean-up).",
    tone: "neutral",
  },
  {
    value: "administrative_review",
    label: "Administrative review",
    short: "Admin review",
    hint: "Referred for administrative review by the barangay.",
    tone: "neutral",
  },
  {
    value: "request_additional_information",
    label: "Request additional information",
    short: "Needs info",
    hint: "The submission is incomplete. An official records exactly what the complainant must provide.",
    tone: "warning",
  },
  {
    value: "duplicate_review",
    label: "Duplicate review",
    short: "Duplicate",
    hint: "The submission appears to duplicate an existing complaint and is held for review.",
    tone: "warning",
  },
  {
    value: "other_authorized_route",
    label: "Other authorized route",
    short: "Other route",
    hint: "Another route authorized in writing by the official. The reason must say which route and why.",
    tone: "neutral",
  },
  {
    value: "administrative_handling",
    label: "Administrative handling",
    short: "Administrative",
    hint: "The complaint will be resolved administratively by the barangay.",
    tone: "neutral",
  },
  {
    value: "resolved_at_intake",
    label: "Resolved at intake",
    short: "Resolved",
    hint: "Resolved during intake. No party-facing step is needed.",
    tone: "ok",
  },
  {
    value: "rejected",
    label: "Rejected",
    short: "Rejected",
    hint: "The complaint was not accepted. The reason is shared with the complainant.",
    tone: "critical",
  },
  {
    value: "withdrawn",
    label: "Withdrawn",
    short: "Withdrawn",
    hint: "The complainant withdrew the complaint.",
    tone: "neutral",
  },
  {
    value: "closed",
    label: "Closed",
    short: "Closed",
    hint: "The case file is closed.",
    tone: "neutral",
  },
];

/** Routes that make a summons, hearing or 15-day clock permissible. */
export const PARTY_FACING_ROUTES = ["kp_mediation", "pangkat_conciliation"];

/** Routes that describe an outside-referral / incident pathway. */
export const REFERRAL_ROUTES = [
  "police_reporting_assistance",
  "external_agency_assistance",
  "incident_documentation",
];

/**
 * Complaint nature: the SINGLE selection that says what the submission
 * actually is. The categorization screen predicts; this is the nature
 * an official confirms as part of the completeness review.
 */
export const COMPLAINT_NATURES = [
  {
    value: "two_party_dispute",
    label: "Two-party dispute",
    short: "Dispute",
    hint: "There is another party on the other side of the dispute. The respondent can eventually be identified and summoned.",
    tone: "ok",
  },
  {
    value: "reported_incident",
    label: "Reported incident",
    short: "Incident",
    hint: "No respondent can be put on notice — the case is a reported incident (e.g. theft, damage, threat from an unknown person). KP does not apply.",
    tone: "critical",
  },
  {
    value: "service_concern",
    label: "Service concern",
    short: "Service",
    hint: "A concern about a barangay service or facility. Handled administratively, not as a party dispute.",
    tone: "neutral",
  },
  {
    value: "administrative_concern",
    label: "Administrative concern",
    short: "Admin",
    hint: "A concern about an official act or process, held for administrative review.",
    tone: "neutral",
  },
  {
    value: "incomplete_submission",
    label: "Incomplete submission",
    short: "Incomplete",
    hint: "The submission is missing information the barangay needs. The complainant is asked to provide it before assessment continues.",
    tone: "warning",
  },
  {
    value: "duplicate_submission",
    label: "Duplicate submission",
    short: "Duplicate",
    hint: "The same matter is already recorded under an existing case number.",
    tone: "warning",
  },
  {
    value: "other_requires_review",
    label: "Other — requires review",
    short: "Other",
    hint: "Does not fit the categories above and was referred for a written review.",
    tone: "neutral",
  },
];

export const COMPLETENESS_STATUSES = [
  {
    value: "pending_review",
    label: "Pending review",
    short: "Pending",
    hint: "The completeness review has not been recorded yet.",
    tone: "warning",
  },
  {
    value: "complete",
    label: "Complete",
    short: "Complete",
    hint: "The submission has everything the barangay needs to proceed.",
    tone: "ok",
  },
  {
    value: "needs_information",
    label: "Needs additional information",
    short: "Needs info",
    hint: "The barangay requested more information from the complainant.",
    tone: "warning",
  },
  {
    value: "duplicate",
    label: "Duplicate",
    short: "Duplicate",
    hint: "Marked as duplicating an existing record.",
    tone: "warning",
  },
  {
    value: "invalid_unrelated",
    label: "Invalid / unrelated",
    short: "Invalid",
    hint: "Outside the barangay's concern or otherwise not actionable.",
    tone: "critical",
  },
];

/**
 * The completeness checklist. These map 1:1 to the boolean columns on
 * complaints; the day an entry is removed the corresponding column
 * stays on screen but is never written.
 */
export const COMPLETENESS_ITEMS = [
  {
    key: "completeness_complainant_verified",
    label: "Complainant identity verified",
    detail: "The person filing is who they say they are.",
  },
  {
    key: "completeness_contact_verified",
    label: "Contact information verified",
    detail: "The barangay can reach the complainant for follow-up.",
  },
  {
    key: "completeness_incident_date_provided",
    label: "Incident date provided",
    detail: "The complaint states when the incident happened.",
  },
  {
    key: "completeness_incident_location_provided",
    label: "Incident location provided",
    detail: "The complaint states where it happened.",
  },
  {
    key: "completeness_narrative_sufficient",
    label: "Narrative is sufficient",
    detail: "The description is complete enough to assess the matter.",
  },
  {
    key: "completeness_evidence_reviewed",
    label: "Evidence reviewed",
    detail: "Attached evidence (if any) was reviewed, not just listed.",
  },
  {
    key: "completeness_extra_info_required",
    label: "Additional information still needed",
    detail: "Turn ON to require more information; describe it below.",
  },
];

/** Granular kinds of outside assistance a barangay can record. */
export const ASSISTANCE_TYPES = [
  {
    value: "advised_to_report",
    label: "Advised to report to the proper authority",
    short: "Advised to report",
    hint: "The complainant was told which office to report to and how.",
    tone: "neutral",
  },
  {
    value: "assisted_preparing_report",
    label: "Assisted in preparing the external report",
    short: "Assisted report",
    hint: "The barangay helped draft or complete the report to the other agency.",
    tone: "neutral",
  },
  {
    value: "barangay_endorsement",
    label: "Barangay endorsement / referral letter issued",
    short: "Endorsement",
    hint: "A barangay endorsement or referral letter was issued.",
    tone: "neutral",
  },
  {
    value: "existing_report_acknowledged",
    label: "Existing external report acknowledged",
    short: "Report acknowledged",
    hint: "The complainant already filed a report; the barangay noted it.",
    tone: "neutral",
  },
  {
    value: "emergency_assistance_advised",
    label: "Emergency assistance advised",
    short: "Emergency advice",
    hint: "The complainant was advised about emergency hotlines or first response.",
    tone: "neutral",
  },
  {
    value: "other_authorized_assistance",
    label: "Other authorized assistance",
    short: "Other",
    hint: "Anything else the official recorded as authorized assistance.",
    tone: "neutral",
  },
  {
    value: "police_reporting_assistance",
    label: "Police reporting assistance (legacy)",
    short: "PNP assistance",
    hint: "Police referral recorded under the old route-aligned taxonomy.",
    tone: "neutral",
  },
  {
    value: "external_agency_assistance",
    label: "External agency assistance (legacy)",
    short: "Other agency",
    hint: "Other-agency referral recorded under the old route-aligned taxonomy.",
    tone: "neutral",
  },
];

/** The exact sentence the requirements ask for, in one place. */
export const GATE_EXPLANATION =
  "Summons and mediation are unavailable until a respondent is identified and KP applicability is confirmed.";

/** Residents must never be told that an allegation is true. */
export const AI_DISCLAIMER =
  "Automatic classification is decision support only. An authorized barangay official must confirm the category, urgency, and appropriate case route.";

/* ── Lookups ─────────────────────────────────────────────────── */

function byValue(list, value) {
  return list.find((item) => item.value === value) || null;
}

export function respondentStatusMeta(value) {
  return byValue(RESPONDENT_STATUSES, value) || RESPONDENT_STATUSES[0];
}

export function kpApplicabilityMeta(value) {
  return byValue(KP_APPLICABILITIES, value) || KP_APPLICABILITIES[0];
}

export function routingStatusMeta(value) {
  return byValue(ROUTING_STATUSES, value) || ROUTING_STATUSES[0];
}

export function respondentStatusNeedsReason(value) {
  return RESPONDENT_STATUSES_NEEDING_REASON.includes(value);
}

export function kpApplicabilityNeedsReason(value) {
  return KP_APPLICABILITIES_NEEDING_REASON.includes(value);
}

export function complaintNatureMeta(value) {
  return byValue(COMPLAINT_NATURES, value);
}

export function completenessStatusMeta(value) {
  return byValue(COMPLETENESS_STATUSES, value) || COMPLETENESS_STATUSES[0];
}

export function assistanceTypeMeta(value) {
  return byValue(ASSISTANCE_TYPES, value);
}

export function isReferralRoute(value) {
  return REFERRAL_ROUTES.includes(value);
}

/**
 * Display-only wording for the two assessed routing values.
 *
 * The stored values (`pending`, `pending_assessment`) are workflow
 * vocabulary: the RPCs, the gate trigger and every routing-history row
 * read them, so they must not change to make a label read better. Only
 * the words a Captain sees change, through these mappings.
 */
export function kpApplicabilityDisplay(value) {
  if (value === "pending" || !value) return "Pending Assessment";
  return kpApplicabilityMeta(value).short;
}

export function routingStatusDisplay(value) {
  if (value === "pending_assessment" || !value) return "Not Decided";
  return routingStatusMeta(value).short;
}

/**
 * Display wording for the respondent verification state.
 *
 * The modal offers three answers (confirm / correct / unable), and the
 * stored statuses keep their historical meaning — only the wording a
 * Captain sees changes here. `unknown` and `insufficient_information`
 * both read as "Unable to confirm" because the two are the same
 * answer at the Captain level.
 */
export function respondentStatusDisplay(value) {
  if (value === "identified") return "Confirmed";
  if (value === "unknown" || value === "insufficient_information") return "Unable to confirm";
  if (value === "not_applicable") return "No respondent applicable";
  return "Pending confirmation";
}

/**
 * Does this complaint walk the incident pathway — a case with nobody
 * who can be put on notice? Shared by the routing tab and the related
 * records block so the two can never disagree about when a blotter
 * record may be opened or linked.
 */
export function isIncidentLike(complaint) {
  const c = complaint || {};
  return (
    c.complaint_nature === "reported_incident" ||
    isReferralRoute(c.routing_status) ||
    ["unknown", "insufficient_information", "not_applicable"].includes(c.respondent_status)
  );
}

/* ── The information request ──────────────────────────────────── */

/**
 * Is this complaint waiting on the resident to supply something?
 *
 * Two things can open the wait: a completeness outcome of
 * `needs_information`, and a route of `request_additional_information`.
 * Either is enough — an official may use the route directly.
 */
export function isAwaitingResidentInformation(complaint) {
  if (!complaint) return false;
  return (
    complaint.completeness_status === "needs_information" ||
    complaint.routing_status === "request_additional_information"
  );
}

/**
 * Has the resident answered the CURRENT request?
 *
 * Compared as timestamps rather than a response count, because a case
 * can go through several rounds: "please add the receipt" → answered →
 * "we still need the receipt" → answered again. A count cannot tell
 * which round an answer belongs to, so the two timestamps can.
 *
 * @returns {"unanswered" | "answered" | "none"} `none` when nothing has
 *   been requested, so callers can hide the panel entirely.
 */
export function informationRequestState(complaint) {
  if (!isAwaitingResidentInformation(complaint)) return "none";

  const askedAt = complaint.requested_information_at;
  if (!askedAt) return "unanswered";

  const answeredAt = complaint.last_information_response_at;
  if (!answeredAt) return "unanswered";

  return new Date(answeredAt).getTime() >= new Date(askedAt).getTime()
    ? "answered"
    : "unanswered";
}

/* ── The gate ────────────────────────────────────────────────── */

/**
 * Has routing assessment been completed for this complaint?
 *
 * The database is the authority — complaints.workflow_gate_open is
 * set by captain_set_routing() and is enforced by the gate trigger.
 * This function re-derives the same answer from the individual
 * columns so the interface can explain the block, and so a complaint
 * row from before the migration (where the flag was backfilled open)
 * still reads as open instead of appearing stuck.
 */
export function isRoutingComplete(complaint) {
  if (!complaint) return false;
  if (typeof complaint.workflow_gate_open === "boolean") {
    return complaint.workflow_gate_open;
  }
  return (
    complaint.respondent_status === "identified" &&
    complaint.kp_applicability === "applicable"
  );
}

/**
 * One status object describing what the case is waiting on. Every
 * disabled control in the case viewer uses this for its explanation,
 * so the reason a button is disabled is always the same sentence.
 *
 * @returns {{ open: boolean, headline: string, detail: string, reason: string }}
 */
export function routingGate(complaint) {
  if (isRoutingComplete(complaint)) {
    return {
      open: true,
      headline: "Party steps permitted",
      detail:
        "The respondent is identified and KP applicability is confirmed. A summons, hearing, or 15-day period may now be recorded.",
      reason: "",
    };
  }

  const respondent = complaint?.respondent_status || "pending";
  const kp = complaint?.kp_applicability || "pending";

  if (respondent !== "identified") {
    const meta = respondentStatusMeta(respondent);
    return {
      open: false,
      headline: "Blocked: respondent not identified",
      detail: meta.hint,
      reason: GATE_EXPLANATION,
    };
  }

  if (kp !== "applicable") {
    const meta = kpApplicabilityMeta(kp);
    return {
      open: false,
      headline: "Blocked: KP applicability not confirmed",
      detail: meta.hint,
      reason: GATE_EXPLANATION,
    };
  }

  return {
    open: false,
    headline: "Blocked: route not actionable",
    detail:
      "The respondent is identified and KP is applicable, but the case has not been routed to mediation or the Pangkat yet.",
    reason: GATE_EXPLANATION,
  };
}

/**
 * Can this official record a routing decision? Mirrors the SQL guard
 * in is_routing_official(). Client-side only: it hides controls the
 * caller could not use. The RPC refuses regardless.
 */
export function canDecideRouting(role) {
  return role === "captain" || role === "oic";
}

/**
 * What the Captain's "next action" line should say on a blocked case.
 * Kept next to routingGate so the list and the detail page cannot
 * give different advice.
 */
export function routingNextAction(complaint) {
  if (isRoutingComplete(complaint)) return null;

  const respondent = complaint?.respondent_status || "pending";
  if (respondent !== "identified") {
    return { label: "Respondent assessment", value: respondentStatusMeta(respondent).label };
  }
  return {
    label: "KP applicability",
    value: kpApplicabilityMeta(complaint?.kp_applicability).label,
  };
}

const TERMINAL_ROUTES = ["closed", "withdrawn", "rejected", "resolved_at_intake"];

/**
 * What the single "Continue Case Processing" action on the case viewer
 * should look like for THIS complaint, right now. Returns one object:
 *
 *   { label, hint, kind, tab, disabled }
 *
 * `kind` is a target the calling page can hand to the Routing tab
 * (completeness | incident | blotter | assistance | decision) or to the
 * Workflow actions (workflow | receive), and `disabled: true` for a
 * closed file. The label is the exact wording from the case flow so a
 * Captain always knows what step is actually next.
 */
export function routingCta(complaint, opts = {}) {
  const c = complaint || {};
  const status = c.routing_status || "pending_assessment";
  const {
    hasBlotter = false,
    hasIncidentDetails = false,
    hasAssistance = false,
    isReceived = false,
  } = opts;

  if (TERMINAL_ROUTES.includes(status)) {
    return {
      label: "View Final Record",
      hint: "This case file is closed. Its record can still be opened.",
      kind: "none",
      tab: "overview",
      disabled: true,
    };
  }

  // The route has not been decided yet: finish the assessment first.
  if (status === "pending_assessment") {
    return {
      label: "Complete Routing Assessment",
      hint: c.completeness_status === "pending_review"
        ? "Check the submission and decide where this case goes."
        : "Decide the route and, where applicable, the KP standing of this case.",
      kind: "routing",
      tab: "routing",
      disabled: false,
    };
  }

  // The submission is now complete but the case is still parked on the
  // "request more information" route. The assessment is done; the route
  // is not. Checked before the request state below, which would
  // otherwise report the case as still waiting on the resident.
  if (
    status === "request_additional_information" &&
    c.completeness_status === "complete"
  ) {
    return {
      label: "Decide the Route",
      hint: "The information has been supplied and reviewed. Update the route to where this case goes next.",
      kind: "routing",
      tab: "routing",
      disabled: false,
    };
  }

  // An information request is outstanding. The Captain's job is done
  // until the resident answers, so the CTA must not keep asking them to
  // request information they have already requested.
  const infoState = informationRequestState(c);
  if (infoState === "unanswered") {
    return {
      label: "Awaiting Resident Information",
      hint: c.requested_information_at
        ? "The resident was asked and has not answered yet. They can reply from their complaint page."
        : "Record what the complainant still has to provide.",
      kind: "routing",
      tab: "routing",
      disabled: false,
    };
  }

  if (infoState === "answered") {
    return {
      label: "Review Resident Response",
      hint: "The resident supplied the requested information. Re-record the completeness review and decide the route.",
      kind: "routing",
      tab: "routing",
      disabled: false,
    };
  }

  const incidentLike =
    c.complaint_nature === "reported_incident" ||
    REFERRAL_ROUTES.includes(status) ||
    ["unknown", "insufficient_information", "not_applicable"].includes(
      c.respondent_status
    );

  /**
   * A reported incident (or any case with no one who can be summoned)
   * never opens the gate, so the assessment branch above must not be
   * used as its "next step" — the case would send the Captain back to
   * an assessment that can never be completed. It walks its own
   * sequence instead: incident details, blotter record, then the
   * reporting assistance.
   */
  if (incidentLike) {
    if (!hasIncidentDetails) {
      return {
        label: "Record Incident Action",
        hint: "Capture what is known about the incident (property, witnesses, evidence).",
        kind: "incident",
        tab: "routing",
        disabled: false,
      };
    }
    if (!hasBlotter) {
      return {
        label: "Create or Link Blotter",
        hint: "Open a barangay blotter record for this incident, or attach an existing one.",
        kind: "blotter",
        tab: "routing",
        disabled: false,
      };
    }
    if (REFERRAL_ROUTES.includes(status) && !hasAssistance) {
      return {
        label: "Record Reporting Assistance",
        hint: "Record the assistance given for reporting this incident.",
        kind: "assistance",
        tab: "routing",
        disabled: false,
      };
    }
    return {
      label: "Close or Archive Record",
      hint: "The incident is recorded. Record the disposition or archive the case file.",
      kind: "workflow",
      tab: "workflow",
      disabled: false,
    };
  }

  if (status === "service_action") {
    return {
      label: "Assign for Action",
      hint: "Confirm the barangay service this complaint is referred to.",
      kind: "decision",
      tab: "routing",
      disabled: false,
    };
  }

  if (status === "administrative_review" || status === "administrative_handling") {
    return {
      label: "Start Administrative Review",
      hint: "Begin the administrative review of this complaint.",
      kind: "decision",
      tab: "routing",
      disabled: false,
    };
  }

  // A KP-eligible case that has been routed but not yet officially
  // received is "not accepted for KP processing" yet.
  if (PARTY_FACING_ROUTES.includes(status) && !isReceived) {
    return {
      label: "Accept for KP Processing",
      hint: "Receive the complaint so the KP period can start.",
      kind: "receive",
      tab: "workflow",
      disabled: false,
    };
  }

  // The gate is still shut for a reason the incident pathway does not
  // cover: say what is missing rather than sending the Captain back to
  // an assessment they have already finished.
  if (!isRoutingComplete(c)) {
    return {
      label: "Complete Routing Assessment",
      hint: routingNextAction(c)
        ? `Waiting on: ${routingNextAction(c).label}.`
        : "The respondent and KP applicability still have to be recorded.",
      kind: "routing",
      tab: "routing",
      disabled: false,
    };
  }

  return {
    label: "Continue Case Processing",
    hint: "Open the official actions for this case.",
    kind: "workflow",
    tab: "workflow",
    disabled: false,
  };
}

/* ── Reads ───────────────────────────────────────────────────── */

/**
 * Routing history, assistance records, incident details and the linked
 * blotter record for one complaint.
 *
 * Read-only, and tolerant: if the routing migration has not been
 * applied yet the query fails and the page shows an empty history
 * rather than a broken case file. That is deliberate — a Captain
 * should still be able to open a case that predates this feature.
 */
export async function fetchRoutingContext(supabase, complaintId) {
  const [historyRes, assistanceRes, incidentRes, blotterRes] = await Promise.all([
    supabase
      .from("complaint_routing_history")
      .select(
        "id, respondent_status_before, respondent_status_after, respondent_name_before, respondent_name_after, kp_applicability_before, kp_applicability_after, routing_status_before, routing_status_after, complaint_nature_before, complaint_nature_after, completeness_status_before, completeness_status_after, reason, remarks, resident_message, acted_by_name, acted_by_role, created_at"
      )
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("complaint_assistance_records")
      .select(
        "id, assistance_type, agency_name, reference_number, assistance_given, assistance_summary, follow_up_required, follow_up_due_on, recorded_outcome, related_document_id, recorded_by_name, recorded_at"
      )
      .eq("complaint_id", complaintId)
      .order("recorded_at", { ascending: false }),
    supabase
      .from("complaint_incident_details")
      .select(
        "id, property_description, incident_value, proof_of_ownership, plate_number, serial_number, engine_chassis_number, identifiable_marks, last_known_location, last_known_at, witnesses, cctv_available, cctv_notes, evidence_notes, safety_concern, safety_notes, already_reported_externally, externally_reported_where, external_reference, incident_details_other, recorded_by_name, updated_at"
      )
      .eq("complaint_id", complaintId)
      .maybeSingle(),
    supabase
      .from("blotter_records")
      .select("id, blotter_number, current_status, incident_date, incident_location, incident_summary, recorded_at")
      .eq("complaint_id", complaintId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    routingHistory: historyRes.error ? [] : historyRes.data || [],
    assistanceRecords: assistanceRes.error ? [] : assistanceRes.data || [],
    incidentDetails: incidentRes.error ? null : incidentRes.data || null,
    linkedBlotter: blotterRes.error ? null : blotterRes.data || null,
    // Surfaced so the UI can say "apply the routing migration" instead
    // of silently rendering as though nothing were recorded.
    unavailable: Boolean(historyRes.error || assistanceRes.error),
  };
}

/* ── Writes (RPC only) ────────────────────────────────────────── */

/**
 * Record what is known about the respondent.
 *
 * This does NOT set a route. Knowing a name does not decide where a
 * case goes, and a single function that did both would make it far
 * too easy to open the gate by accident.
 */
export async function recordRespondentStatus(
  supabase,
  { complaintId, respondentStatus, respondentName, reason, residentMessage }
) {
  if (!respondentStatus) {
    return { success: false, error: "Choose a respondent status." };
  }
  if (respondentStatusNeedsReason(respondentStatus) && !(reason || "").trim()) {
    return {
      success: false,
      error: "Record why, so the decision can be explained later.",
    };
  }
  if (respondentStatus === "identified" && !(respondentName || "").trim()) {
    return {
      success: false,
      error:
        "Name the respondent, or choose a status that says they are not identified. Do not enter a placeholder.",
    };
  }

  const { data, error } = await supabase.rpc("captain_record_respondent_status", {
    p_complaint_id: complaintId,
    p_respondent_status: respondentStatus,
    p_respondent_name: (respondentName || "").trim() || null,
    p_reason: (reason || "").trim() || null,
    p_resident_message: (residentMessage || "").trim() || null,
  });

  if (error) return { success: false, error: humanizeRpcError(error, "respondent status") };
  return { success: true, data };
}

/**
 * Decide the route and the KP applicability in one step, because the
 * two are the same decision: applicability without a route records
 * nothing actionable, and a route without applicability is the exact
 * mistake this feature exists to prevent.
 */
export async function setRouting(
  supabase,
  { complaintId, routingStatus, kpApplicability, kpReason, reason, remarks, residentMessage }
) {
  if (!routingStatus) return { success: false, error: "Choose a case route." };
  if (!kpApplicability) return { success: false, error: "Choose a KP applicability." };

  if (kpApplicabilityNeedsReason(kpApplicability) && !(kpReason || "").trim()) {
    return {
      success: false,
      error: "A written reason is required for this KP applicability.",
    };
  }
  if (PARTY_FACING_ROUTES.includes(routingStatus) && !(reason || "").trim()) {
    return {
      success: false,
      error: "A written reason is required before routing to mediation or the Pangkat.",
    };
  }
  if (REFERRAL_ROUTES.includes(routingStatus) && !(reason || "").trim()) {
    return {
      success: false,
      error: "A written reason is required before routing to a referral or an incident pathway.",
    };
  }
  if (["service_action", "administrative_review", "duplicate_review",
       "other_authorized_route"].includes(routingStatus) && !(reason || "").trim()) {
    return {
      success: false,
      error: "A written reason is required for this route.",
    };
  }
  if (
    kpApplicability === "applicable" &&
    !(reason || "").trim() &&
    !PARTY_FACING_ROUTES.includes(routingStatus)
  ) {
    return { success: false, error: "Record the basis for finding KP applicable." };
  }

  const { data, error } = await supabase.rpc("captain_set_routing", {
    p_complaint_id: complaintId,
    p_routing_status: routingStatus,
    p_kp_applicability: kpApplicability,
    p_kp_reason: (kpReason || "").trim() || null,
    p_reason: (reason || "").trim() || null,
    p_remarks: (remarks || "").trim() || null,
    p_resident_message: (residentMessage || "").trim() || null,
  });

  if (error) return { success: false, error: humanizeRpcError(error, "routing") };
  return { success: true, data };
}

/** Attach an existing blotter record to this complaint. */
export async function linkBlotterRecord(supabase, { complaintId, blotterId, reason }) {
  if (!blotterId) return { success: false, error: "Choose a blotter record." };
  if (!(reason || "").trim()) {
    return { success: false, error: "Record why this blotter entry belongs to this complaint." };
  }

  const { data, error } = await supabase.rpc("captain_link_blotter_record", {
    p_complaint_id: complaintId,
    p_blotter_id: blotterId,
    p_reason: reason.trim(),
  });

  if (error) return { success: false, error: humanizeRpcError(error, "blotter link") };
  return { success: true, data };
}

/**
 * Record a referral to the PNP or another office.
 *
 * The wording of every field here is chosen to avoid claiming
 * something the barangay cannot know. There is deliberately no
 * "status" enum and no "police_case_number" field: the official
 * records what they did and what they were told, in their own words.
 */
export async function recordAssistance(
  supabase,
  {
    complaintId,
    assistanceType,
    agencyName,
    referenceNumber,
    assistanceGiven,
    assistanceSummary,
    followUpRequired,
    followUpDueOn,
    recordedOutcome,
    relatedDocumentId,
    residentMessage,
  }
) {
  if (!assistanceType) return { success: false, error: "Choose the type of assistance." };
  const agency = (agencyName || "").trim() || null;
  const given = (assistanceGiven || "").trim() || null;
  const summary = (assistanceSummary || "").trim() || null;

  // "Receiving office, if known": the record may stand on the office,
  // on the description of what was done, or on a short summary.
  if (!agency && !given && !summary) {
    return {
      success: false,
      error: "Name the office the referral went to, describe the assistance given, or add a short summary.",
    };
  }

  const { data, error } = await supabase.rpc("captain_record_assistance", {
    p_complaint_id: complaintId,
    p_assistance_type: assistanceType,
    p_agency_name: agency,
    p_reference_number: (referenceNumber || "").trim() || null,
    p_assistance_given: given,
    p_assistance_summary: summary,
    p_follow_up_required: Boolean(followUpRequired),
    p_follow_up_due_on: followUpDueOn || null,
    p_recorded_outcome: (recordedOutcome || "").trim() || null,
    p_related_document_id: relatedDocumentId || null,
    p_resident_message: (residentMessage || "").trim() || null,
  });

  if (error) return { success: false, error: humanizeRpcError(error, "assistance record") };
  return { success: true, data };
}

/**
 * Record the completeness review, the single complaint nature, and any
 * request for more information.
 *
 * A "complete" review only closes the completeness review; the actual
 * route is still set by setRouting(). A "needs_information" review must
 * say what is being requested — the DB and the form both enforce it.
 */
export async function recordCompleteness(
  supabase,
  {
    complaintId,
    completenessStatus,
    complaintNature,
    checklist = {},
    remarks,
    requestedInformation,
    residentMessage,
  }
) {
  if (!completenessStatus) return { success: false, error: "Choose a completeness outcome." };
  if (
    (completenessStatus === "needs_information" ||
      checklist.completeness_extra_info_required) &&
    !(requestedInformation || "").trim()
  ) {
    return {
      success: false,
      error: "Say what information the complainant must provide.",
    };
  }
  if (completenessStatus === "complete" && !complaintNature) {
    return {
      success: false,
      error: "Choose the nature of the complaint before marking it complete.",
    };
  }

  const { data, error } = await supabase.rpc("captain_record_completeness", {
    p_complaint_id: complaintId,
    p_completeness_status: completenessStatus,
    p_complaint_nature: complaintNature || null,
    p_complainant_verified: Boolean(checklist.completeness_complainant_verified),
    p_contact_verified: Boolean(checklist.completeness_contact_verified),
    p_incident_date_provided: Boolean(checklist.completeness_incident_date_provided),
    p_incident_location_provided: Boolean(
      checklist.completeness_incident_location_provided
    ),
    p_narrative_sufficient: Boolean(checklist.completeness_narrative_sufficient),
    p_evidence_reviewed: Boolean(checklist.completeness_evidence_reviewed),
    p_extra_info_required: Boolean(checklist.completeness_extra_info_required),
    p_remarks: (remarks || "").trim() || null,
    p_requested_information: (requestedInformation || "").trim() || null,
    p_resident_message: (residentMessage || "").trim() || null,
  });

  if (error) return { success: false, error: humanizeRpcError(error, "completeness review") };
  return { success: true, data };
}

/** Incident specifics for a reported-incident complaint. */
export async function saveIncidentDetails(supabase, complaintId, incident = {}) {
  const bool = (v) => Boolean(v);
  const { data, error } = await supabase.rpc("captain_save_incident_details", {
    p_complaint_id: complaintId,
    p_property_description: incident.property_description || null,
    p_incident_value: incident.incident_value || null,
    p_proof_of_ownership: incident.proof_of_ownership || null,
    p_plate_number: incident.plate_number || null,
    p_serial_number: incident.serial_number || null,
    p_engine_chassis_number: incident.engine_chassis_number || null,
    p_identifiable_marks: incident.identifiable_marks || null,
    p_last_known_location: incident.last_known_location || null,
    p_last_known_at: incident.last_known_at || null,
    p_witnesses: incident.witnesses || null,
    p_cctv_available: bool(incident.cctv_available),
    p_cctv_notes: incident.cctv_notes || null,
    p_evidence_notes: incident.evidence_notes || null,
    p_safety_concern: bool(incident.safety_concern),
    p_safety_notes: incident.safety_notes || null,
    p_already_reported_externally: bool(incident.already_reported_externally),
    p_externally_reported_where: incident.externally_reported_where || null,
    p_external_reference: incident.external_reference || null,
    p_incident_details_other: incident.incident_details_other || null,
  });

  if (error) return { success: false, error: humanizeRpcError(error, "incident details") };
  return { success: true, data };
}

/**
 * Open a blotter record from inside the complaint case sheet. The RPC
 * refuses a second OPEN record for the same complaint, writes the
 * resident-safe status row + notification, and never fabricates a
 * respondent name on the ledger.
 */
export async function createBlotterRecord(
  supabase,
  {
    complaintId,
    incidentSummary,
    incidentDate,
    incidentLocation,
    residentMessage,
  }
) {
  if (!(incidentSummary || "").trim()) {
    return { success: false, error: "Write an incident summary for the blotter record." };
  }

  const { data, error } = await supabase.rpc("captain_create_blotter_record", {
    p_complaint_id: complaintId,
    p_incident_summary: incidentSummary.trim(),
    p_incident_date: incidentDate || null,
    p_incident_location: (incidentLocation || "").trim() || null,
    p_resident_message: (residentMessage || "").trim() || null,
  });

  if (error) return { success: false, error: humanizeRpcError(error, "blotter record") };
  return { success: true, data };
}

/* ── Resident information responses ───────────────────────────── */

/**
 * The answers a resident gave to an information request, newest first,
 * with the evidence files each answer carried.
 *
 * Tolerant by design: the table is created by a migration the user runs
 * by hand, so a case opened before that migration is simply an empty
 * list rather than a broken screen.
 */
export async function fetchInformationResponses(supabase, complaintId) {
  if (!complaintId) return [];

  const { data, error } = await supabase
    .from("complaint_information_responses")
    .select("id, response_text, created_at, complaint_information_response_files(evidence_id)")
    .eq("complaint_id", complaintId)
    .order("created_at", { ascending: false });

  if (error) return [];

  return (data || []).map((row) => {
    const files = row.complaint_information_response_files || [];
    return {
      id: row.id,
      text: row.response_text || "",
      created_at: row.created_at,
      evidenceIds: files.map((f) => f.evidence_id).filter(Boolean),
    };
  });
}

/**
 * Resident side: submit an answer to an outstanding information request.
 *
 * Goes through resident_provide_requested_information(), which is the
 * only writer of the table and re-checks ownership, the waiting state,
 * and the ownership of every attachment server-side.
 */
export async function provideRequestedInformation(
  supabase,
  { complaintId, text, evidenceIds }
) {
  const body = (text || "").trim();
  const ids = (evidenceIds || []).filter(Boolean);

  if (!body && ids.length === 0) {
    return { success: false, error: "Write an answer or attach a file." };
  }

  const { data, error } = await supabase.rpc("resident_provide_requested_information", {
    p_complaint_id: complaintId,
    p_response_text: body || null,
    p_evidence_ids: ids.length ? ids : null,
  });

  if (error) return { success: false, error: humanizeRpcError(error, "your response") };
  return { success: true, data };
}

/**
 * The resident's own view of the routing state, from the projection that
 * deliberately omits every internal field. Returns null when the
 * migration has not been applied or the caller may not read it.
 */
export async function fetchResidentRoutingView(supabase, complaintId) {
  const { data, error } = await supabase.rpc("complaint_routing_resident_view", {
    p_complaint_id: complaintId,
  });

  if (error) return null;
  return Array.isArray(data) ? data[0] || null : data || null;
}

/* ── Errors ──────────────────────────────────────────────────── */

/**
 * The gate trigger raises 23514 with a long, readable message, and
 * the RPCs raise 23514 / 23505 / 22023 with their own. Supabase wraps
 * those in a generic PostgREST error, so the useful text has to be
 * pulled out of the message rather than replaced by it.
 */
function humanizeRpcError(error, subject) {
  const raw = String(error?.message || "");
  const lower = raw.toLowerCase();

  if (lower.includes("cannot proceed to a summons")) {
    return GATE_EXPLANATION;
  }
  if (lower.includes("require an identified respondent")) {
    return GATE_EXPLANATION;
  }
  if (lower.includes("routing fields are official records")) {
    return "This change must be made from the Routing tab so it is recorded in the audit log.";
  }
  if (lower.includes("already has an open blotter record")) {
    return "This complaint already has an open blotter record. Close or correct it first.";
  }
  if (lower.includes("would contradict the case file")) {
    return "The route on this case does not match that kind of referral. Change the route first.";
  }
  if (lower.includes("requires a written reason")) {
    return "A written reason is required. Record why the case is being routed this way.";
  }
  if (lower.includes("must say what information")) {
    return "Say what information the complainant must provide.";
  }
  if (lower.includes("already has an open blotter")) {
    return "This complaint already has an open blotter record. Link or view it instead of creating another.";
  }
  if (lower.includes("incident details are for reported-incident complaints")) {
    return "Incident details are only for reported-incident complaints. Record a reported-incident nature first, or route the case to incident documentation.";
  }
  if (lower.includes("completeness")) {
    return "Complete the required fields in the routing review before continuing.";
  }
  if (lower.includes("only the barangay captain or oic")) {
    return "Only the Barangay Captain or OIC can decide the case route.";
  }
  if (lower.includes("not waiting for additional information")) {
    return "This complaint is not waiting for more information right now.";
  }
  if (lower.includes("only answer an information request on your own")) {
    return "You can only answer an information request on your own complaint.";
  }
  if (lower.includes("write an answer or attach a file")) {
    return "Write an answer or attach a file before sending.";
  }
  if (lower.includes("could not be used")) {
    return "One of the attachments could not be attached. Upload the file again.";
  }
  if (lower.includes("could not find the function")) {
    return "The routing migration has not been applied yet. Run captain-complaint-routing-workflow.sql and captain-complaint-routing-rls.sql.";
  }
  if (error?.code === "42501") {
    return "Your account is not permitted to record this decision.";
  }

  // Anything left: prefer the SQL RAISE text, which is written to be
  // shown to an official, over the wrapper.
  const match = raw.match(/^([\s\S]*?)(?:\s*\((?:[0-9a-f-]{36})\))?\s*$/);
  const cleaned = (match ? match[1] : raw).trim();
  if (cleaned && !/^(null|undefined)$/i.test(cleaned)) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return `Could not record the ${subject}. Please try again.`;
}
