import { redirect } from "next/navigation";
import { getCurrentProfile, getPostLoginRoute } from "@/lib/auth";
import {
  canAccessPage,
  isOfficialRole,
  type OfficialRole,
  type PermissionKey,
} from "@/lib/permissions";
import type { Profile } from "@/types/auth";

export type OfficialPageGuard =
  | { ok: true; profile: Profile }
  | { ok: false; role: string | null };

/**
 * Server-side guard for shared official portal pages.
 * - Unauthenticated → redirect to home (login flow).
 * - Wrong portal (role ≠ routeRole) → redirect to that role's own dashboard.
 * - Missing permission → return { ok: false } so the page renders <Unauthorized />.
 */
export async function requireOfficialPage(
  routeRole: OfficialRole,
  permission: PermissionKey
): Promise<OfficialPageGuard> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/");
  }
  if (!isOfficialRole(profile.role)) {
    redirect(getPostLoginRoute(profile.role));
  }
  if (profile.role !== routeRole) {
    redirect(getPostLoginRoute(profile.role));
  }
  if (!canAccessPage(profile.role, permission)) {
    return { ok: false, role: profile.role };
  }
  return { ok: true, profile };
}
