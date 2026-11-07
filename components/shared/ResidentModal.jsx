"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import {
  pushModalLayer,
  popModalLayer,
  isTopModalLayer,
  hasModalLayer,
} from "@/lib/modalLayer";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ResidentModal({
  open,
  onClose,
  labelledBy,
  title,
  children,
  maxWidthClass = "max-w-lg",
}) {
  const panelRef = useRef(null);
  const layerRef = useRef(null);
  if (layerRef.current === null) layerRef.current = {};

  // The latest close handler, kept in a ref rather than read from the
  // effect's dependencies.
  //
  // Callers overwhelmingly pass `onClose={() => ...}`, which is a new
  // function on every render of the parent. Listing it as an effect
  // dependency therefore re-ran the whole setup/teardown on every render,
  // and that setup calls panel.focus(). Any state change - typing in a
  // textarea being the obvious one - yanked focus back to the dialog and
  // toggled the body scroll lock, which reads to the user as the page
  // freezing up. Depending on `open` alone gives one setup per open.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const token = layerRef.current;
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;

    pushModalLayer(token);
    panel?.focus();

    const onKeyDown = (event) => {
      // Only the dialog on top of the stack handles keys, otherwise a
      // confirm dialog and the form behind it would both close on Escape.
      if (!isTopModalLayer(token)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = panel
        ? Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR))
        : [];
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

      // Only the last dialog standing hands focus back. A closing confirm
      // dialog must not yank focus out of the form it was stacked on.
      if (!hasModalLayer()) {
        if (
          previouslyFocused &&
          typeof previouslyFocused.focus === "function" &&
          previouslyFocused.isConnected
        ) {
          previouslyFocused.focus();
        }
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="modal-overlay absolute inset-0 bg-slate-950/55"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-y-auto p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          className={`modal-panel pointer-events-auto relative my-auto w-full outline-none ${maxWidthClass}`}
        >
          <div className="overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_24px_60px_rgba(11,33,68,0.28)] dark:bg-alt dark:shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
            <header className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-5 py-4 sm:px-6">
              <h2
                id={labelledBy}
                className="text-lg font-semibold tracking-tight text-navy dark:text-secondary"
              >
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy dark:hover:text-secondary focus-visible:outline-2 focus-visible:outline-secondary"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>
            <div className="max-h-[min(70dvh,600px)] overflow-y-auto px-5 py-5 sm:px-6">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}