"use client";

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { FileText, ExternalLink } from "lucide-react";

import { useKioskLanguage } from "@/hooks/useKioskSession";
import { fetchDocumentUrl } from "@/lib/kiosk/api";
import { getFingerprint } from "@/lib/kiosk/device";

/**
 * The resident-visible documents card on the tracking page.
 *
 * The payload carries DISPLAY METADATA ONLY (see kiosk-07). Opening a
 * document asks the server for a short-lived signed URL, which the
 * service-role RPC mints only after re-checking the token, the complaint
 * ownership, the visibility and the document type. A Respondent Summons
 * is never in the list and cannot be requested.
 *
 * The card is not rendered at all when there is no token (the manual
 * lookup route has none) or when the barangay has shared nothing yet.
 */
export default function KioskStatusDocuments({ documents, statusToken }) {
  const { t } = useKioskLanguage();
  const [busyId, setBusyId] = useState(null);

  const open = useCallback(
    async (doc) => {
      if (busyId) return;
      setBusyId(doc.id);
      const toastId = toast.loading(t("common.loading"));
      try {
        const fingerprint = await getFingerprint();
        const response = await fetchDocumentUrl({
          token: statusToken,
          documentId: doc.id,
          fingerprint,
        });
        const url = response?.document?.url || response?.url;
        if (!url) throw new Error("no_url");
        window.open(url, "_blank", "noopener,noreferrer");
        toast.success(typeLabel(doc.document_type, t), { id: toastId });
      } catch {
        toast.error(t("docs.unavailable"), { id: toastId });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, statusToken, t]
  );

  if (!statusToken || !Array.isArray(documents) || documents.length === 0) {
    return null;
  }

  return (
    <section className="kiosk-card kiosk-card-pad">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
        {t("docs.title")}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t("docs.intro")}</p>

      <ul className="mt-3 space-y-2.5">
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <FileText
                className="mt-0.5 h-4 w-4 shrink-0 text-secondary"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-snug break-words text-mirage">
                  {doc.title || typeLabel(doc.document_type, t)}
                </p>
                <p className="text-[12px] text-muted">
                  {typeLabel(doc.document_type, t)}
                  {doc.version ? ` · v${doc.version}` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => open(doc)}
              disabled={busyId === doc.id}
              className="kiosk-btn kiosk-btn-ghost shrink-0 kiosk-no-print"
            >
              {busyId === doc.id ? (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-full border-2 border-navy/30 border-t-navy kiosk-spin"
                />
              ) : (
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              )}
              {t("docs.open")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Localised label for a document type, with a generic fallback. */
function typeLabel(type, t) {
  const key = `docs.type.${type}`;
  const label = t(key);
  return label === key ? t("docs.type.other") : label;
}
