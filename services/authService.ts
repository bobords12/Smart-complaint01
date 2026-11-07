import { createClient } from "@/lib/supabase/client";
import type { AppRole, AuthSession, LoginCredentials, RegistrationData } from "@/types/auth";

const supabase = createClient();

const VALID_ROLES: AppRole[] = [
  "resident",
  "captain",
  "oic",
  "secretary",
  "lupon",
  "pnp_officer",
  "staff",
  "police",
  "admin",
];

const ROLE_NOT_CONFIGURED =
  "Your account role is not configured. Please contact the administrator.";

type ProfileRow = {
  role: AppRole;
  display_name: string | null;
  account_status: string | null;
  first_login_completed: boolean | null;
};

async function failLogin(message: string): Promise<{ success: false; error: string }> {
  await supabase.auth.signOut();
  return { success: false, error: message };
}

/**
 * Roles whose account is provisioned by an administrator rather than
 * by the person signing in. A `pending` account for one of these is
 * not a valid login: the officer exists in the system before their
 * invitation is completed, and letting them in on a pending status
 * would expose the PNP portal to an account nobody finished setting
 * up. Residents are deliberately excluded so a self-registration in
 * `pending` can still complete onboarding.
 */
const ADMIN_PROVISIONED_ROLES: AppRole[] = ["oic", "secretary", "pnp_officer"];

function validateProfile(profile: ProfileRow): string | null {
  if (!profile.role || !VALID_ROLES.includes(profile.role)) {
    return ROLE_NOT_CONFIGURED;
  }
  if (profile.account_status === "suspended" || profile.account_status === "disabled") {
    return "Your account has been suspended. Please contact the barangay office.";
  }
  if (
    ADMIN_PROVISIONED_ROLES.includes(profile.role) &&
    profile.account_status !== "active"
  ) {
    return "Your account is not active. Please contact the barangay administrator.";
  }
  return null;
}

export async function registerResident(
  data: RegistrationData
): Promise<{ success: boolean; error?: string; requiresConfirmation?: boolean }> {
  const { data: authData, error } = await supabase.auth.signUp({
    email: data.email.trim(),
    password: data.password,
    options: {
      data: {
        first_name: data.firstName,
        middle_name: data.middleName,
        last_name: data.lastName,
        suffix: data.suffix,
        date_of_birth: data.dob,
        sex: data.sex,
        mobile_number: data.mobile,
        house_street: data.houseNo,
        purok: data.purok,
      },
    },
  });

  if (error) {
    console.error("Supabase signUp error:", error.message, error);
    if (error.message.includes("already")) {
      return { success: false, error: "An account with this email already exists." };
    }
    if (error.message.includes("Password")) {
      return { success: false, error: error.message };
    }
    return { success: false, error: error.message || "Registration failed. Please try again." };
  }

  if (authData?.user && !authData?.session) {
    return { success: true, requiresConfirmation: true };
  }

  return { success: true };
}

async function healResidentProfile(
  userId: string,
  user: { user_metadata?: Record<string, unknown> | null }
) {
  const meta = (user.user_metadata || {}) as Record<string, string | undefined>;
  const firstName = meta.first_name || "Resident";
  const lastName = meta.last_name || "User";
  const displayName = `${firstName} ${lastName}`.trim();

  const { error: healError } = await supabase.rpc("heal_missing_profile", {
    p_user_id: userId,
  });
  if (healError) {
    console.warn("heal_missing_profile RPC failed:", healError.message);
  }

  const { data: healed } = await supabase
    .from("profiles")
    .select("role, display_name, account_status, first_login_completed")
    .eq("id", userId)
    .single();
  if (healed) return healed as ProfileRow;

  const { error: insertErr } = await supabase.from("profiles").insert({
    id: userId,
    role: "resident",
    display_name: displayName,
    account_status: "active",
  });
  if (insertErr) console.warn("profiles insert failed:", insertErr.message);

  await supabase.from("resident_profiles").insert({
    user_id: userId,
    first_name: firstName,
    middle_name: meta.middle_name || "",
    last_name: lastName,
    suffix: meta.suffix || "",
    date_of_birth: meta.date_of_birth || "2000-01-01",
    sex: meta.sex || "Other",
    mobile_number: meta.mobile_number || "N/A",
    house_street: meta.house_street || "N/A",
    purok: meta.purok || "N/A",
  });

  await supabase.from("resident_settings").insert({ user_id: userId });

  const { data: finalProfile } = await supabase
    .from("profiles")
    .select("role, display_name, account_status, first_login_completed")
    .eq("id", userId)
    .single();

  return (finalProfile as ProfileRow | null) ?? null;
}

export async function loginResident(
  credentials: LoginCredentials
): Promise<{ success: boolean; session?: AuthSession; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: credentials.email.trim(),
    password: credentials.password,
  });

  if (error) {
    if (error.message.includes("Invalid login")) {
      return { success: false, error: "Invalid email or password." };
    }
    return { success: false, error: "Login failed. Please try again." };
  }

  if (!data.user) {
    return failLogin("Login failed. Please try again.");
  }

  let { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, account_status, first_login_completed")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    profile = await healResidentProfile(data.user.id, data.user);
  }

  if (!profile) {
    return failLogin(
      "Account setup incomplete. Contact the barangay office to set up your account."
    );
  }

  const validationError = validateProfile(profile as ProfileRow);
  if (validationError) {
    return failLogin(validationError);
  }

  const { data: residentProfile } = await supabase
    .from("resident_profiles")
    .select("first_name, last_name")
    .eq("user_id", data.user.id)
    .single();

  const firstName = residentProfile?.first_name || "";
  const lastName = residentProfile?.last_name || "";

  const session: AuthSession = {
    id: data.user.id,
    email: data.user.email || credentials.email,
    fullName: `${firstName} ${lastName}`.trim() || profile.display_name || credentials.email,
    firstName,
    lastName,
    role: profile.role,
    firstLoginCompleted: profile.first_login_completed ?? false,
    isAuthenticated: true as const,
  };

  return { success: true, session };
}

export async function logoutResident(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  let { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, account_status, first_login_completed")
    .eq("id", user.id)
    .single();

  if (!profile) {
    profile = await healResidentProfile(user.id, user);
  }

  if (!profile) {
    await supabase.auth.signOut();
    return null;
  }

  const validationError = validateProfile(profile as ProfileRow);
  if (validationError) {
    await supabase.auth.signOut();
    return null;
  }

  const { data: residentProfile } = await supabase
    .from("resident_profiles")
    .select("first_name, last_name")
    .eq("user_id", user.id)
    .single();

  const firstName = residentProfile?.first_name || "";
  const lastName = residentProfile?.last_name || "";

  return {
    id: user.id,
    email: user.email || "",
    fullName: `${firstName} ${lastName}`.trim() || profile.display_name || user.email || "",
    firstName,
    lastName,
    role: profile.role,
    firstLoginCompleted: profile.first_login_completed ?? false,
    isAuthenticated: true as const,
  };
}

export async function resendConfirmation(email: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) return { success: false, error: error.message };
  return { success: true };
}
