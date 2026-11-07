"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, FileText, Printer, StickyNote } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useOfficialPortal, useOfficialRoutes } from "@/components/official/OfficialPortalProvider";
import { canAccessPage } from "@/lib/permissions";
import { useAuth } from "@/context/AuthContext";
import { fetchComplaintBundle } from "@/lib/complaintQueries";
import { generateComplaintPdf } from "@/lib/complaintPdf";
import { routingGate, routingCta } from "@/lib/captainComplaintRouting";
import { CASE_TABS } from "./caseTabs";
import {
  resolveComplainantName,
  resolveCaseHeaderParties,
  resolveRespondent,
  resolveReference,
  resolveConfirmedCategory,
  resolveConfirmedUrgency,
  stageOf,
  formatDateTime,
} from "./complaintMeta";
import CaseSummary from "./CaseSummary";
import OverviewTab from "./OverviewTab";
import RoutingTab from "./RoutingTab";
import RelatedRecordsTab from "./RelatedRecordsTab";
import CategorizationTab from "./CategorizationTab";
import TrackingTab from "./TrackingTab";
import HearingsTab from "./HearingsTab";
import LuponTab from "./LuponTab";
import DocumentsTab from "./DocumentsTab";
import PnpReferralTab from "./PnpReferralTab";
import AuditTab from "./AuditTab";
import WorkflowActions from "./WorkflowActions";
import InternalNoteModal from "./InternalNoteModal";
import CaptainCaseWorkspace from "./CaptainCaseWorkspace";
import { demoComplaintsEnabledFor, getDemoComplaint } from "@/lib/demoComplaints";

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 animate-pulse rounded bg-alt" />
        <div className="h-7 w-52 animate-pulse rounded bg-alt" />
      </div>
      <div className="h-24 animate-pulse rounded-2xl bg-alt/70" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-alt/70" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-alt/60" />
    </div>
  );
}

function DemoCaseViewer({ complaint }) {
  const router = useRouter();
  const routes = useOfficialRoutes();
  return (
    <div className="mx-auto max-w-[1200px] space-y-6 py-10">
      <button type="button" onClick={() => router.push(routes.complaints)}
        className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-mirage">
        <ArrowLeft className="h-4 w-4" /> Back to Complaints
      </button>
      <header className="rounded-2xl border border-line bg-white p-6 shadow-soft">
        <p className="text-xs font-semibold text-muted">Sample Case · Demo only · Not an official complaint</p>
        <p className="mt-3 text-xs font-semibold text-secondary">{complaint.reference_number} · Filed {formatDateTime(complaint.submitted_at)}</p>
        <h1 className="mt-1 font-heading text-2xl font-semibold text-navy">{complaint.title}</h1>
        <p className="mt-1 text-sm text-muted">{complaint.complainantName} vs. {complaint.respondent_name}</p>
        <p className="mt-3 text-sm font-semibold text-secondary">{complaint.current_status}</p>
      </header>
      <section className="rounded-2xl border border-line bg-white p-6 shadow-soft">
        <h2 className="text-sm font-semibold text-navy">Complaint Information</h2>
        <p className="mt-3 text-sm leading-relaxed text-mirage">{complaint.description}</p>
      </section>
      <section className="rounded-2xl border border-line bg-white p-6 shadow-soft">
        <h2 className="text-sm font-semibold text-navy">Sample Case Timeline</h2>
        <ol className="mt-4 space-y-4">
          {complaint.timeline.map((step) => (
            <li key={step.id} className="border-l-2 border-secondary pl-4 text-sm text-mirage">
              <span className="font-medium">{step.label}</span>
              <span className="block text-xs text-muted">{formatDateTime(step.at)}</span>
            </li>
          ))}
        </ol>
        {complaint.current_status === "CFA Issued" ? (
          <p className="mt-4 text-xs text-muted">CFA stage shown for illustration only. No certificate or legal document has been issued.</p>
        ) : null}
      </section>
      <p className="text-xs text-muted">Read-only example. Official actions and documents are unavailable for sample cases.</p>
    </div>
  );
}

export default function CaseViewer({ complaintId, initialTab }) {
  const { role } = useOfficialPortal();
  const { user } = useAuth();
  const demo = role === "captain" ? getDemoComplaint(complaintId) : null;
  if (demo) {
    return demoComplaintsEnabledFor(user) ? <DemoCaseViewer complaint={demo} /> : (
      <div className="mx-auto max-w-[1200px] py-10 text-sm text-muted">Case not found.</div>
    );
  }
  return <RealCaseViewer complaintId={complaintId} initialTab={initialTab} />;
}

function RealCaseViewer({ complaintId, initialTab }) {
  const router = useRouter();
  const { user } = useAuth();
  const { role } = useOfficialPortal();
  const routes = useOfficialRoutes();
  const [supabase] = useState(() => createClient());

  // CAPTAIN-ONLY ADDITION.
  // This component is shared by the captain, OIC and secretary portals.
  // The Captain gets a single continuous case workspace instead of the tab
  // list, rendered by <CaptainCaseWorkspace/> below. The OIC and Secretary
  // case files keep the existing tabbed view untouched, so visibleTabs is
  // left exactly as it was for them.
  const isCaptain = role === "captain";
  const caseTabs = CASE_TABS.filter(
    (t) => !t.permission || canAccessPage(role, t.permission)
  );
  const visibleTabs = caseTabs;

  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(() => {
    // "workflow" is no longer a tab: the Captain's workspace is the page.
    // It stays invalid here, so OIC and Secretary fall back to "overview"
    // exactly as before.
    const valid = CASE_TABS.some((t) => t.id === initialTab);
    return valid ? initialTab : "overview";
  });
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowIntent, setWorkflowIntent] = useState(null);
  const [pangkatAction, setPangkatAction] = useState(false);
  const [routingFocus, setRoutingFocus] = useState(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [printing, setPrinting] = useState(false);

  const refresh = useCallback(async () => {
    const data = await fetchComplaintBundle(supabase, complaintId);
    setBundle(data);
    // A freshly-saved record means the CTA has been acted on; clear the
    // focus so clicking the CTA again opens the matching step afresh.
    setRoutingFocus(null);
    if (data.complaint) {
      setError(null);
    } else {
      setError("This complaint could not be loaded.");
    }
  }, [complaintId, supabase, setRoutingFocus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchComplaintBundle(supabase, complaintId);
      if (cancelled) return;
      if (data.complaint) {
        setBundle(data);
        setError(null);
      } else {
        setError("This complaint could not be loaded or may have been removed.");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [complaintId, supabase]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      router.push(routes.complaints);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, routes.complaints]);

  const handlePrint = useCallback(() => {
    if (!bundle?.complaint || printing) return;
    setPrinting(true);
    try {
      const c = bundle.complaint;
      const pdfComplaint = {
        caseNo: resolveReference(c),
        submittedOn: c.submitted_at,
        title: c.title,
        status: c.current_status || "Pending Review",
        confirmedCategory: resolveConfirmedCategory(c),
        confirmedPriority: resolveConfirmedUrgency(c),
        complainantName: resolveComplainantName(c),
        respondent: resolveRespondent(c),
        incidentDate: c.incident_date,
        incidentTime: c.incident_time,
        location: c.incident_location,
        description: c.description,
      };
      generateComplaintPdf(pdfComplaint, {
        evidence: (bundle.evidence || []).map((ev) => ({
          ...ev,
          fileName: ev.file_name || ev.original_filename || ev.filename,
        })),
        hearings: (bundle.hearings || []).map((h) => ({
          title: h.title,
          date: h.hearing_date,
          time: h.hearing_time,
          venue: h.venue,
          status: h.status,
        })),
        caseStatuses: bundle.caseStatuses || [],
      });
      toast.success("Summary PDF downloaded.");
    } catch {
      toast.error("Could not generate the summary PDF.");
    } finally {
      setPrinting(false);
    }
  }, [bundle, printing]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-6 py-10">
        <Skeleton />
      </div>
    );
  }

  if (error || !bundle?.complaint) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-6 py-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(routes.complaints)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-mirage transition-colors hover:bg-alt"
            aria-label="Back to complaints"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="font-heading text-lg font-semibold text-navy">Case not found</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 text-sm text-muted">
          {error || "This complaint may have been removed or the link is invalid."}
        </div>
      </div>
    );
  }

  const c = bundle.complaint;

  // CAPTAIN-ONLY: the Captain's case file is one continuous workspace, not
  // a row of ten tabs. Everything below this point is the OIC/Secretary
  // view and is left exactly as it was.
  if (isCaptain) {
    return (
      <CaptainCaseWorkspace
        supabase={supabase}
        user={user}
        complaint={c}
        bundle={bundle}
        onChanged={refresh}
        onPrint={handlePrint}
        printing={printing}
      />
    );
  }

  const allowedTab = visibleTabs.find((t) => t.id === tab);
  const activeTab = allowedTab || visibleTabs[0];
  const gate = routingGate(c);

  /** The one "Continue Case Processing" step that is actually next. */
  const cta = routingCta(c, {
    hasBlotter: Boolean(bundle.blotterRecord),
    hasIncidentDetails: Boolean(bundle.incidentDetails),
    hasAssistance: (bundle.assistanceRecords || []).length > 0,
    isReceived: Boolean(c.official_received_at),
  });

  const handleContinueCase = () => {
    if (cta.disabled) return;
    if (cta.kind === "receive" || cta.kind === "workflow") {
      setWorkflowIntent(cta.kind === "receive" ? "receive" : null);
      setWorkflowOpen(true);
      return;
    }
    setTab("routing");
    setRoutingFocus(cta.kind);
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 py-10">
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
              {resolveReference(c)} · Filed {formatDateTime(c.submitted_at)}
            </p>
            <h1 className="mt-1 font-heading text-xl font-semibold leading-snug text-navy sm:text-2xl">
              {c.title}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {resolveCaseHeaderParties(c)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            disabled={printing}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print Summary
          </button>
          <button
            type="button"
            onClick={() => setWorkflowOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-jordy px-5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Official Action
          </button>
        </div>
      </div>

      <CaseSummary
        complaint={c}
        kpTracker={bundle.kpTracker}
        hearings={bundle.hearings}
      />

      {/* ── The gate, stated at the top of the case file ──────────
          Every tab below inherits this context, so an official never
          has to open a tab to find out why a control is disabled. */}
      {!gate.open ? (
        <p
          role="status"
          className="rounded-2xl border border-[#b45309]/25 bg-warning-soft px-4 py-3 text-sm font-semibold leading-relaxed text-warning sm:px-5"
        >
          {gate.headline}. Summons, mediation, the Lupon, and both 15-day periods are unavailable.
          {gate.detail ? ` ${gate.detail}` : ""}{" "}
          <span className="font-normal text-mirage">
            Record the respondent and KP applicability in Routing Assessment to enable them.
          </span>
        </p>
      ) : null}

      <div role="tablist" aria-label="Case sections" className="flex flex-wrap gap-2">
        {visibleTabs.map((t) => {
          const selected = t.id === activeTab.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                selected
                  ? "bg-navy text-white hover:bg-secondary"
                  : "border border-line bg-white text-mirage hover:bg-alt"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        id={`panel-${activeTab.id}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab.id}`}
        className="rounded-2xl border border-line bg-white p-5 shadow-soft"
      >
        {activeTab.id === "overview" && (
          <OverviewTab
            supabase={supabase}
            complaint={c}
            evidence={bundle.evidence}
            kpTracker={bundle.kpTracker}
            blotterRecord={bundle.blotterRecord}
          />
        )}
        {activeTab.id === "routing" && (
          <div className="space-y-5">
            <RoutingTab
              supabase={supabase}
              role={role}
              complaint={c}
              routingHistory={bundle.routingHistory}
              routingUnavailable={bundle.routingUnavailable}
              incidentDetails={bundle.incidentDetails}
              informationResponses={bundle.informationResponses}
              evidence={bundle.evidence}
              focus={routingFocus}
              onFocusCleared={() => setRoutingFocus(null)}
              onChanged={refresh}
            />
            <div className="border-t border-line pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-navy">
                Related Records
              </p>
              <div className="mt-3">
                <RelatedRecordsTab
                  supabase={supabase}
                  role={role}
                  complaint={c}
                  blotterRecord={bundle.blotterRecord}
                  assistanceRecords={bundle.assistanceRecords}
                  routingUnavailable={bundle.routingUnavailable}
                  focus={routingFocus}
                  onFocusCleared={() => setRoutingFocus(null)}
                  onChanged={refresh}
                />
              </div>
            </div>
          </div>
        )}
        {activeTab.id === "categorization" && (
          <CategorizationTab
            complaint={c}
            reviews={bundle.reviews}
            onChanged={refresh}
          />
        )}
        {activeTab.id === "tracking" && (
          <TrackingTab
            complaint={c}
            kpTracker={bundle.kpTracker}
            kpPhases={bundle.kpPhases}
            caseStatuses={bundle.caseStatuses}
            reviews={bundle.reviews}
            hearings={bundle.hearings}
            internalNotes={bundle.internalNotes}
          />
        )}
        {activeTab.id === "hearings" && (
          <HearingsTab
            supabase={supabase}
            user={user}
            complaint={c}
            hearings={bundle.hearings}
            serviceRecords={bundle.serviceRecords}
            onChanged={refresh}
          />
        )}
        {activeTab.id === "lupon" && (
          <LuponTab
            supabase={supabase}
            user={user}
            complaint={c}
            luponPanels={bundle.luponPanels}
            stage={stageOf(c, bundle.kpTracker)}
            onChanged={refresh}
            onStartPangkat={() => {
              setPangkatAction(true);
              setWorkflowOpen(true);
            }}
          />
        )}
        {activeTab.id === "documents" && (
          <DocumentsTab
            supabase={supabase}
            user={user}
            complaint={c}
            documents={bundle.documents}
            hearings={bundle.hearings}
            onChanged={refresh}
          />
        )}
        {activeTab.id === "referral" && (
          <PnpReferralTab
            supabase={supabase}
            user={user}
            complaint={c}
            evidence={bundle.evidence}
          />
        )}
        {activeTab.id === "audit" && (
          <AuditTab
            complaint={c}
            activityLogs={bundle.activityLogs}
            internalNotes={bundle.internalNotes}
            supabase={supabase}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-semibold text-navy">{activeTab.label}</span>
          <span className="text-muted"> · All official actions are recorded to the audit log.</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-mirage transition-colors hover:bg-alt"
          >
            <StickyNote className="h-4 w-4" aria-hidden="true" />
            Add Internal Note
          </button>
          <button
            type="button"
            onClick={handleContinueCase}
            disabled={cta.disabled}
            title={cta.disabled ? cta.hint : undefined}
            aria-label={cta.hint}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-jordy px-5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:bg-alt disabled:text-muted disabled:shadow-none"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {cta.label}
          </button>
        </div>
      </div>

      <WorkflowActions
        key={workflowOpen ? (workflowIntent || (pangkatAction ? "pangkat" : "open")) : "closed"}
        open={workflowOpen}
        onClose={() => {
          setWorkflowOpen(false);
          setWorkflowIntent(null);
          setPangkatAction(false);
        }}
        supabase={supabase}
        user={user}
        complaint={c}
        bundle={bundle}
        onChanged={() => {
          refresh();
          setWorkflowIntent(null);
          setPangkatAction(false);
        }}
        defaultAction={workflowIntent || (pangkatAction ? "startPangkat" : null)}
      />

      <InternalNoteModal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onSaved={refresh}
        complaint={c}
        supabase={supabase}
        user={user}
      />
    </div>
  );
}
