"use client";

import { createContext, useContext, useState, useCallback } from "react";

const ThemeContext = createContext({
  savedTheme: "light",
  draftTheme: "light",
  selectTheme: () => {},
  confirmTheme: () => {},
  resetDraft: () => {},
  loadFromDB: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }) {
  const [savedTheme, setSavedTheme] = useState("light");
  const [draftTheme, setDraftTheme] = useState("light");

  const selectTheme = useCallback((value) => {
    setDraftTheme(value);
  }, []);

  const confirmTheme = useCallback((value) => {
    setSavedTheme(value);
    setDraftTheme(value);
  }, []);

  const resetDraft = useCallback(() => {
    setDraftTheme(savedTheme);
  }, [savedTheme]);

  const loadFromDB = useCallback((theme) => {
    const valid = theme === "dark" ? "dark" : "light";
    setSavedTheme(valid);
    setDraftTheme(valid);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ savedTheme, draftTheme, selectTheme, confirmTheme, resetDraft, loadFromDB }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
