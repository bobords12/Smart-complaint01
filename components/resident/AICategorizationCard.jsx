"use client";

import { useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import ResidentModal from "@/components/shared/ResidentModal";
import useResidentComplaints from "@/hooks/useResidentComplaints";

function AICategoryDetails({ classification, onClose }) {
  return (
    <ResidentModal
      open
      onClose={onClose}
      labelledBy="ai-details-title"
      title="Classification Details"
      maxWidthClass="max-w-md"
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge label={classification.caseType} />
        <StatusBadge label={classification.urgencyLevel} />
      </div>
      <p className="mt-3 text-sm text-muted">
        Complaint:{" "}
        <span className="font-semibold text-mirage">
          {classification.incident}
        </span>
      </p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[13px] font-semibold">
          <span className="text-muted">Confidence</span>
          <span className="text-navy dark:text-secondary">{classification.confidence}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={classification.confidence}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="AI confidence score"
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-alt"
        >
          <div
            className="h-full rounded-full bg-secondary"
            style={{ width: `${classification.confidence}%` }}
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gold/40 bg-paledgold px-4 py-3">
        <p className="text-[13px] font-semibold text-bourbon">
          Barangay staff must confirm this result.
        </p>
      </div>

      <ul className="mt-4 space-y-2 text-[13px] text-muted">
        <li className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
          AI does not determine guilt or liability.
        </li>
        <li className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
          AI recommends case type and urgency only.
        </li>
        <li className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
          Authorized barangay officials make the final confirmation.
        </li>
      </ul>

      <div className="mt-6">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-secondary"
        >
          Close
        </button>
      </div>
    </ResidentModal>
  );
}

export default function AICategorizationCard() {
  const [open, setOpen] = useState(false);
  const { complaints } = useResidentComplaints();

  const latest = complaints[0] ?? null;
  const caseType = latest?.confirmed_category || latest?.predicted_category || "—";
  const urgencyLevel = latest?.confirmed_urgency || latest?.predicted_urgency || "—";
  const confidence = Math.round((Number(latest?.prediction_confidence) || 0) * 100);
  const incident = latest?.title || "No complaints yet";

  return (
    <section
      aria-labelledby="ai-card-title"
      className="rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
    >
      <header className="flex items-center justify-between gap-3">
        <h2
          id="ai-card-title"
          className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy dark:text-secondary"
        >
          <Sparkles className="h-5 w-5 text-gold" aria-hidden="true" />
          Latest Classification
        </h2>
        <span className="rounded-full bg-paledgold px-3 py-1 text-[11px] font-semibold text-bourbon">
          AI
        </span>
      </header>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-mirage">
            {incident}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge label={caseType} />
            <StatusBadge label={urgencyLevel} />
          </div>
        </div>

        <div className="w-full sm:w-40">
          <div className="flex items-center justify-between text-[12px] font-semibold">
            <span className="text-muted">Confidence</span>
            <span className="text-navy dark:text-secondary">{confidence}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={confidence}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="AI confidence score"
            className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-alt"
          >
            <div
              className="h-full rounded-full bg-secondary"
              style={{ width: `${confidence}%` }}
            />
          </div>
        </div>
      </div>

      <p className="mt-3 text-[12.5px] text-muted">
        Barangay staff must confirm this result.
      </p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-full border border-line px-4 text-[12.5px] font-semibold text-secondary transition-colors hover:border-secondary hover:bg-info-soft"
      >
        About classification
      </button>

      {open ? (
        <AICategoryDetails
          classification={{ caseType, urgencyLevel, confidence, incident }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
