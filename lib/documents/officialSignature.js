import { isPresent } from "./printedForm.js";

/**
 * Who signs a printed barangay form.
 *
 * The name always comes from the authenticated official's own profile row, and
 * the office title is derived from that profile's role. Nothing here is keyed
 * to a particular person, and no name is hard-coded: an official who is not
 * signed in simply leaves the printed block blank for the wet signature taken
 * at the barangay hall.
 *
 * TWO SHAPES OF THE SAME PERSON
 *   Callers hand over either a raw `profiles` row, which carries the name as
 *   `display_name`, or the `AuthSession` the auth context holds, which carries
 *   it as `fullName` (built at login from that same row's first and last name)
 *   plus `firstName` / `lastName`. Reading only `display_name` therefore printed
 *   a blank signature line on every form generated from a live session, while
 *   the title still resolved from `role` — a half-filled block that looked like
 *   missing data rather than a mismatched key. Both spellings are accepted
 *   because they are the same value from the same row, and when neither is
 *   present the block stays blank.
 */

/** Office titles exactly as the reference forms print them. */
export const SIGNATURE_TITLES = {
  captain: "Punong Barangay/Lupon Chairman",
  oic: "OIC / Punong Barangay",
  secretary: "Barangay Secretary",
};

export function officialTitleFor(role) {
  return SIGNATURE_TITLES[role] || null;
}

/** The official's name, whichever of the session's spellings is populated. */
function signatureNameFor(profile) {
  if (isPresent(profile?.display_name)) return String(profile.display_name).trim();

  if (isPresent(profile?.fullName)) return String(profile.fullName).trim();

  const composed = [profile?.firstName, profile?.lastName].filter(isPresent).join(" ").trim();
  return isPresent(composed) ? composed : null;
}

/**
 * @param {{ display_name?: string|null, fullName?: string|null,
 *           firstName?: string|null, lastName?: string|null,
 *           role?: string|null }} profile
 * @returns {{ name: string|null, title: string|null, role: string|null }}
 */
export function officialSignatureFor(profile) {
  const role = isPresent(profile?.role) ? String(profile.role).trim() : null;
  return {
    name: signatureNameFor(profile),
    title: officialTitleFor(role),
    role,
  };
}
