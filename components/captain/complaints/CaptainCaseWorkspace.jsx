"use client";

/**
 * Captain Portal -> Complaints: the continuous case workspace.
 *
 * SECTIONS 11, 13, 14 AND 30 OF THE REQUEST.
 *
 * WHY THIS FILE EXISTS
 *   The Captain case file was a row of ten equal tabs. That is a filing
 *   system, not a workflow: to answer "what is this complaint and what do I
 *   do next" an official had to open tabs and remember which one held the
 *   answer. This workspace is one scrolling page for one complaint:
 *
 *     header        who, what, where it is, and the case situation
 *     next action   ONE highlighted action, with the button that does it
 *     stepper       where the complaint is, and what is still outstanding
 *     sections      the parts of the case that apply to it, collapsed
 *     timeline      the full history, primary
 *     audit         the same trail as an official log, secondary
 *
 *   Sections that do not apply to the case are not rendered at all, so an
 *   unidentified-suspect report never shows a summons tracker it cannot
 *   use, and a two-party dispute always shows one it needs.
 *
 * SCOPE
 *   This component is rendered for the Captain only. The OIC and Secretary
 *   case files keep the existing tabbed view, unchanged, in CaseViewer.
 *
 * NO INVENTED RULES
 *   Every state shown here is derived from a persisted column or from the
 *   absence of a row, by lib/captainComplaintWorkflow.js and
 *   lib/captainComplaintRouting.js. This file decides layout and which
 *   section to show; it never decides that something is done, and it never
 *   computes a legal deadline. Actions are performed by the existing,
 *   already-permissioned modals and RPC-backed components, so no new write
 *   path is introduced.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  ChevronDown,
  Printer,
  ShieldAlert,
  StickyNote,
} from "lucide-react";
import { useOfficialPortal, useOfficialRoutes } from "@/components/official/OfficialPortalProvider";
import {
  closeCaseOnSettlement,
  currentAndNextAction,
  hasIdentifiedRespondent,
  isTwoPartyDispute,
  isUnidentifiedIncident,
  isPangkatConstituted,
  latestMeetingOutcomeFor,
  mediationClockFor,
  mediationFailedFor,
  mediationSectionStatusFor,
  nextOfficialAction,
  reopenCaseAfterSettlement,
  respondentDisplay,
  settlementCloseDecisionFor,
  situationOf,
} from "@/lib/captainComplaintWorkflow";
import { routingCta, routingGate, routingStatusMeta } from "@/lib/captainComplaintRouting";
import {
  STAGE_KEYS,
  formatDateTime,
  isCritical,
  resolveComplainantName,
  resolveCaseHeaderParties,
  resolveConfirmedCategory,
  resolveReference,
  resolveRespondent,
  stageOf,
} from "./complaintMeta";
import {
  PrimaryAction,
  SecondaryAction,
  WorkflowChip,
  WorkflowNote,
  WorkflowPanel,
} from "./captainWorkflowUi";
import CaptainCaseStepper from "./CaptainCaseStepper";
import CaptainWorkspaceSection from "./CaptainWorkspaceSection";
import CaseTimeline from "./CaseTimeline";
import OverviewTab from "./OverviewTab";
import CategorizationTab from "./CategorizationTab";
import RoutingTab from "./RoutingTab";
import RelatedRecordsTab from "./RelatedRecordsTab";
import LuponTab from "./LuponTab";
import ResolutionOutcomesTab from "./ResolutionOutcomesTab";
import DocumentsTab from "./DocumentsTab";
import PnpReferralTab from "./PnpReferralTab";
import AuditTab from "./AuditTab";
import DeadlineTracker from "./DeadlineTracker";
import SummonsTracker from "./SummonsTracker";
import HearingAttendanceTracker from "./HearingAttendanceTracker";
import WorkflowActions from "./WorkflowActions";
import InternalNoteModal from "./InternalNoteModal";

/** Routes that mean the case may need help from outside the barangay. */
const EXTERNAL_ROUTES = [
  "police_reporting_assistance",
  "external_agency_assistance",
  "incident_documentation",
];

/** Display-only tone for the case-header urgency badge. */
function urgencyTone(value) {
  const v = String(value || "").toLowerCase();
  if (v === "critical") return "critical";
  if (v === "high") return "warning";
  return "neutral";
}

export default function CaptainCaseWorkspace({
  supabase,
  user,
  complaint,
  bundle,
  onChanged,
  onPrint,
  printing,
}) {
  const router = useRouter();
  const { role } = useOfficialPortal();
  const routes = useOfficialRoutes();

  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowIntent, setWorkflowIntent] = useState(null);
  const [workflowTitle, setWorkflowTitle] = useState(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [routingFocus, setRoutingFocus] = useState(null);
  const [relatedFocus, setRelatedFocus] = useState(null);
  const [focus, setFocus] = useState(null);
  // Bookkeeping for the settlement transition effect below: which
  // complaint object the answers were last computed against, which
  // decision was already performed for it, and whether the last attempt
  // failed. See the effect for why each field exists.
  const settlementTransitionRef = useRef({
    complaint: null,
    handled: null,
    failed: false,
  });

  // The shared case bundle reaches `summons` only as a relation nested under
  // each hearing, which misses a summons not yet linked to one. Reading the
  // table directly keeps the summons tracker complete. Tolerant: if the
  // table is unavailable the tracker reports "not issued" rather than
  // breaking the case file.
  const [summons, setSummons] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!complaint?.id) return undefined;
    (async () => {
      const { data, error } = await supabase
        .from("summons")
        .select("id, complaint_id, hearing_id, storage_path, issued_at, created_at")
        .eq("complaint_id", complaint.id);
      if (cancelled) return;
      setSummons(error ? [] : data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [complaint?.id, supabase]);

  // Whether PNP referral is even relevant on this case. A resident's own
  // referral request is the strongest signal, so it is checked first; the
  // Captain still confirms anything that follows. Tolerant for the same
  // reason as the summons read above.
  const [referralRequests, setReferralRequests] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!complaint?.id) return undefined;
    (async () => {
      const { data, error } = await supabase
        .from("pnp_referral_requests")
        .select("id, status, has_immediate_safety_concern")
        .eq("complaint_id", complaint.id);
      if (cancelled) return;
      setReferralRequests(error ? [] : data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [complaint?.id, supabase]);

  // The one reading of the case bundle this workspace is built on.
  //
  // Memoised on the bundle (and the summons read, which is fetched on
  // its own): it is a dependency of the settlement transition effect
  // below, and a fresh identity on every render would have that effect
  // run on every render. The per-collection fallbacks live here too, so
  // there is exactly one place a missing table becomes an empty list —
  // every collection is optional in the bundle, and without, say, the
  // Meeting Records a hearing can only be reported as scheduled rather
  // than as a meeting anyone recorded.
  const context = useMemo(
    () => ({
      summons,
      serviceRecords: bundle?.serviceRecords || [],
      documents: bundle?.documents || [],
      attendances: bundle?.attendances || [],
      hearings: bundle?.hearings || [],
      // Meeting Records. Optional like the rest: a case filed before the
      // meeting-record migration has none.
      minutes: bundle?.minutes || bundle?.hearingMinutes || [],
      lifecycleEvents: bundle?.lifecycleEvents || bundle?.documentLifecycleEvents || [],
      blotterRecord: bundle?.blotterRecord || null,
      // The two statutory clocks and the Pangkat itself. Without these
      // the case file would never report that the fifteen days of Captain
      // mediation have run out and the second stage is now required.
      kpPhases: bundle?.kpPhases || [],
      kpTracker: bundle?.kpTracker || null,
      pangkatTracker: bundle?.pangkatTracker || null,
      luponPanels: bundle?.luponPanels || [],
      // How the case actually ended, if it has. Without it the ladder cannot
      // offer the document an outcome owes: a settlement has to be able to
      // produce the Amicable Settlement, a failed conciliation the Certificate
      // to File Action.
      caseResolution: bundle?.caseResolution || null,
    }),
    [bundle, summons]
  );
  // The collections the rest of this file renders from. Reading them off
  // the memo keeps their identity tied to the bundle — a re-render with
  // unchanged rows cannot make a section look like new data.
  const {
    serviceRecords,
    documents,
    attendances,
    hearings,
    minutes,
    lifecycleEvents,
  } = context;

  const unidentified = isUnidentifiedIncident(complaint);
  const twoParty = isTwoPartyDispute(complaint);
  const situation = situationOf(complaint);
  const respondent = respondentDisplay(complaint);
  const stage = stageOf(complaint, bundle?.kpTracker);

  const actions = currentAndNextAction(complaint, context);
  // Exactly one next action, derived from the complaint's own recorded state.
  // The generic "Official Action" picker that used to sit beside it is gone:
  // there is one way in now, and it is the step the case is waiting for.
  const primary = nextOfficialAction(complaint, context);
  const mediationStatus = mediationSectionStatusFor({ hearings, minutes, documents });
  const gate = routingGate(complaint);
  const cta = routingCta(complaint, {
    hasBlotter: Boolean(bundle?.blotterRecord),
    hasIncidentDetails: Boolean(bundle?.incidentDetails),
    hasAssistance: (bundle?.assistanceRecords || []).length > 0,
    isReceived: Boolean(complaint.official_received_at),
  });

  const confirmedCategory = resolveConfirmedCategory(complaint);
  // Official-only: an AI suggestion must not mark the section confirmed.
  const confirmedUrgency = complaint.confirmed_urgency || null;
  const classified = Boolean(confirmedCategory && confirmedUrgency);
  const routed = Boolean(complaint.routing_status) && complaint.routing_status !== "pending_assessment";
  const panelConstituted = isPangkatConstituted(bundle?.luponPanels || []);
  const mediationClock = mediationClockFor(complaint, context);
  // A recorded "No settlement" ends mediation on the spot — the Pangkat
  // selection begins then, not only once the fifteen days run out.
  const mediationFailed = mediationFailedFor(complaint, context);
  const caseResolution = bundle?.caseResolution || null;
  const pendingReferralRequest = referralRequests.some(
    (r) => r.status === "pending_review" || r.status === "more_information_required"
  );
  const pnpRelevant =
    referralRequests.length > 0 ||
    isCritical(complaint) ||
    EXTERNAL_ROUTES.includes(complaint.routing_status);

  /**
   * Stamp "Case Closed" — and take it back off when the record no
   * longer supports it.
   *
   * THE RULE LIVES IN THE LIB, NOT HERE
   *   settlementCloseDecisionFor() reads the same persisted rows as
   *   everything else on this page — the latest conducted Meeting
   *   Record, the Amicable Settlement on file, any repudiation, and the
   *   complaint's own status and stage — and answers "close", "reopen"
   *   or "nothing". This effect only performs the transition it asks
   *   for, so every path that settles a case lands in the same place:
   *
   *     * right after a Meeting Record saves (generation ends in
   *       onChanged()), after the manual "Generate Amicable
   *       Settlement" button, and after printing from Resolution &
   *       Outcomes — the refreshed bundle carries the document and the
   *       stamp follows;
   *     * for a case whose settlement was already on file before this
   *       rule existed, the moment the file is opened — no re-saving,
   *       no version bump, nothing written but the one transition;
   *     * back OUT of "Closed" when the officer corrects the outcome
   *       away from "Settled" or a settlement is repudiated — a Closed
   *       case is offered no action at all, so a case the rule closed
   *       while the record still supported it must be a case the rule
   *       reopens when it stops, or the file would be stranded.
   *
   * WHY THE REF
   *   The bundle can be one refresh behind the write it just triggered,
   *   so the same decision would otherwise be performed twice against
   *   the stale props: the ref records which decision was already
   *   performed and skips it while the props are still the same ones it
   *   was computed from. It resets whenever a refreshed complaint row
   *   arrives — that is how props catching up ends the cycle, and how
   *   the *next* decision (a reopen after a close, a close after a
   *   reopen) is always allowed through. A failed attempt is remembered
   *   the same way so a broken write cannot toast an error on every
   *   render; it retries on the next real refresh instead.
   */
  useEffect(() => {
    const st = settlementTransitionRef.current;
    if (st.complaint !== complaint) {
      st.complaint = complaint;
      st.handled = null;
      st.failed = false;
    }

    const decision = settlementCloseDecisionFor(complaint, context);
    if (!decision) {
      st.handled = null;
      return;
    }
    if (st.handled === decision || st.failed) return;
    st.handled = decision;

    (async () => {
      try {
        const outcome = latestMeetingOutcomeFor(context);
        const result =
          decision === "close"
            ? await closeCaseOnSettlement(supabase, { complaint, user })
            : await reopenCaseAfterSettlement(supabase, {
                complaint,
                user,
                reason: caseResolution?.repudiated
                  ? "settlement_repudiated"
                  : outcome && outcome !== "Settled"
                    ? "outcome_no_longer_settled"
                    : "settlement_not_on_file",
              });
        if (!result?.success) throw new Error(result?.error || "transition-failed");
        if (result.changed !== false) {
          toast.success(
            decision === "close"
              ? "Case closed — the Amicable Settlement is on file."
              : "Case reopened — the settlement no longer applies.",
          );
        }
        onChanged?.();
      } catch {
        st.handled = null;
        st.failed = true;
        toast.error(
          decision === "close"
            ? "The case could not be stamped Closed automatically."
            : "The case could not be reopened automatically.",
        );
      }
    })();
  }, [complaint, context, caseResolution, supabase, user, onChanged]);

  const focusSection = useCallback((sectionId) => {
    setFocus({ id: sectionId, nonce: Date.now() });
  }, []);

  /**
   * Opens the compact action modal on one specific action, or on a named
   * group of them ("settled,completed").
   *
   * `title` is what the case file asked for. It only reaches the modal when
   * more than one action was requested — a single requested action already
   * names itself — and it exists so that "Record Outcome" does not arrive as
   * "Continue Case Processing".
   */
  const openWorkflowAction = useCallback((actionKey, title = null) => {
    setWorkflowIntent(actionKey);
    setWorkflowTitle(title);
    setWorkflowOpen(true);
  }, []);

  /**
   * SECTION 13 — one highlighted action, and one way in.
   *
   * The button follows the case and opens the section that actually holds the
   * control for the step it names: a routing step opens the routing section
   * on the control that is missing, a classification step opens Review &
   * Classification, a hearing step opens the mediation or documents section,
   * and a workflow step opens the compact action modal that already carries
   * receiving and recording an outcome.
   */
  const handleNextAction = useCallback(() => {
    if (!primary) return;
    if (primary.kind === "workflow") {
      openWorkflowAction(primary.workflowAction || null, primary.label);
      return;
    }
    if (primary.kind === "routing") {
      if (primary.section === "classification") {
        focusSection("classification");
        return;
      }
      const step = primary.focus || (cta.kind === "none" ? "routing" : cta.kind);
      // Blotter and referral live in their own section now, so those
      // steps open it instead of the routing tab.
      if (step === "blotter" || step === "assistance") {
        setRelatedFocus(step);
        focusSection("related");
        return;
      }
      setRoutingFocus(step);
      focusSection("routing");
      return;
    }
    if (primary.kind === "hearings") {
      // Which section the step actually lives in: Case Documents holds the
      // notice, Resolution & Outcomes holds the settlement and the
      // certificate, everything else is scheduled under Summons/Mediation.
      focusSection(
        ["documents", "resolution", "mediation"].includes(primary.section)
          ? primary.section
          : "mediation",
      );
    }
  }, [primary, cta.kind, focusSection, openWorkflowAction]);

  /**
   * The secondary action, under "More actions".
   *
   * Rejection is exactly where it always was — same record, same required
   * reason, same audit entry, same resident notification — it simply no
   * longer stands beside the primary button as though it were the next step.
   * Rejecting is a decision about the case, not a stage of processing it, so
   * it is one level away and never the thing the panel points at.
   */
  const handleSecondaryAction = useCallback(
    (action) => {
      if (!action) return;
      openWorkflowAction(action.workflowAction || null, action.label);
    },
    [openWorkflowAction]
  );

  const officialCategory = confirmedCategory || "Awaiting confirmation";
  const aiCategory = complaint.predicted_category || complaint.predicted_case_type || "Not classified";
  const urgencyLabel = confirmedUrgency || complaint.predicted_urgency || "Not classified";
  const statusLabel = complaint.current_status || "—";

  const resident = complaint?.profiles?.resident_profiles?.[0];
  const residentAddress =
    [resident?.purok, resident?.address].filter((v) => v && String(v).trim()).join(", ") ||
    null;

  /**
   * A case first reported against an unknown suspect and later traced to a
   * named person walks the two-party pathway on the same record, but the
   * stored nature still reads "reported_incident". The workflow follows the
   * identified respondent; this note asks the Captain to bring the stored
   * nature into line so the record does not disagree with the pathway.
   */
  const natureNeedsUpdate =
    hasIdentifiedRespondent(complaint) && complaint.complaint_nature === "reported_incident";

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 py-10">
      {/* ── Case header ───────────────────────────────────────── */}
      <header className="rounded-2xl border border-line bg-white p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={() => router.push(routes.complaints)}
              className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-white text-mirage transition-colors hover:bg-alt"
              aria-label="Back to complaints"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                {resolveReference(complaint)} · Filed {formatDateTime(complaint.submitted_at)}
              </p>
              <h1 className="mt-1 font-heading text-xl font-semibold leading-snug text-navy sm:text-2xl">
                {complaint.title}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {resolveCaseHeaderParties(complaint)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SecondaryAction onClick={onPrint} disabled={printing}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print Summary
            </SecondaryAction>
            <SecondaryAction onClick={() => setNoteOpen(true)}>
              <StickyNote className="h-4 w-4" aria-hidden="true" />
              Internal Note
            </SecondaryAction>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-6">
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Case Type</dt>
            <dd className="mt-1">
              <WorkflowChip tone={situation.tone}>{situation.label}</WorkflowChip>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Respondent</dt>
            <dd className="mt-1 text-sm font-semibold text-mirage">{respondent.label}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">AI Category</dt>
            <dd className="mt-1 truncate text-sm font-semibold text-mirage">{aiCategory}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Official Category
            </dt>
            <dd className="mt-1">
              <WorkflowChip tone={confirmedCategory ? "ok" : "warning"}>
                {officialCategory}
              </WorkflowChip>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Urgency</dt>
            <dd className="mt-1">
              <WorkflowChip tone={urgencyTone(confirmedUrgency || complaint.predicted_urgency)}>
                {urgencyLabel}
              </WorkflowChip>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Status</dt>
            <dd className="mt-1">
              <WorkflowChip tone="neutral">{statusLabel}</WorkflowChip>
            </dd>
          </div>
        </dl>
      </header>

      {/* ── One highlighted next action ───────────────────────── */}
      <section className="overflow-visible rounded-2xl border border-[#2563b0]/25 bg-white shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4 bg-info-soft px-5 py-4 sm:px-6">
          <div className="min-w-0 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-action">
              Current action
            </p>
            <p className="mt-1 font-heading text-base font-semibold leading-snug text-navy">
              {actions.current}
            </p>
            {/*
              The sentence under the headline must describe the button, not
              the case in general. `actions.next` is a separate derivation
              and can name a different step — it was telling officers to
              "record each party's attendance" on a case whose only offered
              action was Generate Notice of Hearing. `primary.hint` comes
              from the same derivation as the button, so the panel can never
              offer one step while describing another.
            */}
            <p className="mt-2 text-sm leading-relaxed text-mirage">
              {primary?.hint || actions.next}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {primary ? (
              <PrimaryAction onClick={handleNextAction}>{primary.label}</PrimaryAction>
            ) : null}

            {primary?.secondary?.length ? (
              <details className="relative">
                <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-mirage transition-colors hover:bg-alt [&::-webkit-details-marker]:hidden">
                  More actions
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-[19rem] rounded-2xl border border-line bg-white p-2 shadow-soft">
                  {primary.secondary.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        handleSecondaryAction(action);
                      }}
                      className="block w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-alt"
                    >
                      <span className="block text-sm font-semibold text-navy">{action.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {action.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>

        {gate && !gate.open ? (
          <div className="space-y-2 px-5 py-4 sm:px-6">
            <WorkflowNote tone="warning">
              <span className="font-semibold">Action required.</span> {gate.reason} Complete Case
              Routing to unlock the next steps.
            </WorkflowNote>
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-warning">
                View details
              </summary>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {gate.headline}
                {gate.detail ? ` — ${gate.detail}` : ""}
              </p>
            </details>
          </div>
        ) : null}

        {natureNeedsUpdate ? (
          <div className="px-5 py-4 sm:px-6">
            <WorkflowNote tone="info">
              The respondent has since been named, but the stored complaint nature still reads
              &ldquo;reported incident&rdquo;. Update it under Case Routing so the record matches the
              two-party pathway now being followed.
            </WorkflowNote>
          </div>
        ) : null}
      </section>

      {/* ── Progress stepper ──────────────────────────────────── */}
      <CaptainCaseStepper complaint={complaint} context={context} />

      {/* ── Complaint information ─────────────────────────────── */}
      <CaptainWorkspaceSection
        id="information"
        title="Complaint Information"
        defaultOpen={false}
      >
        <div className="mb-5 grid grid-cols-1 gap-4 rounded-xl border border-line bg-canvas px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Complainant
            </p>
            <p className="mt-1 text-sm font-semibold text-mirage">
              {resolveComplainantName(complaint)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Contact Number
            </p>
            <p className="mt-1 text-sm font-semibold text-mirage">
              {resident?.contact_number ||
                complaint?.profiles?.contact_number ||
                "Not recorded"}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Email</p>
            <p className="mt-1 truncate text-sm font-semibold text-mirage">
              {complaint?.profiles?.email || "Not recorded"}
            </p>
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Resident Address
            </p>
            <p className="mt-1 text-sm font-semibold text-mirage">{residentAddress || "Not recorded"}</p>
          </div>
        </div>

        <OverviewTab
          supabase={supabase}
          complaint={complaint}
          evidence={bundle?.evidence || []}
          kpTracker={bundle?.kpTracker}
          blotterRecord={bundle?.blotterRecord}
        />
      </CaptainWorkspaceSection>

      {/* ── AI classification, kept separate from the official decision ── */}
      <CaptainWorkspaceSection
        id="classification"
        title="Review & Classification"
        badge={classified ? confirmedCategory : "Awaiting verification"}
        badgeTone={classified ? "ok" : "warning"}
        defaultOpen={!classified}
        focus={focus?.id === "classification" ? focus : null}
      >
        <CategorizationTab
          complaint={complaint}
          reviews={bundle?.reviews || []}
          onChanged={onChanged}
        />
      </CaptainWorkspaceSection>

      {/* ── Routing: two-party decision, or one-party incident record ── */}
      <CaptainWorkspaceSection
        id="routing"
        title={unidentified ? "Incident Routing & Progress" : "Case Routing & Parties"}
        badge={routed ? routingStatusMeta(complaint.routing_status).short : "Routing Pending"}
        badgeTone={routed ? "ok" : "warning"}
        defaultOpen={
          !routed ||
          !hasIdentifiedRespondent(complaint) ||
          complaint.completeness_status === "pending_review" ||
          !complaint.kp_applicability ||
          complaint.kp_applicability === "pending"
        }
        focus={focus?.id === "routing" ? focus : null}
      >
        <RoutingTab
          supabase={supabase}
          role={role}
          complaint={complaint}
          routingHistory={bundle?.routingHistory || []}
          routingUnavailable={bundle?.routingUnavailable}
          incidentDetails={bundle?.incidentDetails}
          informationResponses={bundle?.informationResponses || []}
          evidence={bundle?.evidence || []}
          focus={routingFocus}
          onFocusCleared={() => setRoutingFocus(null)}
          onChanged={onChanged}
        />
      </CaptainWorkspaceSection>

      {/* ── Related records: blotter entry and outside referral ─── */}
      <CaptainWorkspaceSection
        id="related"
        title="Related Records"
        badge={
          bundle?.blotterRecord
            ? `Blotter ${bundle.blotterRecord.blotter_number}`
            : (bundle?.assistanceRecords || []).length > 0
              ? "Referral recorded"
              : null
        }
        badgeTone="ok"
        defaultOpen={false}
        focus={focus?.id === "related" ? focus : null}
      >
        <RelatedRecordsTab
          supabase={supabase}
          role={role}
          complaint={complaint}
          blotterRecord={bundle?.blotterRecord}
          assistanceRecords={bundle?.assistanceRecords || []}
          routingUnavailable={bundle?.routingUnavailable}
          focus={relatedFocus}
          onFocusCleared={() => setRelatedFocus(null)}
          onChanged={onChanged}
        />
      </CaptainWorkspaceSection>

      {/* ── Mediation: two-party cases only ───────────────────── */}
      {twoParty ? (
        <CaptainWorkspaceSection
          id="mediation"
          title="Notice, Mediation & Attendance"
          badge={mediationStatus.label}
          badgeTone={mediationStatus.tone}
          defaultOpen={mediationStatus.key !== "awaiting_schedule" || hearings.length > 0}
          focus={focus?.id === "mediation" ? focus : null}
        >
          <div className="space-y-5">
            {/* Order: schedule, then the documents it produces, then the
                mediation period, then what happened at each hearing. */}
            <SummonsTracker
              complaint={complaint}
              supabase={supabase}
              user={user}
              summons={summons}
              serviceRecords={serviceRecords}
              documents={documents}
              hearings={hearings}
              minutes={minutes}
              lifecycleEvents={lifecycleEvents}
              activityLogs={bundle?.activityLogs || []}
              onChanged={onChanged}
            />

            <WorkflowPanel
              title="15-Day Mediation Period"
              description="Counted from the first recorded mediation meeting, not from the date the complaint was filed or the summons was scheduled."
            >
              <DeadlineTracker
                kpTracker={bundle?.kpTracker}
                kpPhases={bundle?.kpPhases || []}
                hearings={hearings}
                minutes={minutes}
              />
            </WorkflowPanel>

            <HearingAttendanceTracker
              supabase={supabase}
              user={user}
              complaint={complaint}
              hearings={hearings}
              attendances={attendances}
              minutes={minutes}
              documents={documents}
              respondent={complaint}
              onChanged={onChanged}
            />
          </div>
        </CaptainWorkspaceSection>
      ) : null}

      {/* ── Pangkat: the statutory second stage ───────────────── */}
      {twoParty ? (
        <CaptainWorkspaceSection
          id="pangkat"
          title="Pangkat Tagapagkasundo"
          description="The second stage. Captain mediation that does not settle the case within 15 days moves here: three members from the Lupon, one chosen by each party and the third by those two, with 15 days to hear the case from the day they convene."
          badge={
            panelConstituted
              ? `${(bundle?.luponPanels || []).length} member(s)`
              : mediationClock.lapsed
                ? "Required now"
                : "Not constituted"
          }
          badgeTone={panelConstituted ? "ok" : mediationClock.lapsed ? "warning" : "neutral"}
          defaultOpen={
            mediationClock.lapsed || mediationFailed || stage === STAGE_KEYS.CONCILIATION
          }
          focus={focus?.id === "pangkat" ? focus : null}
        >
          <LuponTab
            supabase={supabase}
            user={user}
            complaint={complaint}
            luponPanels={bundle?.luponPanels || []}
            pangkatTracker={bundle?.pangkatTracker || null}
            stage={stage}
            onChanged={onChanged}
            onStartPangkat={() => {
              openWorkflowAction("startPangkat");
            }}
          />
        </CaptainWorkspaceSection>
      ) : null}

      {/* ── Resolution & Outcomes: how the case actually ended ── */}
      {twoParty ? (
        <CaptainWorkspaceSection
          id="resolution"
          title="Resolution & Outcomes"
          description="An amicable settlement and the date it becomes binding, any repudiation of it within ten days, and any Certificate to File Action released when conciliation failed."
          badge={caseResolution ? "Recorded" : "None yet"}
          badgeTone={caseResolution ? "ok" : "neutral"}
          defaultOpen={Boolean(caseResolution) || stage === STAGE_KEYS.CLOSED}
          focus={focus?.id === "resolution" ? focus : null}
        >
          <ResolutionOutcomesTab
            supabase={supabase}
            user={user}
            complaint={complaint}
            luponPanels={bundle?.luponPanels || []}
            resolution={caseResolution}
            documents={documents}
            hearings={hearings}
            onChanged={onChanged}
          />
        </CaptainWorkspaceSection>
      ) : null}

      {/* ── PNP referral: only when it is relevant ────────────── */}
      {pnpRelevant ? (
        <CaptainWorkspaceSection
          id="referral"
          title="PNP Referral"
          description={
            pendingReferralRequest
              ? "The resident has requested referral to the Philippine National Police. The referral is not made automatically; the Captain confirms it."
              : "Referral to the Philippine National Police is prepared and confirmed by the Captain. Nothing is sent automatically."
          }
          badge={pendingReferralRequest ? "Resident request pending" : "Captain confirmed"}
          badgeTone={pendingReferralRequest ? "warning" : "neutral"}
          defaultOpen={pendingReferralRequest}
        >
          <PnpReferralTab
            supabase={supabase}
            user={user}
            complaint={complaint}
            evidence={bundle?.evidence || []}
          />
        </CaptainWorkspaceSection>
      ) : null}

      {/* ── Documents ─────────────────────────────────────────── */}
      <CaptainWorkspaceSection
        id="documents"
        title="Case Documents"
        badge={`${documents.length}`}
        badgeTone={documents.length ? "ok" : "neutral"}
      >
        <DocumentsTab
          supabase={supabase}
          user={user}
          complaint={complaint}
          documents={documents}
          hearings={hearings}
          onChanged={onChanged}
        />
      </CaptainWorkspaceSection>

      {/* ── Timeline: the primary record of what happened ─────── */}
      <CaptainWorkspaceSection
        id="timeline"
        title="Case Timeline"
        defaultOpen={false}
      >
        <CaseTimeline
          caseStatuses={bundle?.caseStatuses || []}
          reviews={bundle?.reviews || []}
          kpPhases={bundle?.kpPhases || []}
          hearings={hearings}
          kpTracker={bundle?.kpTracker}
        />
      </CaptainWorkspaceSection>

      {/* ── Audit: the same trail as an official log ──────────── */}
      <CaptainWorkspaceSection
        id="audit"
        title="Audit & Notes"
        badge={`${(bundle?.activityLogs || []).length}`}
        badgeTone="neutral"
      >
        <AuditTab
          complaint={complaint}
          activityLogs={bundle?.activityLogs || []}
          internalNotes={bundle?.internalNotes || []}
          supabase={supabase}
        />
      </CaptainWorkspaceSection>

      <WorkflowActions
        key={
          workflowOpen ? `${workflowIntent || "open"}@${workflowTitle || ""}` : "closed"
        }
        open={workflowOpen}
        onClose={() => {
          setWorkflowOpen(false);
          setWorkflowIntent(null);
          setWorkflowTitle(null);
        }}
        supabase={supabase}
        user={user}
        complaint={complaint}
        bundle={bundle}
        onChanged={() => {
          onChanged();
          setWorkflowIntent(null);
          setWorkflowTitle(null);
        }}
        defaultAction={workflowIntent}
        intentTitle={workflowTitle}
      />

      <InternalNoteModal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onSaved={onChanged}
        complaint={complaint}
        supabase={supabase}
        user={user}
      />
    </div>
  );
}
