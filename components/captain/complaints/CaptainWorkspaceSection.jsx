"use client";

/**
 * Captain Portal -> Complaints: one collapsible section of the case
 * workspace.
 *
 * SECTION 11 OF THE REQUEST — "all information on one continuous page".
 * The Captain case file used to be ten equal tabs, which meant an official
 * had to open a tab to find out what applied to the case in front of them.
 * This component keeps every section on a single scrolling page while
 * still letting the page collapse to what the case actually needs: a
 * section the Captain must act on can be open, and a section that is only
 * reference material can be closed.
 *
 * NO INVENTED STATE
 *   `defaultOpen` is decided by the caller from persisted columns, and a
 *   section never shows itself as complete on its own — that is the
 *   caller's job, derived in lib/captainComplaintWorkflow.js. This file is
 *   presentation only.
 *
 * `focus` lets the page's single "next action" button open a section and
 * scroll to it, so following the next action never means hunting for the
 * right tab.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { WorkflowChip } from "./captainWorkflowUi";

export default function CaptainWorkspaceSection({
  id,
  title,
  description,
  badge,
  badgeTone = "neutral",
  open: externallyOpen,
  defaultOpen = false,
  focus,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const previousDefault = useRef(defaultOpen);
  const lastFocusNonce = useRef(null);

  // When the case moves on, the section that becomes the one to act on
  // opens itself. Only on a false -> true edge, so it does not fight the
  // Captain closing a section they are working in.
  useEffect(() => {
    if (defaultOpen && !previousDefault.current) setOpen(true);
    previousDefault.current = defaultOpen;
  }, [defaultOpen]);

  // The page's next-action button opens and scrolls to a section.
  useEffect(() => {
    if (!focus || focus.id !== id) return;
    if (focus.nonce === lastFocusNonce.current) return;
    lastFocusNonce.current = focus.nonce;
    setOpen(true);
    const node = document.getElementById(`case-section-${id}`);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, id]);

  const resolvedOpen = externallyOpen ?? open;
  const panelId = `case-section-panel-${id}`;

  return (
    <section
      id={`case-section-${id}`}
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-white shadow-soft"
    >
      <h2>
        <button
          type="button"
          onClick={() => (externallyOpen === undefined ? setOpen((v) => !v) : undefined)}
          aria-expanded={resolvedOpen}
          aria-controls={panelId}
          className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-canvas"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-sm font-semibold text-navy">{title}</span>
              {badge ? <WorkflowChip tone={badgeTone}>{badge}</WorkflowChip> : null}
            </span>
            {description ? (
              <span className="mt-1 block max-w-2xl text-xs leading-relaxed text-muted">
                {description}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`mt-0.5 h-5 w-5 shrink-0 text-muted transition-transform ${
              resolvedOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </h2>

      {resolvedOpen ? (
        <div id={panelId} className="border-t border-line px-5 py-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
