"use client";

import { AuthProvider } from "@/context/AuthContext";
import ToasterProvider from "@/components/shared/ToasterProvider";
import { DocumentViewerProvider } from "@/components/shared/DocumentViewerProvider";

export default function Providers({ children }) {
  return (
    <AuthProvider>
      <ToasterProvider />
      {/* Mounted here, once, so every portal — captain, OIC, secretary,
          resident, Lupon, PNP — opens stored documents through the same
          in-app viewer instead of downloading them from a new tab. */}
      <DocumentViewerProvider>{children}</DocumentViewerProvider>
    </AuthProvider>
  );
}
