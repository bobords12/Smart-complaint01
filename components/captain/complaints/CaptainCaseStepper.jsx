"use client";

/**
 * Captain Portal -> Complaints: the case progress stepper.
 *
 * SECTION 14 OF THE REQUEST — the progress tracker is shown as a
 * stepper rather than as another tab, and it changes with the case:
 *
 *   Two-party dispute  -> Summons, then Mediation Hearing.
 *   Unidentified suspect -> no summons and no hearing. It shows the
 *                         blotter / identification step instead, because
 *                         there is nobody to put on notice.
 *
 * The steps themselves are not written here. They come from
 * workflowStepsFor() in lib/captainComplaintWorkflow.js, which derives each
 * step from a persisted column or from the absence of a row, so the
 * stepper, the next-action card and the complaint list cannot disagree and
 * nothing is ever shown as done without a record of it.
 */

import { Check, Circle, CircleDot } from "lucide-react";
import { workflowStepsFor } from "@/lib/captainComplaintWorkflow";
import { WorkflowChip, WorkflowNote } from "./captainWorkflowUi";

export default function CaptainCaseStepper({ complaint, context }) {
  const steps = workflowStepsFor(complaint, context);
  const completed = steps.filter((s) => s.done).length;
  const current = steps.find((s) => s.current) || null;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-soft">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="font-heading text-sm font-semibold text-navy">Case Progress</h2>
        <WorkflowChip tone="info">
          {completed} of {steps.length} completed
        </WorkflowChip>
      </header>

      <div className="px-5 py-4">
        {/* auto-fit keeps the stepper readable from a tablet up to a wide
            desktop without hard-coding a column count per breakpoint. */}
        <ol
          className="grid gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
          aria-label="Case progress"
        >
          {steps.map((step, index) => (
            <li
              key={step.key}
              aria-current={step.current ? "step" : undefined}
              className={`flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
                step.done
                  ? "border-success/25 bg-success-soft"
                  : step.current
                    ? "border-[#2563b0]/30 bg-info-soft"
                    : "border-line bg-canvas"
              }`}
            >
              <span className="flex flex-col items-center">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                    step.done
                      ? "border-success bg-success text-white"
                      : step.current
                        ? "border-action bg-action text-white"
                        : "border-line bg-alt text-muted"
                  }`}
                >
                  {step.done ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : step.current ? (
                    <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Circle className="h-2 w-2 fill-current" aria-hidden="true" />
                  )}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[11px] font-semibold ${
                    step.done ? "text-success" : step.current ? "text-action" : "text-muted"
                  }`}
                >
                  Step {index + 1}
                </span>
                <span
                  className={`mt-0.5 block text-xs font-semibold leading-snug ${
                    step.current ? "text-navy" : step.done ? "text-mirage" : "text-muted"
                  }`}
                >
                  {step.label}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {current ? (
          <WorkflowNote tone="info">{current.detail}</WorkflowNote>
        ) : (
          <WorkflowNote tone="ok">
            Every step on this path has been recorded. The timeline below is the full history.
          </WorkflowNote>
        )}
      </div>
    </section>
  );
}
