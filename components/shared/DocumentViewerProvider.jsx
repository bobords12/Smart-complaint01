"use client";

/**
 * One document viewer for the whole application.
 *
 * The case file, the documents page, the resident portal and the PNP referral
 * screen all need to show a stored file. They used to each open a signed URL
 * in a new tab, which downloads a .docx instead of displaying it. Now they
 * hand the file to this context and it is rendered in a dialog, from one
 * implementation, mounted once in components/shared/Providers.jsx.
 *
 * Two ways to open a document, so callers keep whatever they already have:
 *
 *   viewDocument({ supabase, storagePath, bucket, title, filename, mime })
 *     — resolves the signed URL itself. Bucket defaults to "documents".
 *
 *   viewDocument({ url, title, filename })
 *     — for callers that already hold a signed URL, including the repository
 *       helpers the resident and PNP portals go through.
 *
 * Both return true when the dialog was opened, so a caller can keep its own
 * "no stored file" message without this layer inventing one.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import toast from "react-hot-toast";
import DocumentViewerModal from "./DocumentViewerModal";

/** How long a resolved signed URL stays valid for the viewer's fetch. */
const SIGNED_URL_TTL_SECONDS = 3600;

const DocumentViewerContext = createContext(null);

export function DocumentViewerProvider({ children }) {
  const [request, setRequest] = useState(null);

  const viewDocument = useCallback(async (input) => {
    if (!input) return false;

    let url = input.url || null;

    if (!url) {
      const { supabase, storagePath, bucket = "documents" } = input;
      if (!supabase || !storagePath) return false;

      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

      if (error || !data?.signedUrl) {
        console.error("DocumentViewer: could not open a signed URL", {
          bucket,
          storagePath,
          error,
        });
        toast.error(input.errorMessage || "Could not open this document.");
        return false;
      }
      url = data.signedUrl;
    }

    setRequest({
      url,
      title: input.title || input.filename || "Document",
      subtitle: input.subtitle || null,
      filename: input.filename || null,
      mime: input.mime || null,
    });
    return true;
  }, []);

  const closeDocument = useCallback(() => setRequest(null), []);

  const value = useMemo(
    () => ({ viewDocument, closeDocument, isOpen: Boolean(request) }),
    [viewDocument, closeDocument, request]
  );

  return (
    <DocumentViewerContext.Provider value={value}>
      {children}
      <DocumentViewerModal open={Boolean(request)} onClose={closeDocument} request={request} />
    </DocumentViewerContext.Provider>
  );
}

/**
 * @returns {{ viewDocument: (input: object) => Promise<boolean>,
 *             closeDocument: () => void, isOpen: boolean }}
 */
export function useDocumentViewer() {
  const context = useContext(DocumentViewerContext);
  if (!context) {
    throw new Error(
      "useDocumentViewer must be used inside a <DocumentViewerProvider>. " +
        "It is mounted once in components/shared/Providers.jsx."
    );
  }
  return context;
}
