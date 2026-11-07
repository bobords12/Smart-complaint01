import { FileUp, SkipForward, Check, TriangleAlert } from "lucide-react";
import { ChoiceCard, Note } from "./KioskField";
import { EVIDENCE_METHODS } from "@/lib/kiosk/config";
import { formatFileCount } from "@/lib/kiosk/format";

const METHOD_KEY = { qr: "evidence.qr", skip: "evidence.skip" };
const METHOD_HINT_KEY = { qr: "evidence.qrHint", skip: "evidence.skipHint" };

/**
 * Step 6 — Evidence.
 *
 * Optional, and the screen says so twice, because a citizen who believes
 * evidence is mandatory will either abandon the complaint or pad it with
 * something irrelevant. Two paths only:
 *
 *   Scan to Upload  Opens the QR screen. A phone sends the file; the
 *                   kiosk never opens a local file dialog, which is the
 *                   point — on a shared machine a file picker would
 *                   expose the previous walk-in's Downloads folder.
 *   Skip Evidence   Records that no evidence was supplied and moves on.
 *
 * Choosing "skip" is not a lesser answer and is stored as a deliberate
 * choice rather than as a blank.
 */
export default function KioskEvidenceStep({ t, language, form, evidence, onChoose, error }) {
  const method = form.evidenceMethod;

  return (
    <div>
      <header className="mb-5 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("evidence.title")}
        </h1>
        <p className="mt-1.5 text-[15px] font-semibold text-muted">
          {t("evidence.subtitle")}
        </p>
      </header>

      <div role="radiogroup" aria-label={t("evidence.title")} className="space-y-3">
        {EVIDENCE_METHODS.map((option) => (
          <ChoiceCard
            key={option.value}
            name="evidenceMethod"
            value={option.value}
            checked={method === option.value}
            onChange={(value) => onChoose(value)}
            title={t(METHOD_KEY[option.value])}
            description={t(METHOD_HINT_KEY[option.value])}
          />
        ))}
      </div>

      <Note tone="info" className="mt-5">
        {t("evidence.optionalNote")}
      </Note>

      {/* The session could not be opened. Without this the citizen taps
          "Scan to Upload" and nothing appears to happen at all, so the
          complaint silently loses its evidence step. */}
      {error ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-critical bg-critical-soft/60 p-3.5 text-[13px] font-medium leading-relaxed text-critical"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t(error)}</span>
        </div>
      ) : null}

      {/* Already attached something. Reached by coming back from the QR
          or received screen, and shown here so the count is never lost
          on the way to review. */}
      {evidence.length > 0 ? (
        <div className="kiosk-card mt-4 kiosk-card-pad">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-success">
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            {formatFileCount(evidence.length, language, t("received.count"), t("common.files"))}
          </p>
          <ul className="mt-2 space-y-1">
            {evidence.map((file) => (
              <li key={file.id} className="truncate text-[12.5px] text-muted">
                {file.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex items-start gap-2.5 rounded-[12px] border border-line bg-alt/60 p-3.5 text-[12.5px] leading-relaxed text-muted">
        {method === "qr" ? (
          <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
        ) : (
          <SkipForward className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
        )}
        <span>{t("qr.privacyNote")}</span>
      </div>
    </div>
  );
}