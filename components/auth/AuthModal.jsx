"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAuthModal } from "@/context/AuthModalContext";
import AuthCard from "./AuthCard";
import AuthSecurityNote from "./AuthSecurityNote";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AuthModal() {
  const { isOpen, view, close, switchView } = useAuthModal();
  const panelRef = useRef(null);
  const previousActiveElement = useRef(null);

  const handleEscape = useCallback(
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    },
    [close]
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;

      const focusables = Array.from(
        panel.querySelectorAll(FOCUSABLE_SELECTOR)
      );
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
    },
    []
  );

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const raf = requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    window.addEventListener("keydown", handleEscape);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === "function") {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, handleEscape, handleKeyDown]);

  if (!isOpen) return null;

  const titleId =
    view === "login" ? "auth-modal-login-title" : "auth-modal-register-title";

  const modalContent = (
    <div aria-hidden={!isOpen} className="fixed inset-0 z-[70]">
      <div
        aria-hidden="true"
        onClick={close}
        className="absolute inset-0 bg-slate-950/55 transition-opacity"
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden p-4 sm:p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="pointer-events-auto relative max-h-[calc(100dvh-2rem)] w-full max-w-md outline-none sm:max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close dialog"
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy dark:hover:text-secondary focus-visible:outline-2 focus-visible:outline-secondary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>

          {view === "login" ? (
            <AuthCard
              topLabel="SECURE ACCESS"
              welcome="WELCOME!"
              title="Sign in with your email and password"
              titleId={titleId}
              subtitle="Use your resident or authorized barangay account to continue."
            >
              <LoginForm onSwitchView={switchView} />
              <AuthSecurityNote />
            </AuthCard>
          ) : (
            <AuthCard
              topLabel="RESIDENT REGISTRATION"
              title="Create your resident account"
              titleId={titleId}
              subtitle="Register to file complaints, receive hearing notices, and track your case progress."
            >
              <RegisterForm onSwitchView={switchView} />
              <AuthSecurityNote text="Accounts are activated only after an authorized barangay official verifies them." />
            </AuthCard>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
}
