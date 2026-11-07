/**
 * Static, presentational data for the authentication pages.
 * These values are sample data only — they will be replaced by
 * Supabase reads (resident profiles, barangay records) in a later phase.
 */

export const AUTH_RECORDS = {
  barangay: "Abuno",
  city: "Iligan City",
  province: "Lanao del Norte",
  region: "Region X — Northern Mindanao",
  country: "Philippines",
};

export const PUROKS = [
  "Purok 1",
  "Purok 2",
  "Purok 3",
  "Purok 4",
  "Purok 5",
  "Purok 6",
];

export const SEX_OPTIONS = ["Female", "Male", "Prefer not to say"];

export const SUFFIX_OPTIONS = ["Jr.", "Sr.", "II", "III", "IV"];

// Only residents may self-register. Staff roles (Captain, OIC, Secretary,
// Lupon, Administrator) are created and assigned by an authorized official.
export const REGISTRATION_ROLES = ["Resident"];

// Order used to focus the first invalid field on a failed register submit.
export const REGISTER_FIELD_ORDER = [
  "firstName",
  "lastName",
  "dob",
  "sex",
  "houseNo",
  "purok",
  "mobile",
  "email",
  "password",
  "confirmPassword",
  "consentAccurate",
  "consentTerms",
];

// Order used when the login form fails validation.
export const LOGIN_FIELD_ORDER = ["email", "password"];