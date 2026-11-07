"use client";

import { createContext, useContext, useMemo } from "react";
import { CAPTAIN_ROUTES } from "@/lib/constants";
import { getOfficialRoutes, isOfficialRole } from "@/lib/permissions";

const OfficialPortalContext = createContext({
  role: "captain",
  routes: CAPTAIN_ROUTES,
});

export function OfficialPortalProvider({ role, children }) {
  const value = useMemo(() => {
    const safeRole = isOfficialRole(role) ? role : "captain";
    return { role: safeRole, routes: getOfficialRoutes(safeRole) };
  }, [role]);

  return (
    <OfficialPortalContext.Provider value={value}>
      {children}
    </OfficialPortalContext.Provider>
  );
}

export function useOfficialPortal() {
  return useContext(OfficialPortalContext);
}

export function useOfficialRoutes() {
  return useContext(OfficialPortalContext).routes;
}
