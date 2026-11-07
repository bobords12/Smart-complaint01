import { redirect } from "next/navigation";
import { getCurrentProfile, getPostLoginRoute } from "@/lib/auth";
import { canAccessPnpPage, type PnpPermissionKey } from "@/lib/permissions";
import type { Profile } from "@/types/auth";

export type PnpPageGuard =
  | { ok: true; profile: Profile }
  | { ok: false; role: string | null };

/**
 * Server-side guard for the PNP Coordination Portal.
 *
 * Mirrors requireLuponPage / requireOfficialPage but for
 * pnp_officer, which is deliberately NOT part of the official role
 * set and is not a resident.
 *
 * Note what this guard does and does not do:
 *   - It confirms WHO the caller is (trusted profile from
 *     public.profiles, never a URL param or client state).
 *   - It does NOT decide which referrals the caller may see. That
 *     is RLS. An officer who passes this guard still sees only
 *     formally approved referrals with an active assignment for
 *     their own id, and a direct guess of another referral's UUID
 *     returns nothing.
 *
 * Unauthenticated -> home. Wrong role -> that role's own
 * dashboard, so a captain who types /pnp/... lands back in the
 * Captain portal rather than on an error page.
 */
export async function requirePnpPage(
  permission: PnpPermissionKey
): Promise<PnpPageGuard> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/");
  }
  if (profile.role !== "pnp_officer") {
    redirect(getPostLoginRoute(profile.role));
  }
  if (profile.account_status !== "active") {
    // Middleware already signs these users out; this is the
    // server-side backstop for a direct render.
    redirect("/");
  }
  if (!canAccessPnpPage(profile.role, permission)) {
    return { ok: false, role: profile.role };
  }
  return { ok: true, profile };
}

/**
 * Guard for a single referral page.
 *
 * The `referralId` comes from the URL and is therefore attacker
 * controlled. It is never trusted: it is only passed to a query
 * that RLS already scopes to the caller's own assignments, so an
 * id belonging to another officer's referral simply yields no rows
 * and the page renders "not found" rather than any case data.
 */
export async function requirePnpReferralPage(
  referralId: string,
  permission: PnpPermissionKey = "pnp_referrals"
): Promise<PnpPageGuard & { referralId: string }> {
  const guard = await requirePnpPage(permission);
  if (!guard.ok) {
    return { ...guard, referralId };
  }
  if (!referralId || !isUuid(referralId)) {
    // Not a well-formed id: refuse before it reaches the query
    // layer at all.
    return { ok: false, role: guard.profile.role, referralId };
  }
  return { ...guard, referralId };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
