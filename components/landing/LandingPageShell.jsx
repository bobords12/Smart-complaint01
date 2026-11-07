"use client";

import { AuthModalProvider } from "@/context/AuthModalContext";
import AuthModal from "@/components/auth/AuthModal";

export default function LandingPageShell({ children }) {
  return (
    <AuthModalProvider>
      {children}
      <AuthModal />
    </AuthModalProvider>
  );
}
