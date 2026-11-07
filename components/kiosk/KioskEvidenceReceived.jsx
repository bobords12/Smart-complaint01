import { FileText, ImageIcon, Trash2 } from "lucide-react";
import { Note } from "./KioskField";
import { formatBytes } from "@/lib/kiosk/format";

/**
 * Screen 11 — Evidence received.
 *
 * Confirms what actually arrived, from the server's response, before the
 * citizen is told it is part of their complaint. Nothing is inferred
 * locally: the kiosk did not choose these files, a phone sent them, and
 * the only honest statement is what the server says it stored.
 *
 * Each row can be removed here. Removal only forgets the attachment at
 * the kiosk; the already-uploaded object is detached by the submit call
 * or expires with the session. The QR code is kept available so the
 * citizen can add more rather than having to start over.
 */
export default function KioskEvidenceReceived({ t, files = [], onRemove, onAddMore, onContinue, onSkip }) {
  const isPdf = (file) => String(file.mime_type || "").includes("pdf");

  return (
    <div>
      <header className="mb-5 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("received.title")}
        </h1>
        <p className="mt-1.5 text-[15px] font-semibold text-muted">
          <span className="tabular-nums">{files.length}</span>{" "}
          {files.length === 1 ? t("received.count") : t("common.files")}
        </p>
      </header>

      {files.length === 0 ? (
        <Note tone="warn">{t("received.empty")}</Note>
      ) : (
        <ul className="space-y-3">
          {files.map((file) => (
            <li key={file.id} className="kiosk-card kiosk-card-pad flex items-center gap-3">
              {file.previewUrl && !isPdf(file) ? (
                // The preview is an object URL owned by the wizard, which
                // revokes it on reset. alt is empty because the filename
                // below already carries the meaning.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.previewUrl}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-[10px] border border-line object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] border border-line bg-alt">
                  {isPdf(file) ? (
                    <FileText className="h-6 w-6 text-secondary" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-secondary" aria-hidden="true" />
                  )}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-mirage">
                  {file.name || t("review.evidence")}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {formatBytes(file.size)}
                  {file.mime_type ? ` · ${file.mime_type.split("/").pop().toUpperCase()}` : ""}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onRemove(file.id)}
                aria-label={`${t("common.remove")} ${file.name || ""}`}
                className="kiosk-btn kiosk-btn-ghost min-h-[40px] shrink-0 px-3 text-critical"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{t("common.remove")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={onContinue}
          className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[52px] text-[16px]"
        >
          {t("received.review")}
        </button>
        <button type="button" onClick={onAddMore} className="kiosk-btn kiosk-btn-ghost kiosk-btn-block">
          {t("received.addMore")}
        </button>
        {files.length > 0 ? (
          <button type="button" onClick={onSkip} className="kiosk-btn kiosk-btn-quiet kiosk-btn-block">
            {t("evidence.skip")}
          </button>
        ) : null}
      </div>
    </div>
  );
}