import { createClient } from "@/lib/supabase/server";
import type { Profile, AppRole } from "@/types/auth";
export { getPostLoginRoute, isOfficialRole } from "@/lib/roleRoutes";

/**
 * Get the current authenticated user from Supabase Auth.
 * Returns null if not authenticated.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user;
}

/**
 * Get the current user's profile from the profiles table.
 * Returns null if not authenticated or profile not found.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !data) return null;
  return data as Profile;
}

/**
 * Require an authenticated user. Throws if not authenticated.
 */
export async function requireAuthenticatedUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

/**
 * Require a specific role. Throws if user doesn't have the role.
 */
export async function requireRole(role: AppRole) {
  const profile = await getCurrentProfile();
  if (!profile) {
    throw new Error("UNAUTHORIZED");
  }
  if (profile.role !== role) {
    throw new Error("FORBIDDEN");
  }
  return profile;
}

/**
 * Require resident role specifically.
 */
export async function requireResident() {
  return requireRole("resident");
}
