"use client";

import { useCallback, useRef, useState } from "react";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import { CheckCircle2, CloudUpload, Lock, TriangleAlert, XCircle } from "lucide-react";

import KioskHeader from "@/components/kiosk/KioskHeader";
import { Note } from "@/components/kiosk/KioskField";
import { useKioskConnection, useKioskLanguage } from "@/hooks/useKioskSession";
import {
  EVIDENCE_ACCEPTED_MIME,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES,
  UPLOAD_TOKEN_PATTERN,
} from "@/lib/kiosk/config";
import { formatBytes } from "@/lib/kiosk/format";
import { uploadKioskEvidence } from "@/lib/kiosk/signedUpload";

/**
 * The page a citizen's PHONE opens when it scans the evidence QR code on
 * the kiosk (Screen 10).
 *
 * This is a capability URL and nothing more. The 32 hex characters in the
 * path are the upload token; the database stores only its SHA-256 digest,
 * it expires after ten minutes, and it is revoked when the kiosk submits,
 * goes back, or lets it lapse. There is no session, no account and no
 * login, because the person standing at the kiosk already has none by
 * design.
 *
 * What the token is NOT allowed to do is anything that would make it a
 * document link. It carries no name, no mobile number, no address, no
 * narrative and no database id, so a photo taken by this phone cannot be
 * attributed to a complainant by anyone who later finds the URL.
 *
 * The server validates the QR session and returns a one-path upload token.
 * The phone sends bytes to private Supabase Storage, then the server checks
 * the stored object's size and type before reporting success. No large file
 * is buffered by the Next.js function.
 */
export default function KioskPhoneUploadPage() {
  const params = useParams();
  const { t, language, toggle } = useKioskLanguage();
  const connection = useKioskConnection();

  const token = typeof params?.uploadToken === "string" ? params.uploadToken : "";

  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  // Same reason as the status page: two taps can land in one tick before
  // the disabled state renders.
  const inFlight = useRef(false);

  const tokenValid = UPLOAD_TOKEN_PATTERN.test(token);

  const upload = useCallback(
    async (file) => {
      if (inFlight.current || !tokenValid) return;

      if (files.length >= MAX_EVIDENCE_FILES) {
        toast.error(t("err.fileCount"));
        return;
      }
      if (file.size > MAX_EVIDENCE_BYTES) {
        toast.error(t("err.fileSize"));
        return;
      }
      if (!EVIDENCE_ACCEPTED_MIME.includes(file.type)) {
        toast.error(t("err.fileType"));
        return;
      }

      inFlight.current = true;
      setBusy(true);

      const toastId = toast.loading(t("qr.waiting"));

      try {
        let uploaded;
        try {
          uploaded = await uploadKioskEvidence(token, file);
        } catch (error) {
          // An expired or revoked session gets its own message; the
          // citizen needs to know whether to wait or to go back to the
          // kiosk rather than try a different photo.
          const code = error?.code;
          const key =
            code === "invalid_token"
              ? "qr.expired"
              : code === "file_too_large"
                ? "err.fileSize"
                : code === "unsupported_type"
                  ? "err.fileType"
                  : "err.fileFailed";
          toast.error(t(key), { id: toastId });
          return;
        }

        setFiles((previous) => [
          ...previous,
          {
            name: uploaded.name,
            size: uploaded.size,
            mime: uploaded.mime_type,
          },
        ]);
        toast.success(t("qr.received"), { id: toastId });
      } catch (error) {
        const key = error?.name === "AbortError" ? "err.network" : "err.fileFailed";
        toast.error(t(key), { id: toastId });
      } finally {
        inFlight.current = false;
        setBusy(false);
        // Clear the input so choosing the same file twice in a row
        // still fires a change event.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [files.length, t, token, tokenValid]
  );

  if (!tokenValid) {
    return (
      <>
        <KioskHeader
          t={t}
          header={null}
          progressPercent={0}
          connection={connection.state}
          language={language}
          onToggleLanguage={toggle}
        />
        <main className="kiosk-main">
          <div className="kiosk-card kiosk-card-pad text-center">
            <TriangleAlert className="mx-auto h-12 w-12 text-critical" aria-hidden="true" />
            <h1 className="mt-3 text-[18px] font-bold text-navy">{t("qr.expired")}</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              {t("status.invalidLink")}
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <KioskHeader
        t={t}
        header={null}
        progressPercent={0}
        connection={connection.state}
        language={language}
        onToggleLanguage={toggle}
      />

      <main className="kiosk-main">
        <div className="text-center">
          <CloudUpload className="mx-auto h-12 w-12 text-navy" aria-hidden="true" strokeWidth={1.5} />
          <h1 className="mt-3 text-[20px] font-bold leading-snug text-navy sm:text-[23px]">
            {t("qr.title")}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">{t("qr.instructions")}</p>
        </div>

        <div className="mt-5">
          <Note tone="info">
            <span className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t("qr.privacyNote")}</span>
            </span>
          </Note>
        </div>

        {/* Picker. `capture` is deliberately NOT set: a citizen may be
            sending a screenshot or a PDF, and forcing the camera would
            make those unattachable. */}
        <div className="mt-4">
          <label
            htmlFor="kiosk-phone-file"
            className="kiosk-btn kiosk-btn-ghost kiosk-btn-block min-h-[56px] cursor-pointer"
          >
            <CloudUpload className="h-5 w-5" aria-hidden="true" />
            {t("received.addMore")}
          </label>
          <input
            ref={inputRef}
            id="kiosk-phone-file"
            type="file"
            accept={EVIDENCE_ACCEPTED_MIME.join(",")}
            className="sr-only"
            disabled={busy || files.length >= MAX_EVIDENCE_FILES}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
          />
        </div>

        <p className="mt-2 text-center text-[12.5px] text-muted">
          {t("err.fileSize")} &middot; {MAX_EVIDENCE_FILES} {t("common.files")}
        </p>

        {files.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2.5 rounded-[12px] border border-success/25 bg-success-soft p-3"
              >
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-mirage">
                    {file.name}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {formatBytes(file.size)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {files.some((file) => !EVIDENCE_ACCEPTED_MIME.includes(file.mime)) ? (
          <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-critical">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("err.fileType")}
          </p>
        ) : null}

        <p className="mt-5 text-center text-[13.5px] font-semibold text-navy">
          {files.length > 0 ? t("qr.received") : t("qr.waiting")}
        </p>
        <p className="mt-1 text-center text-[13px] leading-relaxed text-muted">
          {t("qr.help")}
        </p>
      </main>
    </>
  );
}
