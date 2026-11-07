"use client";

/**
 * In-app viewer for a stored barangay document.
 *
 * WHY THIS EXISTS
 *   Every "View" action in this system used to call window.open() on a signed
 *   URL. For a .docx that makes the browser download the file instead of
 *   showing it, so "View" and "Download" did the same thing and an officer
 *   could not read a notice without saving it to their machine first. This
 *   dialog renders the document inside the page instead.
 *
 * NOTHING LEAVES THE BROWSER
 *   The file is fetched once through its signed URL and rendered locally:
 *   Word documents with docx-preview, PDFs in the browser's own viewer,
 *   images as images. No third-party conversion service is involved, which
 *   matters because these documents carry the names and addresses of
 *   complainants and respondents.
 *
 * WHAT IS STILL AVAILABLE
 *   Download and Print stay in the toolbar. Removing the download button
 *   would be a regression; the point is that viewing no longer *requires*
 *   one.
 *
 * STRUCTURE
 *   DocumentViewerModal owns the dialog shell — chrome, keyboard and focus
 *   behaviour, zoom. DocumentStage owns one document: it fetches the bytes,
 *   decides how they can be shown and renders them. The stage is mounted with
 *   a `key` of its URL, so opening a different file is a remount rather than a
 *   state reset, and a document that failed to render cannot leak its state
 *   into the next one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Download,
  ExternalLink,
  FileText,
  Printer,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  pushModalLayer,
  popModalLayer,
  isTopModalLayer,
  hasModalLayer,
} from "@/lib/modalLayer";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PDF_EXT = ["pdf"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
const DOCX_EXT = ["docx", "doc", "docm", "dotx", "dotm"];
const TEXT_EXT = ["txt", "csv", "log", "md", "json"];
const OFFICE_EXT = ["xlsx", "xls", "xlsm", "pptx", "ppt", "ppsx"];

function extensionOf(name) {
  const parts = String(name || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

/**
 * What kind of preview this dialog can offer. The filename is consulted as
 * well as the content type, because a stored row's mime_type is often blank
 * for documents uploaded before it was recorded.
 *
 * @returns {"pdf"|"image"|"docx"|"text"|"unsupported"|"unknown"}
 */
function detectDocumentKind({ filename, mime } = {}) {
  const type = String(mime || "").toLowerCase();
  const ext = extensionOf(filename);

  if (type.includes("pdf") || PDF_EXT.includes(ext)) return "pdf";
  if (type.startsWith("image/") || IMAGE_EXT.includes(ext)) return "image";
  if (type.includes("wordprocessingml") || DOCX_EXT.includes(ext)) return "docx";
  if (type.startsWith("text/") || TEXT_EXT.includes(ext)) return "text";
  if (
    type.includes("spreadsheetml") ||
    type.includes("presentationml") ||
    OFFICE_EXT.includes(ext)
  ) {
    return "unsupported";
  }
  return "unknown";
}

/** Zoom stops offered by the toolbar. 1 is the document's true size. */
const ZOOM_STEPS = [0.6, 0.75, 0.9, 1, 1.25, 1.5, 2];
const ZOOM_DEFAULT_INDEX = 3;

function Spinner({ label }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <span
        className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-secondary/25 border-t-secondary"
        aria-hidden="true"
      />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function UnavailablePanel({ heading, detail, filename, objectUrl, onOpenOriginal }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-white px-6 py-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-alt text-secondary">
        <CircleAlert className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-semibold text-navy">{heading}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p>
      {filename ? <p className="mt-2 truncate text-xs text-muted">{filename}</p> : null}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {objectUrl ? (
          <a
            href={objectUrl}
            download={filename || "document"}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download
          </a>
        ) : null}
        {onOpenOriginal ? (
          <button
            type="button"
            onClick={onOpenOriginal}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold text-mirage transition-colors hover:bg-alt"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open in a new tab
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One document, from bytes on screen. Mounted per URL, so its state always
 * describes the file currently being shown.
 */
function DocumentStage({ url, filename, mime, title, zoom, onOpenOriginal, onBytesReady }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [kind, setKind] = useState(null);
  const [buffer, setBuffer] = useState(null);
  const [objectUrl, setObjectUrl] = useState(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState(null);
  const [docxFailed, setDocxFailed] = useState(false);

  const stageRef = useRef(null);
  const onBytesReadyRef = useRef(onBytesReady);

  useEffect(() => {
    onBytesReadyRef.current = onBytesReady;
  }, [onBytesReady]);

  /* ── Fetch the bytes once ──────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    let createdUrl = null;

    (async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`The stored file could not be read (HTTP ${response.status}).`);
        }
        const bytes = await response.arrayBuffer();
        if (cancelled) return;

        const type = mime || response.headers.get("content-type") || "";
        createdUrl = URL.createObjectURL(new Blob([bytes], { type }));

        const detected = detectDocumentKind({ filename, mime: type });
        setBuffer(bytes);
        setObjectUrl(createdUrl);
        setKind(detected);
        if (detected === "text") {
          setText(new TextDecoder().decode(bytes));
        }
        setStatus("ready");
        // The toolbar lives in the dialog shell, so hand the blob up for the
        // Download link. Downloading a blob rather than re-hitting the signed
        // URL also keeps working after that URL has expired.
        onBytesReadyRef.current?.(createdUrl);
      } catch (error) {
        if (cancelled) return;
        setMessage(error?.message || "This document could not be opened. Please try again.");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      onBytesReadyRef.current?.(null);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url, filename, mime]);

  /* ── Lay a Word document out into the stage ────────────────────── */
  useEffect(() => {
    if (status !== "ready" || kind !== "docx" || !buffer) return undefined;

    const container = stageRef.current;
    if (!container) return undefined;

    let cancelled = false;
    container.innerHTML = "";

    (async () => {
      try {
        // Imported here rather than at module scope: docx-preview touches
        // the DOM and must never run while the server renders this page.
        // The layering helper is brought in with it for the same reason —
        // it queries the rendered tree.
        const { renderAsync } = await import("docx-preview");
        const { readBehindTextDrawings, applyBehindTextLayering } = await import(
          "@/lib/documents/docxLayering"
        );
        if (cancelled) return;

        // Read first, apply immediately after rendering, so the pictures that
        // Word keeps behind the text never get a frame on top of it. This is
        // what keeps the ribbon off the letterhead and the watermark out of
        // the body paragraphs; see lib/documents/docxLayering.js.
        const behindText = await readBehindTextDrawings(buffer);
        if (cancelled) return;

        await renderAsync(buffer, container, container, {
          inWrapper: true,
          breakPages: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          // NOTE: `className` is the *page* class, and the wrapper is derived
          // from it as `${className}-wrapper`. Leaving it at its default keeps
          // the class names the rules in app/globals.css are written against
          // (.docx-wrapper / section.docx), so the canvas overrides below the
          // stage actually match. Do not pass a custom value here.
        });
        if (cancelled) return;

        applyBehindTextLayering(container, behindText);
      } catch (error) {
        if (!cancelled) {
          console.error("DocumentViewer: could not render the Word document", error);
          setDocxFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (container) container.innerHTML = "";
    };
  }, [status, kind, buffer]);

  if (status === "loading") {
    return <Spinner label="Opening the document…" />;
  }

  if (status === "error") {
    return (
      <div className="px-4 py-10">
        <UnavailablePanel
          heading="This document could not be opened"
          detail={message}
          filename={filename}
          objectUrl={null}
          onOpenOriginal={onOpenOriginal}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center p-3 sm:p-5">
      <div style={{ zoom }} className="flex w-full flex-col items-center">
        {kind === "pdf" ? (
          <iframe
            title={title}
            src={objectUrl}
            className="h-[calc(100dvh-13rem)] min-h-[540px] w-full max-w-[900px] rounded-xl border border-line bg-white shadow-soft"
          />
        ) : null}

        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={objectUrl}
            alt={title}
            className="max-w-full rounded-xl border border-line bg-white object-contain shadow-soft"
          />
        ) : null}

        {kind === "text" ? (
          <pre className="w-full max-w-[900px] whitespace-pre-wrap rounded-xl border border-line bg-white px-5 py-4 font-mono text-xs leading-relaxed text-mirage shadow-soft">
            {text}
          </pre>
        ) : null}

        {kind === "docx" && !docxFailed ? (
          <div className="document-sheet-stage w-full" aria-live="polite">
            <div ref={stageRef} />
          </div>
        ) : null}

        {kind === "docx" && docxFailed ? (
          <UnavailablePanel
            heading="Preview unavailable for this Word document"
            detail="The document is stored and can be downloaded or printed; this browser could not lay it out for on-screen viewing."
            filename={filename}
            objectUrl={objectUrl}
            onOpenOriginal={onOpenOriginal}
          />
        ) : null}

        {kind === "unsupported" ? (
          <UnavailablePanel
            heading="No on-screen preview for this file type"
            detail="Spreadsheets and presentations are stored safely, but this viewer only renders Word documents, PDFs and images. Download the file to open it."
            filename={filename}
            objectUrl={objectUrl}
            onOpenOriginal={onOpenOriginal}
          />
        ) : null}

        {kind === "unknown" ? (
          <UnavailablePanel
            heading="No on-screen preview for this file"
            detail="The file type could not be identified, so it is shown as a download instead."
            filename={filename}
            objectUrl={objectUrl}
            onOpenOriginal={onOpenOriginal}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function DocumentViewerModal({ open, onClose, request }) {
  // Zoom is deliberately kept across documents rather than reset per file:
  // an officer who enlarges the type for one notice expects the next one to
  // open at the same size, the way a PDF reader behaves.
  const [zoomIndex, setZoomIndex] = useState(ZOOM_DEFAULT_INDEX);
  // Blob URL of the file currently on screen, handed up by the stage so the
  // toolbar can offer a download without a second trip to storage.
  const [downloadUrl, setDownloadUrl] = useState(null);

  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const layerRef = useRef(null);
  if (layerRef.current === null) layerRef.current = {};

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleBytesReady = useCallback((next) => setDownloadUrl(next), []);

  const url = request?.url || null;
  const filename = request?.filename || null;
  const mime = request?.mime || null;
  const zoom = ZOOM_STEPS[zoomIndex];

  const openOriginal = useCallback(() => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [url]);

  /* ── Dialog behaviour: Escape, focus, scroll lock ─────────────── */
  useEffect(() => {
    if (!open) return undefined;

    const token = layerRef.current;
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    closeRef.current?.focus();

    pushModalLayer(token);

    const onKeyDown = (event) => {
      // Escape dismisses only the topmost overlay, so this viewer does not
      // close at the same time as a dialog stacked above or below it.
      if (!isTopModalLayer(token)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const focusables = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      popModalLayer(token);
      if (!hasModalLayer() && previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const title = request?.title || request?.filename || "Document";
  const subtitle = request?.subtitle || null;

  return (
    <div className="fixed inset-0 z-[90]">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="modal-overlay absolute inset-0 bg-slate-950/70"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-2 sm:p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className="modal-panel pointer-events-auto relative flex h-[min(94dvh,1180px)] w-[min(1280px,100%)] flex-col overflow-hidden rounded-[20px] border border-line bg-white outline-none shadow-[0_24px_60px_rgba(11,33,68,0.32)]"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-secondary ring-1 ring-line">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-navy">{title}</p>
                {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="mr-1 hidden items-center gap-1 rounded-full border border-line bg-white px-1 py-1 sm:flex">
                <button
                  type="button"
                  onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
                  disabled={zoomIndex === 0}
                  aria-label="Zoom out"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy disabled:opacity-40"
                >
                  <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="w-11 text-center text-[11px] font-semibold text-muted">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))
                  }
                  disabled={zoomIndex === ZOOM_STEPS.length - 1}
                  aria-label="Zoom in"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy disabled:opacity-40"
                >
                  <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              {downloadUrl ? (
                <a
                  href={downloadUrl}
                  download={filename || "document"}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-2 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download
                </a>
              ) : null}

              {url ? (
                <button
                  type="button"
                  onClick={openOriginal}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-2 text-xs font-semibold text-mirage transition-colors hover:bg-alt"
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  Print
                </button>
              ) : null}

              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close document viewer"
                className="-mr-1 flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="relative flex-1 overflow-auto bg-alt">
            <DocumentStage
              key={url}
              url={url}
              filename={filename}
              mime={mime}
              title={title}
              zoom={zoom}
              onOpenOriginal={openOriginal}
              onBytesReady={handleBytesReady}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
