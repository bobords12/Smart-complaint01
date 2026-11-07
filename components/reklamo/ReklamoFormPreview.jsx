"use client";

import { forwardRef } from "react";
import { buildReklamoFieldModel, formHeaderLines } from "@/lib/reklamo/reklamoDocument";
import { formDateParts } from "@/lib/documents/printedForm";

/**
 * Browser preview of the Reklamo Form.
 *
 * This mirrors lib/reklamo/reklamoPdf.js row for row — same labels in the same
 * order, same ruled slots, same footer — so what an official reads on screen is
 * what prints. The vertical gaps are the same millimetre deltas the PDF uses,
 * taken from supabase/manual/reklamo.png.
 */

/** Gap between the letterhead and the case-number row. */
const GAP = {
  caseNumber: 10,
  complainant: 14,
  respondent: 12,
  title: 14,
  narrative: 11,
  footer: 26,
  rows: 12,
  rowsTight: 14,
};

function RuledRow({ label, value, gap = GAP.rows, labelClassName = "", children }) {
  return (
    <p className="flex items-baseline gap-1.5 text-black" style={{ marginTop: `${gap}mm` }}>
      <span className={`shrink-0 font-bold ${labelClassName}`}>{label}</span>
      {value ? <span className="min-w-0 break-words">{value}</span> : null}
      {children}
      <span className="min-w-[1.5cm] flex-1 border-b border-black" />
    </p>
  );
}

function Slot({ text, minWidth = "1.5cm" }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className="min-w-0 border-b border-black px-1 text-center"
        style={{ minWidth }}
      >
        {text || "\u00A0"}
      </span>
    </span>
  );
}

const ReklamoFormPreview = forwardRef(function ReklamoFormPreview(
  { model: providedModel, inputs, className = "" },
  ref
) {
  const model = providedModel || buildReklamoFieldModel(inputs || {});
  const header = formHeaderLines();
  const incident = formDateParts(model.incident.date);
  const received = formDateParts(model.receivedAt);
  const respondents = model.respondents.length ? model.respondents.join(", ") : null;

  return (
    <div className="overflow-x-auto">
      <article
        ref={ref}
        data-reklamo-page="true"
        data-watermark={model.watermark}
        aria-label="Reklamo Form preview"
        className={`reklamo-page mx-auto w-full min-w-[280px] max-w-[210mm] bg-white text-[12px] leading-relaxed text-black shadow-feather ring-1 ring-neutral-300 ${className}`}
        style={{ padding: "15mm 18mm 16mm" }}
      >
        <header className="text-center">
          {header.map((line) => (
            <p key={line} className="font-bold uppercase leading-tight text-black">
              {line}
            </p>
          ))}
        </header>

        <RuledRow
          gap={GAP.caseNumber}
          label={model.caseNumber ? "Barangay Case No." : "Tracking No."}
          value={model.caseNumber || model.trackingNumber}
        />

        <p className="flex items-baseline gap-1.5 text-black" style={{ marginTop: `${GAP.caseNumber}mm` }}>
          <span className="ml-auto shrink-0 font-bold">For:</span>
          <span className="w-[44mm] border-b border-black" />
        </p>

        <RuledRow
          gap={GAP.complainant}
          label="Complainant/nagsumbong:"
          value={model.complainant.name}
        />
        <RuledRow gap={GAP.respondent} label="Respondent/sinumbong:" value={respondents} />

        <h2
          className="text-center font-bold text-black"
          style={{ marginTop: `${GAP.title}mm`, fontSize: "15pt", letterSpacing: "0.3em" }}
        >
          REKLAMO
        </h2>

        <div className="whitespace-pre-wrap break-words text-black" style={{ marginTop: `${GAP.narrative}mm` }}>
          {model.narrativeParagraphs.map((paragraph, index) => (
            <p key={index} className={index > 0 ? "mt-1.5" : undefined}>
              {paragraph}
            </p>
          ))}
        </div>

        <p className="flex flex-wrap items-baseline gap-x-1.5 text-black" style={{ marginTop: `${GAP.footer}mm` }}>
          <span className="font-bold">Gihimo ning ika</span>
          <Slot text={incident?.day} minWidth="10mm" />
          <span className="font-bold">bulan</span>
          <Slot text={incident?.month} minWidth="26mm" />
          <span className="font-bold">tuig</span>
          <Slot text={incident?.year} minWidth="16mm" />
          <span>.</span>
        </p>

        <RuledRow
          gap={GAP.rows}
          label="(Mga) Nagsumbong:"
          value={model.complainant.name}
        />

        <p className="flex flex-wrap items-baseline gap-x-1.5 text-black" style={{ marginTop: `${GAP.rows}mm` }}>
          <span className="font-bold">Nadawat ug gitipigan niining ika</span>
          <Slot text={received?.day} minWidth="10mm" />
          <span className="font-bold">bulan</span>
          <Slot text={received?.month} minWidth="26mm" />
          <span className="font-bold">sa tuig</span>
          <Slot text={received?.year} minWidth="16mm" />
          <span>.</span>
        </p>

        <footer className="flex flex-col items-end text-black" style={{ marginTop: `${GAP.rowsTight}mm` }}>
          <span className="w-[70mm] border-b border-black" />
          <p className="mt-1.5 font-bold">{model.signature?.name || "\u00A0"}</p>
          <p>{model.signature?.title || "\u00A0"}</p>
        </footer>
      </article>
    </div>
  );
});

export default ReklamoFormPreview;
