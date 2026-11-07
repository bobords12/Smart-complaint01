import { redirect } from "next/navigation";
import { getCurrentProfile, getPostLoginRoute } from "@/lib/auth";
import { canAccessLuponPage, type LuponPermissionKey } from "@/lib/permissions";
import type { Profile } from "@/types/auth";

export type LuponPageGuard =
  | { ok: true; profile: Profile }
  | { ok: false; role: string | null };

/**
 * Server-side guard for the Lupon Member Portal.
 *
 * Mirrors requireOfficialPage but for the lupon role, which is
 * deliberately NOT part of the official role set.
 *
 * Note what this guard does and does not do:
 *   - It confirms WHO the caller is (trusted profile from
 *     public.profiles, never a URL param or client state).
 *   - It does NOT decide which cases the caller may see. That is
 *     RLS. A member who passes this guard still sees only the
 *     cases with an active lupon_panels row for their own id, and
 *     a direct guess of another case's UUID returns nothing.
 *
 * Unauthenticated -> home. Wrong role -> that role's own
 * dashboard, so a captain who types /lupon/... lands back in the
 * Captain portal rather than on an error page.
 */
export async function requireLuponPage(
  permission: LuponPermissionKey
): Promise<LuponPageGuard> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/");
  }
  if (profile.role !== "lupon") {
    redirect(getPostLoginRoute(profile.role));
  }
  if (profile.account_status !== "active") {
    // Middleware already signs these users out; this is the
    // server-side backstop for a direct render.
    redirect("/");
  }
  if (!canAccessLuponPage(profile.role, permission)) {
    return { ok: false, role: profile.role };
  }
  return { ok: true, profile };
}

/**
 * Guard for a single case page.
 *
 * The `caseId` comes from the URL and is therefore attacker
 * controlled. It is never trusted: it is only passed to a query
 * that RLS already scopes to the caller's own assignments, so an
 * id belonging to another member's case simply yields no rows and
 * the page renders "not assigned" rather than any case data.
 */
export async function requireLuponCasePage(
  caseId: string,
  permission: LuponPermissionKey = "lupon_cases"
): Promise<LuponPageGuard & { caseId: string }> {
  const guard = await requireLuponPage(permission);
  if (!guard.ok) {
    return { ...guard, caseId };
  }
  if (!caseId || !isUuid(caseId)) {
    // Not a well-formed id: refuse before it reaches the query
    // layer at all.
    return { ok: false, role: guard.profile.role, caseId };
  }
  return { ...guard, caseId };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
