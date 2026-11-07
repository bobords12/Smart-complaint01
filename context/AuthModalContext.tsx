"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

type AuthView = "login" | "register";

interface AuthModalContextValue {
  isOpen: boolean;
  view: AuthView;
  openLogin: () => void;
  openRegister: () => void;
  close: () => void;
  switchView: (view: AuthView) => void;
  triggerRef: RefObject<HTMLElement | null>;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<AuthView>("login");
  const triggerRef = useRef<HTMLElement | null>(null);

  const openLogin = useCallback(() => {
    setView("login");
    setIsOpen(true);
  }, []);

  const openRegister = useCallback(() => {
    setView("register");
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const switchView = useCallback((next: AuthView) => {
    setView(next);
  }, []);

  const value: AuthModalContextValue = {
    isOpen,
    view,
    openLogin,
    openRegister,
    close,
    switchView,
    triggerRef,
  };

  return (
    <AuthModalContext.Provider value={value}>
      {children}
    </AuthModalContext.Provider>
  );
}

export function useAuthModal(): AuthModalContextValue {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error("useAuthModal must be used within an AuthModalProvider");
  }
  return context;
}
