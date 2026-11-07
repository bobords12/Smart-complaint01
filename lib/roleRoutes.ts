import type { AppRole } from "@/types/auth";

/**
 * Roles that render inside the shared official shell
 * (OfficialLayout + CaptainShell + CaptainSidebar).
 *
 * A Lupon member is deliberately NOT in this list. The Lupon
 * Member Portal is a separate portal with a different navigation
 * set and a case-assignment-scoped permission model, so adding
 * 'lupon' here would grant it the official sidebar (Users &
 * Roles, Activity Logs, Blotter, Analytics, Reports).
 */
const OFFICIAL_ROLES: AppRole[] = ["captain", "oic", "secretary"];

export function isOfficialRole(role: AppRole): boolean {
  return OFFICIAL_ROLES.includes(role);
}

/**
 * A Lupon member has their own portal. This is deliberately kept
 * separate from isOfficialRole(): the two grants are not
 * interchangeable.
 */
export function isLuponRole(role: AppRole | string | null | undefined): boolean {
  return role === "lupon";
}

/**
 * A PNP officer has their own portal too, and the reason is stronger
 * than "different navigation": a PNP officer must never be reachable
 * through the official shell, and an official must never be routed
 * into the PNP portal. There is no role that grants both.
 */
export function isPnpRole(role: AppRole | string | null | undefined): boolean {
  return role === "pnp_officer";
}

/**
 * Get the post-login redirect route based on the user's role.
 *
 * The role must come from the trusted profiles table, never from
 * anything the client can influence.
 */
export function getPostLoginRoute(role: AppRole): string {
  const routes: Record<string, string> = {
    resident: "/resident/dashboard",
    captain: "/captain/dashboard",
    oic: "/oic/dashboard",
    secretary: "/secretary/dashboard",
    lupon: "/lupon/dashboard",
    pnp_officer: "/pnp/dashboard",
    staff: "/",
    police: "/",
    admin: "/",
  };
  return routes[role] || "/";
}
