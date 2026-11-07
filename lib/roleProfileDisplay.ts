import type { AppRole } from "@/types/auth";
import { LUPON_ROLE_LABELS, OFFICIAL_ROLE_LABELS, PNP_ROLE_LABELS } from "@/lib/permissions";

// Portal chrome uses role labels; stored profile names and roles are unchanged.
const ROLE_PROFILE_DISPLAY: Partial<Record<AppRole, { initials: string; primary: string; secondary: string }>> = {
  oic: { initials: "OIC", primary: "OIC", secondary: OFFICIAL_ROLE_LABELS.oic },
  secretary: { initials: "SE", primary: "Secretary", secondary: OFFICIAL_ROLE_LABELS.secretary },
  lupon: { initials: "LU", primary: "Lupon", secondary: LUPON_ROLE_LABELS.lupon },
  pnp_officer: { initials: "PN", primary: "PNP", secondary: PNP_ROLE_LABELS.pnp_officer },
};

export function getRoleProfileDisplay(role: AppRole | null | undefined) {
  return role ? ROLE_PROFILE_DISPLAY[role] ?? null : null;
}
