import { createClient } from "@/lib/supabase/client";
import type { Profile, ResidentProfile } from "@/types/auth";

const supabase = createClient();

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) return null;
  return data as Profile;
}

export async function getResidentProfile(
  userId: string
): Promise<ResidentProfile | null> {
  const { data, error } = await supabase
    .from("resident_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) return null;
  return data as ResidentProfile;
}

export async function updateProfile(
  userId: string,
  updates: Partial<ResidentProfile>
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("resident_profiles")
    .update(updates)
    .eq("user_id", userId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updateProfileDisplay(
  userId: string,
  displayName: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function uploadAvatar(
  userId: string,
  file: File
): Promise<{ success: boolean; path?: string; error?: string }> {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return { success: false, error: "Choose a JPG, PNG, or WebP image." };
  }

  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    return { success: false, error: "Image must be 5 MB or smaller." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const timestamp = Date.now();
  const path = `${userId}/avatar-${timestamp}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true });

  if (uploadError) {
    console.error("Avatar upload error:", uploadError);
    return { success: false, error: uploadError.message };
  }

  const { data: profileRow, error: fetchError } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", userId)
    .single();

  if (fetchError) {
    console.error("Profile fetch error:", fetchError);
    return { success: false, error: "Upload succeeded but could not verify profile." };
  }

  const oldPath = profileRow?.avatar_path;

  const { error: updateError, count } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", userId);

  if (updateError) {
    console.error("Profile update error:", updateError);
    return { success: false, error: "Photo uploaded, but your profile could not be updated." };
  }

  if (count === 0) {
    return { success: false, error: "No profile row found. Please contact support." };
  }

  if (oldPath && oldPath !== path) {
    supabase.storage.from("avatars").remove([oldPath]).catch(() => {});
  }

  return { success: true, path };
}

export function getAvatarUrl(path: string | null): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

export const OFFICIAL_ROLE_LABELS: Record<string, string> = {
  captain: "Barangay Captain",
  resident: "Resident",
  oic: "Officer-in-Charge",
  secretary: "Barangay Secretary",
  lupon: "Lupon Member",
  pnp_officer: "PNP Officer",
  staff: "Staff",
  police: "Police",
  admin: "Administrator",
};

const OFFICIAL_IDENTITY_FALLBACK = {
  fullName: "Eduard Laranio",
  role: "Barangay Captain",
} as const;

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getOfficialIdentity(user: {
  fullName?: string;
  role?: string;
} | null): { displayName: string; roleLabel: string; initials: string } {
  if (!user) {
    return {
      displayName: OFFICIAL_IDENTITY_FALLBACK.fullName,
      roleLabel: OFFICIAL_IDENTITY_FALLBACK.role,
      initials: getInitials(OFFICIAL_IDENTITY_FALLBACK.fullName),
    };
  }

  const displayName = user.fullName?.trim() || OFFICIAL_IDENTITY_FALLBACK.fullName;
  const roleLabel =
    (user.role && OFFICIAL_ROLE_LABELS[user.role]) ||
    (user.role
      ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
      : OFFICIAL_IDENTITY_FALLBACK.role);

  return { displayName, roleLabel, initials: getInitials(displayName) };
}

export async function getSignedUrl(
  bucket: string,
  path: string
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600);

  if (error) return null;
  return data.signedUrl;
}
