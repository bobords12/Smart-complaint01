"use client";

import { Toaster } from "react-hot-toast";

export default function ToasterProvider() {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 4000,
        style: {
          fontFamily: '"Public Sans", ui-sans-serif, system-ui, sans-serif',
          borderRadius: "12px",
          border: "1px solid #DCE3EE",
          background: "#ffffff",
          color: "#182233",
          boxShadow: "0px 4px 50px rgba(0, 0, 0, 0.12)",
          padding: "12px 16px",
        },
        success: {
          iconTheme: { primary: "#34d399", secondary: "#FFFFFF" },
        },
        error: {
          iconTheme: { primary: "#f87171", secondary: "#FFFFFF" },
        },
      }}
    />
  );
}
