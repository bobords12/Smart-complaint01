/**
 * Routing assessment and decision — the case detail tab.
 *
 * This tab answers three questions, in the order the work happens:
 *
 *   1. Pre-Routing Review — is the submission ready to be assessed?
 *      Completeness, what was requested from the resident, the matter
 *      type, and the checks actually recorded (CompletenessModal).
 *   2. Respondent — has the other party been verified? The name the
 *      resident filed stays on screen next to what an official
 *      confirmed, so the two can always be compared.
 *   3. KP & Case Route — is Katarungang Pambarangay applicable, and
 *      where does this case go (RoutingDecisionModal), the only step
 *      that can open the gate.
 *
 * KP applicability and the case route are deliberately kept as two
 * separate fields: one is an assessment of the dispute, the other is
 * the operational path the complaint follows. Neither is derived from
 * the AI classification.
 *
 * Read vs. write is split deliberately:
 *   * Every official reads the routing state. A barangay secretary
 *     needs to see why a case is blocked as much as the Captain does.
 *   * Only the Captain and OIC decide. canDecideRouting() hides the
 *     buttons, and the SQL guards refuse the writes regardless of what
 *     the interface shows.
 *
 * Nothing on this tab can be reached that would let a party step
 * happen while the gate is shut. The tab explains the block rather
 * than hiding it, because an official who cannot see why a button is
 * disabled will eventually work around it.
 */

"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Paperclip,
  Scale,
  ShieldAlert,
  Users,
} from "lucide-react";
import {
  COMPLETENESS_ITEMS,
  canDecideRouting,
  completenessStatusMeta,
  complaintNatureMeta,
  isIncidentLike,
  isAwaitingResidentInformation,
  informationRequestState,
  kpApplicabilityDisplay,
  kpApplicabilityMeta,
  respondentStatusDisplay,
  respondentStatusMeta,
  routingGate,
  routingStatusDisplay,
  routingStatusMeta,
} from "@/lib/captainComplaintRouting";
import { formatDateTime } from "./complaintMeta";
import RespondentAssessmentModal from "./RespondentAssessmentModal";
import RoutingDecisionModal from "./RoutingDecisionModal";
import CompletenessModal from "./CompletenessModal";
import IncidentDetailsModal from "./IncidentDetailsModal";

const TONES = {
  ok: "border-[#17774e]/25 bg-success-soft text-success",
  warning: "border-[#b45309]/25 bg-warning-soft text-warning",
  critical: "border-[#b5493b]/25 bg-critical-soft text-critical",
  info: "border-[#1b4c8c]/20 bg-info-soft text-secondary",
  neutral: "border-line bg-alt text-muted",
};

function toneClass(tone) {
  return TONES[tone] || TONES.neutral;
}

function StatePill({ meta, text }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass(meta.tone)}`}
    >
      {text || meta.short}
    </span>
  );
}

function Row({ label, children, hint }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold text-mirage">{children || "—"}</div>
      {hint ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * One area inside the Case Routing & Parties accordion.
 *
 * Deliberately not a card: three of these sit inside the parent
 * surface, and a rounded box inside a rounded box makes a form look
 * like a stack of boxes. A rule and a small heading separate the
 * areas instead.
 */
function Section({ title, icon: Icon, action, children }) {
  return (
    <section className="border-t border-line pt-4">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-navy">
          <Icon className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
          {title}
        </h3>
        {action}
      </header>
      <div>{children}</div>
    </section>
  );
}

/** Verb + object label used by every action on this tab. */
function SectionAction({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-xs font-semibold text-mirage transition-colors hover:bg-alt"
    >
      {children}
    </button>
  );
}

export default function RoutingTab({
  supabase,
  role,
  complaint,
  routingHistory = [],
  routingUnavailable = false,
  incidentDetails,
  informationResponses = [],
  evidence = [],
  focus,
  onFocusCleared,
  onChanged,
}) {
  const gate = routingGate(complaint);
  const mayDecide = canDecideRouting(role);

  const respondent = respondentStatusMeta(complaint?.respondent_status);
  const kp = kpApplicabilityMeta(complaint?.kp_applicability);
  const route = routingStatusMeta(complaint?.routing_status);
  const completeness = completenessStatusMeta(complaint?.completeness_status);
  const nature = complaintNatureMeta(complaint?.complaint_nature);

  // Whether the resident still owes an answer, or has already sent one.
  const infoState = informationRequestState(complaint);

  // A reported incident, or a case with no one who can be summoned,
  // walks the incident documentation pathway.
  const incidentLike = isIncidentLike(complaint);

  // The recorded answers this tab is built around. Each is read from
  // its own column: a value that has not been recorded stays missing
  // and is shown as such, never inferred from a neighbouring field.
  const reviewRecorded = Boolean(
    complaint?.completeness_status && complaint.completeness_status !== "pending_review"
  );
  const respondentRecorded = Boolean(
    complaint?.respondent_status && complaint.respondent_status !== "pending"
  );
  const respondentIdentified = complaint?.respondent_status === "identified";
  const kpAssessed = Boolean(
    complaint?.kp_applicability && complaint.kp_applicability !== "pending"
  );
  const routeDecided = Boolean(
    complaint?.routing_status && complaint.routing_status !== "pending_assessment"
  );

  // What an official confirmed, kept separate from what the resident
  // filed. Both stay on screen; neither overwrites the other.
  const confirmedRespondent = (complaint?.respondent_display_name || "").trim();

  // The checks the completeness review actually recorded.
  const recordedChecks = COMPLETENESS_ITEMS.filter((item) => complaint?.[item.key]);

  /**
   * ONE notice for the whole tab, and it answers two different
   * questions without confusing them:
   *
   *   recorded  have all three answers (respondent, KP, route) been
   *             written to the case file?
   *   open      may a summons, hearing or 15-day period be recorded?
   *
   * The second can be "no" while the first is "yes" — a reported
   * incident is fully recorded and still has nobody who can be
   * summoned — so the banner says whichever of the two is the one an
   * official still has to act on. The gate's own sentence stays
   * behind "View details" while the answers are still missing, and is
   * printed outright once they are not.
   */
  const routingIncomplete = !(respondentRecorded && kpAssessed && routeDecided);
  const incompleteCopy = !respondentRecorded
    ? "Confirm the respondent and assess KP applicability before proceeding with the appropriate case route."
    : !kpAssessed
      ? respondentIdentified
        ? "The respondent is confirmed. Assess KP applicability before proceeding with the appropriate case route."
        : "The other party is not identified for this complaint. Record the KP assessment that applies to it."
      : respondentIdentified
        ? "The respondent and KP applicability are recorded. Decide the case route to complete routing."
        : "The KP assessment is recorded. Decide the case route to complete routing.";

  const routingComplete = !routingIncomplete && gate.open;
  const noticeTitle = routingComplete
    ? "Routing complete"
    : routingIncomplete
      ? "Routing incomplete"
      : "Routing recorded";
  const noticeBody = routingComplete
    ? "The respondent, KP applicability and case route are recorded for this complaint."
    : routingIncomplete
      ? incompleteCopy
      : `${gate.headline}.${gate.detail ? ` ${gate.detail}` : ""}`;

  const [modals, setModals] = useState({
    completeness: false,
    respondent: false,
    route: false,
    incident: false,
  });

  /**
   * The "Continue Case Processing" CTA on the case viewer asks this tab
   * to open the step that is actually next. `focus` carries that step
   * (see routingCta in captainComplaintRouting.js); it is turned into an
   * open/closed answer rather than an effect, so no modal is opened
   * behind the official's back by a cascading render. Blotter and
   * referral steps belong to Related Records and are handled there.
   */
  const focusedKeys = useMemo(() => {
    if (!focus) return [];
    if (focus === "routing") {
      return [complaint?.respondent_status !== "identified" ? "respondent" : "route"];
    }
    if (focus === "decision") return ["route"];
    if (["completeness", "incident"].includes(focus)) {
      return [focus];
    }
    return [];
  }, [focus, complaint?.respondent_status]);

  const isOpen = (key) => modals[key] || focusedKeys.includes(key);

  const open = (key) => setModals((m) => ({ ...m, [key]: true }));

  const close = (key) => {
    setModals((m) => ({ ...m, [key]: false }));
    // A modal opened by the CTA is held open by the focus, so closing
    // it has to release that focus as well.
    if (focusedKeys.includes(key) && onFocusCleared) onFocusCleared();
  };

  return (
    <div className="space-y-4">
      {/* ── One notice: what is still missing before routing ────── */}
      <section
        className={`rounded-xl border px-4 py-3 sm:px-5 ${
          routingComplete
            ? "border-[#17774e]/25 bg-success-soft"
            : "border-[#b45309]/25 bg-warning-soft"
        }`}
        role="status"
      >
        <div className="flex items-start gap-3">
          {routingComplete ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                routingComplete ? "text-success" : "text-warning"
              }`}
            >
              {noticeTitle}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-mirage">{noticeBody}</p>
            {routingIncomplete && !gate.open ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-warning">
                  View details
                </summary>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {gate.headline}
                  {gate.detail ? ` — ${gate.detail}` : ""}
                </p>
              </details>
            ) : null}
          </div>
        </div>
      </section>

      {routingUnavailable ? (
        <p className="rounded-xl border border-line bg-alt px-4 py-3 text-xs leading-relaxed text-muted">
          Routing records are not available. Apply{" "}
          <code className="font-mono">captain-complaint-routing-workflow.sql</code> and{" "}
          <code className="font-mono">captain-complaint-routing-rls.sql</code> to record routing
          decisions. The case itself is unaffected.
        </p>
      ) : null}

      {/* ── 1. Pre-routing review ──────────────────────────────── */}
      <Section
        title="Pre-Routing Review"
        icon={ClipboardCheck}
        action={
          mayDecide ? (
            <SectionAction onClick={() => open("completeness")}>Review Submission</SectionAction>
          ) : null
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Row label="Completeness">
            <StatePill meta={completeness} />
          </Row>
          <Row label="Information needed">
            {complaint?.requested_information || "None"}
          </Row>
          <Row label="Matter type">
            {nature ? <StatePill meta={nature} /> : <StatePill meta={neutralNature()} />}
          </Row>
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <Row
            label="Review status"
            hint={
              recordedChecks.length > 0
                ? recordedChecks.map((item) => item.label).join(" · ")
                : undefined
            }
          >
            <StatePill
              meta={reviewRecorded ? completeness : { tone: "neutral" }}
              text={reviewRecorded ? "Recorded" : "Not recorded"}
            />
          </Row>
        </div>

        {isAwaitingResidentInformation(complaint) ? (
          <div
            className={`mt-4 rounded-xl border px-4 py-3 text-xs font-semibold leading-relaxed ${
              infoState === "answered"
                ? "border-[#17774e]/25 bg-success-soft text-success"
                : "border-[#b45309]/25 bg-warning-soft text-warning"
            }`}
          >
            {infoState === "answered" ? (
              <>
                The resident supplied the requested information on{" "}
                {formatDateTime(complaint.last_information_response_at)}. Review the
                response below, then re-record the completeness review.
              </>
            ) : (
              <>
                The submission is incomplete. The complainant was asked
                {complaint?.requested_information_at
                  ? ` on ${formatDateTime(complaint.requested_information_at)}`
                  : ""}{" "}
                and has not answered yet. The case stays on hold until it
                arrives — no action is needed from the desk in the meantime.
              </>
            )}
          </div>
        ) : null}

        {informationResponses.length > 0 ? (
          <div className="mt-4 space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Resident response{informationResponses.length > 1 ? "s" : ""}
            </p>
            {informationResponses.map((response) => {
              const files = (evidence || []).filter((ev) =>
                response.evidenceIds.includes(ev.id)
              );
              return (
                <article
                  key={response.id}
                  className="rounded-xl border border-line bg-alt px-4 py-3"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {formatDateTime(response.created_at)}
                  </p>
                  {response.text ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-mirage">
                      {response.text}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-sm italic text-muted">
                      Answered with attachments only.
                    </p>
                  )}
                  {files.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {files.map((file) => (
                        <li key={file.id} className="flex items-center gap-2 text-xs text-mirage">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                          {file.original_filename || file.storage_path?.split("/").pop()}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}

      </Section>

      {/* ── 2. Respondent ───────────────────────────────────────── */}
      <Section
        title="Respondent"
        icon={Users}
        action={
          mayDecide ? (
            <SectionAction onClick={() => open("respondent")}>
              {respondentRecorded ? "Edit Respondent" : "Verify Respondent"}
            </SectionAction>
          ) : null
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Row label="Respondent as filed">{complaint?.persons_involved || "—"}</Row>
          {confirmedRespondent ? (
            <Row label="Confirmed respondent">{confirmedRespondent}</Row>
          ) : null}
          <Row label="Verification">
            <StatePill
              meta={respondent}
              text={respondentStatusDisplay(complaint?.respondent_status)}
            />
          </Row>
        </div>
        {complaint?.respondent_identified_at ? (
          <p className="mt-3 text-xs text-muted">
            Recorded {formatDateTime(complaint.respondent_identified_at)}.
          </p>
        ) : null}
      </Section>

      {/* ── 3. KP applicability + route ────────────────────────── */}
      <Section
        title="KP & Case Route"
        icon={Scale}
        action={
          mayDecide ? (
            <SectionAction onClick={() => open("route")}>
              {routeDecided ? "Review Route" : "Assess Route"}
            </SectionAction>
          ) : null
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="KP applicability">
            <StatePill
              meta={kp}
              text={kpApplicabilityDisplay(complaint?.kp_applicability)}
            />
          </Row>
          <Row label="Case route">
            <StatePill
              meta={route}
              text={routingStatusDisplay(complaint?.routing_status)}
            />
          </Row>
        </div>

        {!routeDecided && !reviewRecorded ? (
          <p className="mt-4 text-xs leading-relaxed text-muted">
            Complete the submission review before finalizing the route.
          </p>
        ) : null}

        {complaint?.kp_applicability_reason ? (
          <div className="mt-4">
            <Row label="Reason recorded">{complaint.kp_applicability_reason}</Row>
          </div>
        ) : null}
        {complaint?.routing_reason ? (
          <div className="mt-4">
            <Row label="Basis for the route">{complaint.routing_reason}</Row>
          </div>
        ) : null}
        {complaint?.kp_applicability_legal_review ? (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-critical-soft px-4 py-3 text-xs font-semibold text-critical">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Held for legal review. No summons, hearing, or 15-day period may be recorded.
          </p>
        ) : null}

        {!mayDecide ? (
          <p className="mt-4 text-xs text-muted">
            Only the Barangay Captain or OIC can decide the case route.
          </p>
        ) : null}
      </Section>

      {/* ── Incident details (reported incidents only) ──────────── */}
      {incidentLike ? (
        <Section
          title="Incident Documentation"
          icon={Camera}
          action={
            mayDecide ? (
              <SectionAction onClick={() => open("incident")}>
                {incidentDetails ? "Edit Details" : "Record Details"}
              </SectionAction>
            ) : null
          }
        >
          {!incidentDetails ? (
            <>
              <p className="text-sm text-muted">
                No incident details have been recorded for this complaint. For a reported incident
                there is no one to summon, so the barangay records what is known instead.
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                What is captured here (property, identifiers, witnesses, CCTV, evidence, safety
                concerns, any external report already filed) is exactly what a possible blotter
                record and any police referral can honestly draw on — the barangay does not invent
                anything.
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {incidentRows(incidentDetails).map(([label, value]) => (
                  <Row key={label} label={label}>
                    {value}
                  </Row>
                ))}
              </div>
              {incidentDetails.safety_concern ? (
                <p className="mt-4 flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold text-warning">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  The complainant raised a safety concern: {incidentDetails.safety_notes || "see notes"}.
                </p>
              ) : null}
              {incidentDetails.already_reported_externally ? (
                <p className="mt-3 text-xs text-muted">
                  Already reported externally
                  {incidentDetails.externally_reported_where
                    ? ` to ${incidentDetails.externally_reported_where}`
                    : ""}
                  {incidentDetails.external_reference
                    ? ` (${incidentDetails.external_reference})`
                    : ""}
                  {incidentDetails.external_reference ? "" : " — no reference given."}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-muted">
                {incidentDetails.recorded_by_name
                  ? `Recorded by ${incidentDetails.recorded_by_name}`
                  : "Recorded by an official"}
                {incidentDetails.updated_at
                  ? ` · ${formatDateTime(incidentDetails.updated_at)}`
                  : ""}
              </p>
            </>
          )}
        </Section>
      ) : null}

      {/* ── History ─────────────────────────────────────────────── */}
      <Section title="Routing History" icon={FileText}>
        {routingHistory.length === 0 ? (
          <p className="text-sm text-muted">No routing decisions recorded.</p>
        ) : (
          <ol className="space-y-3">
            {routingHistory.map((entry) => (
              <li key={entry.id} className="border-l-2 border-line pl-4">
                <p className="text-xs text-muted">
                  {formatDateTime(entry.created_at)}
                  {entry.acted_by_name ? ` · ${entry.acted_by_name}` : ""}
                  {entry.acted_by_role ? ` (${entry.acted_by_role})` : ""}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-mirage">
                  {describeChange(entry)}
                </p>
                {entry.reason ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-mirage">{entry.reason}</p>
                ) : null}
                {entry.remarks ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{entry.remarks}</p>
                ) : null}
                {entry.resident_message ? (
                  <p className="mt-1 rounded-lg bg-alt px-3 py-2 text-xs leading-relaxed text-muted">
                    Sent to the complainant: {entry.resident_message}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {mayDecide ? (
        <>
          <CompletenessModal
            key={`completeness-${isOpen("completeness")}`}
            open={isOpen("completeness")}
            onClose={() => close("completeness")}
            onSaved={onChanged}
            complaint={complaint}
            supabase={supabase}
          />
          <RespondentAssessmentModal
            key={`respondent-${isOpen("respondent")}`}
            open={isOpen("respondent")}
            onClose={() => close("respondent")}
            onSaved={onChanged}
            complaint={complaint}
            supabase={supabase}
          />
          <RoutingDecisionModal
            key={`route-${isOpen("route")}`}
            open={isOpen("route")}
            onClose={() => close("route")}
            onSaved={onChanged}
            complaint={complaint}
            supabase={supabase}
          />
          <IncidentDetailsModal
            key={`incident-${isOpen("incident")}`}
            open={isOpen("incident")}
            onClose={() => close("incident")}
            onSaved={onChanged}
            complaint={complaint}
            supabase={supabase}
            incident={incidentDetails}
          />
        </>
      ) : null}
    </div>
  );
}

/** A stand-in pill for the not-supported messages above. */
function neutralNature() {
  return {
    short: "Not recorded",
    tone: "neutral",
  };
}

/** Non-empty incident detail rows, in a stable order. */
function incidentRows(incident) {
  const pairs = [
    ["Property / item", incident.property_description],
    ["Estimated value", incident.incident_value],
    ["Proof of ownership", incident.proof_of_ownership],
    ["Plate number", incident.plate_number],
    ["Serial number", incident.serial_number],
    ["Engine / chassis number", incident.engine_chassis_number],
    ["Identifiable marks", incident.identifiable_marks],
    ["Last known location", incident.last_known_location],
    ["Last seen", incident.last_known_at ? formatDateTime(incident.last_known_at) : null],
    ["Witnesses", incident.witnesses],
    ["CCTV", incident.cctv_available ? incident.cctv_notes || "Footage may exist" : null],
    ["Evidence", incident.evidence_notes],
    ["Other details", incident.incident_details_other],
  ];
  return pairs.filter(([, value]) => value);
}

/** One line describing what a history row changed. */
function describeChange(entry) {
  const parts = [];

  if (
    entry.completeness_status_before &&
    entry.completeness_status_before !== entry.completeness_status_after
  ) {
    parts.push(
      `Completeness: ${completenessStatusMeta(entry.completeness_status_before).label} → ${completenessStatusMeta(entry.completeness_status_after).label}`
    );
  }

  if (
    entry.complaint_nature_before &&
    entry.complaint_nature_before !== entry.complaint_nature_after
  ) {
    const before = complaintNatureMeta(entry.complaint_nature_before);
    const after = complaintNatureMeta(entry.complaint_nature_after);
    parts.push(
      `Nature: ${before ? before.label : entry.complaint_nature_before} → ${after ? after.label : entry.complaint_nature_after}`
    );
  }

  if (
    entry.respondent_status_before &&
    entry.respondent_status_before !== entry.respondent_status_after
  ) {
    parts.push(
      `Respondent: ${respondentStatusDisplay(entry.respondent_status_before)} → ${respondentStatusDisplay(entry.respondent_status_after)}`
    );
  }

  if (
    entry.kp_applicability_before &&
    entry.kp_applicability_before !== entry.kp_applicability_after
  ) {
    parts.push(
      `KP: ${kpApplicabilityMeta(entry.kp_applicability_before).label} → ${kpApplicabilityMeta(entry.kp_applicability_after).label}`
    );
  }

  if (
    entry.routing_status_before &&
    entry.routing_status_before !== entry.routing_status_after
  ) {
    parts.push(
      `Route: ${routingStatusMeta(entry.routing_status_before).label} → ${routingStatusMeta(entry.routing_status_after).label}`
    );
  }

  if (parts.length === 0) return "Routing record updated.";

  // The gate is not a column in the history row, so a change that did
  // not move any of the assessed values is described by its reason
  // instead of being shown as "no change".
  return parts.join(" · ");
}