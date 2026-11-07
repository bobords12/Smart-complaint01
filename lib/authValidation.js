/**
 * Pure validation helpers shared by the login and register forms.
 * Kept separate from the presentation layer so the same rules can be
 * reused next to the future Supabase auth service.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 100;

export function isEmailValid(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

// Philippine mobile format: 09XXXXXXXXX (spaces and dashes tolerated).
const PHONE_PATTERN = /^09\d{9}$/;

export function isPhMobileValid(value) {
  const digits = String(value).replace(/[\s-]/g, "");
  return PHONE_PATTERN.test(digits);
}

export function isFutureDate(value) {
  if (!value) return false;
  return new Date(`${value}T00:00:00`) > new Date();
}

export function hasMinPasswordLength(value) {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH;
}