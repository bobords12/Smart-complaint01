// Captain complaint action ladder — regression checks.
//
// Verifies the two derivations the Captain's "Current Action" panel and the
// "Case Progress" stepper are built on:
//
//   nextOfficialAction  — one action per complaint, from the state alone
//   workflowStepsFor    — monotonic, never more than one step marked current
//
// Run: npm run test:actions
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";

register("./resolve-alias.mjs", import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnvFile();
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { nextOfficialAction, workflowStepsFor, mediationFailedFor, latestMeetingOutcomeFor, settlementCloseDecisionFor, SETTLEMENT_CLOSED_STAGE } = await import(
  "@/lib/captainComplaintWorkflow"
);

let pass = 0;
let fail = 0;
function check(label, ok, extra = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function eq(label, actual, expected) {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log("1. the action ladder, rung by rung");
{
  const a = nextOfficialAction({ routing_status: "pending_assessment", current_status: "Pending Review" }, {});
  eq("fresh complaint -> Review", a?.key, "review");
  eq("  label", a?.label, "Review Complaint");
  eq("  opens the completeness control", a?.focus, "completeness");
  check("  review carries Reject as a secondary", a?.secondary?.some((s) => s.key === "reject"));

  const b = nextOfficialAction(
    { completeness_status: "complete", routing_status: "pending_assessment", current_status: "Pending Review" },
    {}
  );
  eq("reviewed, not docketed -> Receive & Docket", b?.key, "receive");
  eq("  label", b?.label, "Receive & Docket Complaint");
  eq("  hands the receive action to the modal", b?.workflowAction, "receive");

  const c = nextOfficialAction(
    {
      completeness_status: "complete",
      official_received_at: "2026-01-01T00:00:00Z",
      routing_status: "pending_assessment",
      current_status: "For Official Categorization",
    },
    {}
  );
  eq("docketed, uncategorized -> Review Classification", c?.key, "classify");
  eq("  section", c?.section, "classification");

  const d = nextOfficialAction(
    {
      completeness_status: "complete",
      official_received_at: "2026-01-01T00:00:00Z",
      confirmed_category: "Noise",
      confirmed_urgency: "Medium",
      routing_status: "pending_assessment",
      current_status: "For Official Categorization",
    },
    {}
  );
  eq("categorized, not routed -> Open Case Routing", d?.key, "routing");

  const inconsistent = nextOfficialAction({
    completeness_status: "complete", official_received_at: "2026-01-01T00:00:00Z",
    confirmed_category: "Civil", confirmed_urgency: "Normal",
    routing_status: "kp_mediation", current_status: "For Official Categorization",
  }, { hearings: [{ status: "Upcoming" }], documents: [{ document_type: "hearing_notice", status: "active" }] });
  eq("recorded categorization stage cannot offer a disposition action", inconsistent?.key, "classify");

  const routed = {
    completeness_status: "complete",
    official_received_at: "2026-01-01T00:00:00Z",
    confirmed_category: "Noise",
    confirmed_urgency: "Medium",
    routing_status: "kp_mediation",
    respondent_status: "identified",
    kp_applicability: "applicable",
    current_status: "Received",
  };
  eq("routed, no hearing -> Schedule Hearing", nextOfficialAction(routed, {})?.key, "schedule");
  eq(
    "hearing saved, no notice -> Generate Notice",
    nextOfficialAction(routed, { hearings: [{ status: "Scheduled" }] })?.key,
    "notice"
  );
  eq(
    "hearing + live notice -> Record Outcome",
    nextOfficialAction(routed, {
      hearings: [{ status: "Scheduled" }],
      documents: [{ document_type: "hearing_notice", status: "active" }],
    })?.key,
    "outcome"
  );
  eq(
    "superseded notice does not count as done",
    nextOfficialAction(routed, {
      hearings: [{ status: "Scheduled" }],
      documents: [{ document_type: "hearing_notice", status: "superseded" }],
    })?.key,
    "notice"
  );
  eq(
    "cancelled hearing does not count as scheduled",
    nextOfficialAction(routed, { hearings: [{ status: "Cancelled" }] })?.key,
    "schedule"
  );
  {
    const atOutcome = nextOfficialAction(routed, {
      hearings: [{ status: "Scheduled" }],
      documents: [{ document_type: "hearing_notice", status: "active" }],
    });
    eq("Record Outcome names exactly the two outcomes", atOutcome?.workflowAction, "settled,completed");
    eq(
      "  and offers no way to schedule a hearing the case has already had",
      atOutcome?.section,
      "mediation"
    );
  }
}

console.log("1b. the second stage, and the paper each ending owes");
{
  // Everything the party-facing ladder requires before it will look at
  // the second stage: docketed, categorized, routed, with a hearing that
  // was held and a notice already on file.
  const stage = {
    completeness_status: "complete",
    official_received_at: "2026-01-01T00:00:00Z",
    confirmed_category: "Noise",
    confirmed_urgency: "Medium",
    routing_status: "kp_mediation",
    respondent_status: "identified",
    kp_applicability: "applicable",
    current_status: "In Progress",
  };
  const mediationHearing = {
    status: "Completed",
    hearing_date: "2026-01-05",
    created_at: "2026-01-01T00:00:00Z",
  };
  const base = {
    hearings: [mediationHearing],
    documents: [{ document_type: "hearing_notice", status: "active" }],
  };
  // The fifteen days of Captain mediation, counted from a first meeting
  // far enough back that the period has certainly run out. The clock
  // reads the phase from the context, not from the complaint row.
  const mediationCtx = {
    ...base,
    kpPhases: [{ phase_type: "Mediation", start_date: "2026-01-05" }],
  };
  // Three distinct active members — the definition of a constituted panel.
  const panel = ["m1", "m2", "m3"].map((member_id) => ({
    status: "active",
    member_id,
    created_at: "2026-01-25T00:00:00Z",
  }));
  // A session the panel itself will sit at, dated after it was constituted.
  const panelContext = {
    ...mediationCtx,
    luponPanels: panel,
    hearings: [
      mediationHearing,
      { status: "Upcoming", hearing_date: "2026-02-05", created_at: "2026-01-26T00:00:00Z" },
    ],
  };

  eq(
    "mediation ran past its 15 days, no panel yet -> Constitute Pangkat",
    nextOfficialAction(stage, mediationCtx)?.key,
    "pangkat"
  );
  eq(
    "  hands the modal the startPangkat action",
    nextOfficialAction(stage, mediationCtx)?.workflowAction,
    "startPangkat"
  );
  eq(
    "panel constituted, no hearing of its own -> Schedule Pangkat Hearing",
    nextOfficialAction(stage, { ...mediationCtx, luponPanels: panel })?.key,
    "pangkat_hearing"
  );
  eq(
    "  and it schedules from the mediation section",
    nextOfficialAction(stage, { ...mediationCtx, luponPanels: panel })?.section,
    "mediation"
  );
  eq(
    "a session dated on or after the panel was constituted counts",
    nextOfficialAction(stage, panelContext)?.key,
    "outcome"
  );

  // The document each ending owes, offered before the case is asked to
  // record anything else.
  eq(
    "settlement recorded, none on file -> Generate Amicable Settlement",
    nextOfficialAction(stage, {
      ...panelContext,
      caseResolution: { settlement_date: "2026-02-10", settlement_terms: "Paid in full." },
    })?.key,
    "settlement_doc"
  );
  eq(
    "  and it opens Resolution & Outcomes",
    nextOfficialAction(stage, {
      ...panelContext,
      caseResolution: { settlement_date: "2026-02-10", settlement_terms: "Paid in full." },
    })?.section,
    "resolution"
  );
  eq(
    "once the settlement is on file, back to Record Outcome",
    nextOfficialAction(stage, {
      ...panelContext,
      caseResolution: { settlement_date: "2026-02-10", settlement_terms: "Paid in full." },
      documents: [
        { document_type: "hearing_notice", status: "active" },
        { document_type: "settlement", status: "active" },
      ],
    })?.key,
    "outcome"
  );
  eq(
    "conciliation failed, certificate not produced -> Generate CFA",
    nextOfficialAction(stage, {
      ...panelContext,
      caseResolution: { cfa_required: true, cfa_reason: "No agreement reached." },
    })?.key,
    "cfa_doc"
  );
  eq(
    "once the certificate is on file, back to Record Outcome",
    nextOfficialAction(stage, {
      ...panelContext,
      caseResolution: { cfa_required: true, cfa_reason: "No agreement reached." },
      documents: [
        { document_type: "hearing_notice", status: "active" },
        { document_type: "certificate_to_file_action", status: "active" },
      ],
    })?.key,
    "outcome"
  );
  // The closed-case invariant outranks the paperwork: a settled or
  // archived case is never offered a next step, whatever it still owes.
  eq(
    "a settled case still offers nothing, settlement or not",
    nextOfficialAction(
      { ...stage, current_status: "Resolved", current_stage: "Resolved — Amicable Settlement" },
      { ...panelContext, caseResolution: { settlement_date: "2026-02-10" } }
    ),
    null
  );
}

console.log("1c. a recorded \"No settlement\" opens the Pangkat section");
{
  // The section's defaultOpen is decided here, from the same persisted
  // rows the officer saved: a Meeting Record whose outcome says the
  // parties did not agree hands the case to the Pangkat immediately,
  // without waiting for the fifteen-day clock to lapse.
  const base = {
    completeness_status: "complete",
    official_received_at: "2026-01-01T00:00:00Z",
    confirmed_category: "Civil",
    confirmed_urgency: "Normal",
    routing_status: "kp_mediation",
    respondent_status: "identified",
    kp_applicability: "applicable",
    current_status: "Received",
  };
  const hearing = { id: "h1", status: "Held", hearing_date: "2026-01-05" };
  const noSettlement = [
    { hearing_id: "h1", conducted: "Yes", outcome: "No settlement", status: "Draft" },
  ];

  eq(
    "conducted meeting recorded \"No settlement\" -> Pangkat section opens",
    mediationFailedFor(base, { hearings: [hearing], minutes: noSettlement }),
    true
  );
  eq(
    "  with no attendance rows at all",
    mediationFailedFor(base, { hearings: [hearing], attendances: [], minutes: noSettlement }),
    true
  );
  eq(
    "an outcome of \"Settled\" does not open it",
    mediationFailedFor(base, {
      hearings: [hearing],
      minutes: [{ hearing_id: "h1", conducted: "Yes", outcome: "Settled" }],
    }),
    false
  );
  eq(
    "a meeting that did not take place cannot claim failure",
    mediationFailedFor(base, {
      hearings: [hearing],
      minutes: [{ hearing_id: "h1", conducted: "No", outcome: "No settlement" }],
    }),
    false
  );
  eq(
    "no meeting record at all -> nothing to open for",
    mediationFailedFor(base, { hearings: [hearing], minutes: [] }),
    false
  );
  eq(
    "a cancelled hearing is not mediation that failed",
    mediationFailedFor(base, {
      hearings: [{ id: "h1", status: "Cancelled", hearing_date: "2026-01-05" }],
      minutes: noSettlement,
    }),
    false
  );
  // A later hearing that settled the case takes the case back out of
  // the second stage: the most recent conducted meeting decides.
  eq(
    "a later \"Settled\" hearing supersedes an earlier failure",
    mediationFailedFor(base, {
      hearings: [hearing, { id: "h2", status: "Held", hearing_date: "2026-01-20" }],
      minutes: [
        ...noSettlement,
        { hearing_id: "h2", conducted: "Yes", outcome: "Settled", status: "Final" },
      ],
    }),
    false
  );
  // The same closed-case invariant the clock keeps: a disposed case is
  // not waiting on a Pangkat whatever its minutes still say.
  eq(
    "a Resolved case never opens it",
    mediationFailedFor({ ...base, current_status: "Resolved" }, {
      hearings: [hearing],
      minutes: noSettlement,
    }),
    false
  );
}

console.log("1d. settled + Amicable Settlement on file -> Case Closed");
{
  // The stamp the user sees on the complaints page: once the recorded
  // outcome is a settlement AND the Amicable Settlement has been
  // generated, the case is Closed — and the rule also takes the stamp
  // back off when the record stops supporting it, because a Closed case
  // is offered no action at all.
  const hearing = { id: "h1", status: "Held", hearing_date: "2026-01-05" };
  const base = {
    id: "c1",
    current_status: "Received",
    current_stage: "Received — Pending Summons",
  };
  const settledMinutes = [
    { hearing_id: "h1", conducted: "Yes", outcome: "Settled", status: "Draft" },
  ];
  const activeSettlement = [{ document_type: "settlement", status: "active" }];
  const ctx = { hearings: [hearing], minutes: settledMinutes, documents: activeSettlement };
  const closed = {
    ...base,
    current_status: "Closed",
    current_stage: SETTLEMENT_CLOSED_STAGE,
  };

  eq(
    "settled meeting + settlement on file -> close",
    settlementCloseDecisionFor(base, ctx),
    "close"
  );
  eq(
    "without the generated document -> nothing yet",
    settlementCloseDecisionFor(base, { ...ctx, documents: [] }),
    null
  );
  eq(
    "a document no longer on file does not close anything",
    settlementCloseDecisionFor(base, {
      ...ctx,
      documents: [{ document_type: "settlement", status: "superseded" }],
    }),
    null
  );
  eq(
    "an outcome other than \"Settled\" never closes",
    settlementCloseDecisionFor(base, {
      ...ctx,
      minutes: [{ hearing_id: "h1", conducted: "Yes", outcome: "Continued" }],
    }),
    null
  );
  eq(
    "a meeting that did not take place cannot claim a settlement",
    settlementCloseDecisionFor(base, {
      ...ctx,
      minutes: [{ hearing_id: "h1", conducted: "No", outcome: "Settled" }],
    }),
    null
  );
  eq(
    "the latest conducted meeting governs: \"No settlement\" wins",
    settlementCloseDecisionFor(base, {
      ...ctx,
      hearings: [hearing, { id: "h2", status: "Held", hearing_date: "2026-01-20" }],
      minutes: [
        ...settledMinutes,
        { hearing_id: "h2", conducted: "Yes", outcome: "No settlement", status: "Draft" },
      ],
    }),
    null
  );
  eq(
    "a recorded settlement with no Meeting Record still closes",
    settlementCloseDecisionFor(base, {
      hearings: [],
      minutes: [],
      documents: activeSettlement,
      caseResolution: { settlement_date: "2026-01-05" },
    }),
    "close"
  );
  eq(
    "a Resolved case holding its document is stamped Closed",
    settlementCloseDecisionFor(
      { ...base, current_status: "Resolved", current_stage: "Resolved — Amicable Settlement" },
      ctx
    ),
    "close"
  );
  eq(
    "a rejected complaint is never closed by this rule",
    settlementCloseDecisionFor({ ...base, current_status: "Rejected" }, ctx),
    null
  );

  // The other half: the stamp comes back off when the record stops
  // supporting it — but only off the cases this rule closed itself.
  eq(
    "still settled and on file -> no change",
    settlementCloseDecisionFor(closed, ctx),
    null
  );
  eq(
    "outcome corrected back to \"No settlement\" -> reopen",
    settlementCloseDecisionFor(closed, {
      ...ctx,
      minutes: [{ hearing_id: "h1", conducted: "Yes", outcome: "No settlement" }],
    }),
    "reopen"
  );
  eq(
    "repudiated settlement -> reopen",
    settlementCloseDecisionFor(closed, {
      ...ctx,
      caseResolution: { settlement_date: "2026-01-05", repudiated: true },
    }),
    "reopen"
  );
  eq(
    "document revoked after closing -> reopen",
    settlementCloseDecisionFor(closed, {
      ...ctx,
      documents: [{ document_type: "settlement", status: "revoked" }],
    }),
    "reopen"
  );
  eq(
    "an archived record is left alone, marker or not",
    settlementCloseDecisionFor({ ...base, current_status: "Closed", current_stage: "Archived" }, ctx),
    null
  );

  // The shared reading it all rests on, and the invariant downstream.
  eq(
    "latestMeetingOutcomeFor names the latest conducted outcome",
    latestMeetingOutcomeFor(ctx),
    "Settled"
  );
  eq(
    "once closed, the ladder still offers nothing",
    nextOfficialAction(closed, ctx),
    null
  );
}

console.log("2. a submission the barangay cannot accept yet is not docketed");
{
  const a = nextOfficialAction(
    { completeness_status: "needs_information", routing_status: "request_additional_information" },
    {}
  );
  eq("needs information -> back to routing, not Receive", a?.key, "routing");
  const b = nextOfficialAction({ completeness_status: "duplicate", routing_status: "pending_assessment" }, {});
  eq("duplicate -> routing, not Receive", b?.key, "routing");
}

console.log("3. closed cases offer nothing");
{
  eq("route closed", nextOfficialAction({ routing_status: "closed" }, {}), null);
  eq("route withdrawn", nextOfficialAction({ routing_status: "withdrawn" }, {}), null);
  eq("route rejected", nextOfficialAction({ routing_status: "rejected" }, {}), null);
  eq("route resolved_at_intake", nextOfficialAction({ routing_status: "resolved_at_intake" }, {}), null);
  eq("status Resolved", nextOfficialAction({ routing_status: "kp_mediation", current_status: "Resolved" }, {}), null);
  eq("status Closed", nextOfficialAction({ routing_status: "kp_mediation", current_status: "Closed" }, {}), null);
  eq("status Rejected", nextOfficialAction({ routing_status: "kp_mediation", current_status: "Rejected" }, {}), null);
}

console.log("4. rejection is available only where it is a valid decision");
{
  const base = { completeness_status: "complete", routing_status: "pending_assessment" };
  check(
    "during the information check",
    nextOfficialAction({ ...base, current_status: "Pending Review" }, {})?.secondary?.some((s) => s.key === "reject")
  );
  check(
    "during categorization",
    nextOfficialAction({ ...base, current_status: "For Official Categorization" }, {})?.secondary?.some((s) => s.key === "reject")
  );
  check(
    "not once the case is in progress",
    !nextOfficialAction({ ...base, current_status: "In Progress" }, {})?.secondary?.length
  );
  check(
    "not once it is awaiting a meeting",
    !nextOfficialAction({ ...base, current_status: "Awaiting Meeting" }, {})?.secondary?.length
  );
}

console.log("5. every ladder rung stays out of summons / mediation / disposition during Review");
{
  const review = nextOfficialAction({ routing_status: "pending_assessment" }, {});
  const words = JSON.stringify(review).toLowerCase();
  check("Review names no summons", !words.includes("summons"));
  check("Review names no mediation", !words.includes("mediation"));
  check("Review names no disposition", !words.includes("settle") && !words.includes("disposition"));
}

console.log("6. Case Progress shows at most one current step (monotonic)");
{
  const probes = [
    { label: "fresh", c: { routing_status: "pending_assessment", current_status: "Pending Review" }, ctx: {} },
    {
      label: "reviewed, classified, hearing held",
      c: {
        completeness_status: "complete",
        confirmed_category: "Noise",
        confirmed_urgency: "Medium",
        respondent_status: "identified",
        routing_status: "kp_mediation",
        current_status: "In Progress",
      },
      ctx: { hearings: [{ id: "h1", status: "Held", scheduled_for: "2026-01-05T10:00:00+08:00" }] },
    },
    {
      label: "received but not reviewed",
      c: {
        official_received_at: "2026-01-01T00:00:00Z",
        routing_status: "pending_assessment",
        current_status: "Pending Review",
      },
      ctx: {},
    },
    {
      label: "settled",
      c: {
        completeness_status: "complete",
        confirmed_category: "Noise",
        confirmed_urgency: "Medium",
        respondent_status: "identified",
        kp_applicability: "applicable",
        routing_status: "kp_mediation",
        current_status: "Resolved",
        current_stage: "Mediation Completed",
      },
      ctx: { hearings: [{ id: "h1", status: "Held", scheduled_for: "2026-01-05T10:00:00+08:00" }] },
    },
  ];
  for (const probe of probes) {
    const steps = workflowStepsFor(probe.c, probe.ctx);
    const currentIdx = steps.map((s, i) => (s.current ? i : -1)).filter((i) => i >= 0);
    check(`${probe.label}: never two current`, currentIdx.length <= 1, `got ${currentIdx.length}`);
    if (currentIdx.length === 1) {
      const i = currentIdx[0];
      const before = steps.slice(0, i);
      check(
        `${probe.label}: nothing before the current step is unfinished`,
        before.every((s) => s.done)
      );
    }
  }
}

console.log("7. Receive & Docket hands the modal an action its stage permits");
{
  const { stageOf, STAGE_ACTIONS } = await import("@/components/captain/complaints/complaintMeta");
  // A reviewed but not yet docketed complaint is the rung no row in the
  // database happens to sit on today, so it is exercised directly. It must
  // resolve to the receive action, and the action modal only accepts an
  // action the current stage allows — otherwise the one button the officer
  // pressed would open a list containing something else.
  const reviewed = {
    completeness_status: "complete",
    routing_status: "pending_assessment",
    current_status: "Pending Review",
  };
  const a = nextOfficialAction(reviewed, {});
  eq("reviewed, not docketed -> receive rung", a?.key, "receive");
  eq("  action handed to the modal", a?.workflowAction, "receive");
  const stage = stageOf(reviewed);
  check(`  stage "${stage}" permits receive`, (STAGE_ACTIONS[stage] || []).includes("receive"));

  const categorizing = {
    completeness_status: "complete",
    official_received_at: "2026-01-01T00:00:00Z",
    routing_status: "pending_assessment",
    current_status: "For Official Categorization",
  };
  const b = nextOfficialAction(categorizing, {});
  eq("docketed, uncategorized -> classify rung", b?.key, "classify");
  check("  rejection still valid while categorizing", b?.secondary?.some((s) => s.key === "reject"));
}

console.log("8. every complaint row in the database");
{
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.TEST_ACTIONS_LIVE_READ !== "1") {
    console.log("  skipped — live case scan requires explicit TEST_ACTIONS_LIVE_READ=1 on an approved test project");
  } else if (!url || !key) {
    console.log("  skipped — no service credentials in .env");
  } else {
    const supabase = createClient(url, key);
    const { stageOf, STAGE_ACTIONS } = await import("@/components/captain/complaints/complaintMeta");
    const [{ data: complaints }, { data: hearings }, { data: documents }] = await Promise.all([
      supabase.from("complaints").select("*"),
      supabase.from("hearings").select("*"),
      supabase.from("official_documents").select("id, complaint_id, document_type, status"),
    ]);
    if (!complaints) {
      console.log("  skipped — could not read complaints");
    } else {
      let worst = [];
      let currents = {};
      for (const c of complaints) {
        const ctx = {
          hearings: (hearings || []).filter((h) => h.complaint_id === c.id),
          documents: (documents || []).filter((d) => d.complaint_id === c.id),
        };
        const a = nextOfficialAction(c, ctx);
        if (a) currents[a.key] = (currents[a.key] || 0) + 1;
        const steps = workflowStepsFor(c, ctx);
        const idx = steps.map((s, i) => (s.current ? i : -1)).filter((i) => i >= 0);
        if (idx.length > 1) worst.push(`${c.reference_number}: ${idx.length} current`);
        else if (idx.length === 1 && idx[0] > 0 && steps.slice(0, idx[0]).some((s) => !s.done)) {
          worst.push(`${c.reference_number}: current behind an unfinished step`);
        }
        // A closed case must never offer an action.
        const closed = ["closed", "withdrawn", "rejected", "resolved_at_intake"].includes(c.routing_status) ||
          ["Resolved", "Closed", "Rejected"].includes(c.current_status);
        if (closed && a) worst.push(`${c.reference_number}: closed but offers "${a.label}"`);

        // A workflow action is handed to the action modal by key — one key, or
        // a few named as a comma list. If the modal's stage does not permit
        // every one of them it would fall back to some other list, and the
        // panel's single action would stop being the single action the officer
        // pressed.
        if (a?.workflowAction) {
          const stage = stageOf(c);
          const allowed = STAGE_ACTIONS[stage] || [];
          const offered = String(a.workflowAction)
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
          for (const key of offered) {
            if (!allowed.includes(key)) {
              worst.push(
                `${c.reference_number}: offers "${key}" but stage ${stage} allows [${allowed.join(", ")}]`
              );
            }
          }
        }
      }
      console.log(`  scanned ${complaints.length} complaints`);
      console.log(`  action distribution: ${JSON.stringify(currents)}`);
      check("no complaint shows two current steps or a closed case an action", worst.length === 0, worst.join(" | "));
    }
  }
}

console.log("");
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED, ${pass} passed`);

// Set the code rather than calling process.exit(): exiting while the
// Supabase fetch sockets are still closing trips a libuv assertion on
// Windows, which would report a non-zero status even when every check
// passed.
process.exitCode = fail === 0 ? 0 : 1;
