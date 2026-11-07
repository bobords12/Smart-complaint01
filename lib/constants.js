export const SITE = {
  name: "Smart Complaint & Blotter Management System",
  shortName: "SCBMS",
  barangay: "Barangay Abuno",
  city: "Iligan City",
  hall: "Barangay Abuno Hall",
  country: "Philippines",
  tagline:
    "Smart Complaint and Blotter Management for Barangay Halls with Automatic Case Categorization",
  heroLabel: "WEB · MOBILE · KIOSK",
  announcement: "Now piloting at Barangay Abuno, Iligan City",
  description:
    "A capstone project digitizing complaint filing and blotter management for Barangay Abuno, Iligan City, with automatic NLP-based case categorization.",
  institution: "College of Computer Studies, St. Peter's College",
};

export const ROUTES = {
  home: "/",
  login: "/login",
  register: "/register",
};

export const RESIDENT_ROUTES = {
  dashboard: "/resident/dashboard",
  complaints: "/resident/complaints",
  newComplaint: "/resident/complaints/new",
  hearings: "/resident/hearings",
  notifications: "/resident/notifications",
  profile: "/resident/profile",
  settings: "/resident/settings",
};

/**
 * Single source of truth for the status a resident is shown.
 *
 * `complaints.current_status` is written only by the Captain workflow and uses
 * the `complaint_status` enum, which carries internal steps
 * ('For Official Categorization', 'Received') that mean nothing to a resident.
 * Those two steps both mean the barangay has officially received the case and
 * is working on it, so they collapse to the resident-facing 'In Progress'.
 *
 * Every resident surface must call this. Never re-derive the label locally or
 * My Complaints and the complaint detail page will drift apart again.
 */
export const RESIDENT_COMPLAINT_STATUS = {
  "Pending Review": "Pending Review",
  "For Official Categorization": "In Progress",
  Received: "In Progress",
  "In Progress": "In Progress",
  "Awaiting Meeting": "Awaiting Meeting",
  Resolved: "Resolved",
  Closed: "Closed",
  Rejected: "Rejected",
};

/**
 * Resident-facing label for a stored complaint status. Unknown values are
 * passed through untouched so a newly added enum value is never hidden.
 */
export function residentComplaintStatus(status) {
  if (!status) return "Pending Review";
  return RESIDENT_COMPLAINT_STATUS[status] ?? status;
}

export const CAPTAIN_ROUTES = {
  dashboard: "/captain/dashboard",
  complaints: "/captain/complaints",
  encodeComplaint: "/captain/complaints/encode",
  hearings: "/captain/hearings",
  luponPanels: "/captain/lupon-panels",
  blotter: "/captain/blotter",
  documents: "/captain/documents",
  notifications: "/captain/notifications",
  analytics: "/captain/analytics",
  reports: "/captain/reports",
  users: "/captain/users",
  activityLogs: "/captain/activity-logs",
  settings: "/captain/settings",
};

/**
 * Lupon Member Portal.
 *
 * Every route here reads ONLY the cases the signed-in member is
 * actively assigned to (public.lupon_panels). There is no
 * 'all complaints' view: `cases` is the member's own assignment
 * list, and `cases/[caseId]` is reachable only for an assignment
 * that exists. Rows outside an assignment are invisible at the
 * database level, not merely hidden in the UI.
 *
 * `caseDetail` is a function because the id comes from the URL
 * and is never used to widen a query.
 */
export const LUPON_ROUTES = {
  dashboard: "/lupon/dashboard",
  cases: "/lupon/cases",
  caseDetail: (caseId) => `/lupon/cases/${caseId}`,
  schedule: "/lupon/schedule",
  minutes: "/lupon/minutes",
  notifications: "/lupon/notifications",
};

/**
 * PNP Coordination Portal.
 *
 * Every route here reads ONLY formally approved barangay referrals
 * the signed-in officer is currently assigned to
 * (public.complaint_referrals + public.pnp_referral_assignments).
 * There is no 'all complaints' view and no complaint lookup: a
 * resident's request for referral, the barangay's internal routing
 * reasoning, and its blotter records are all invisible here. A
 * referral carries only the summary and evidence the Captain
 * explicitly chose to share when creating it.
 *
 * `referralDetail` is a function because the id comes from the URL
 * and is never used to widen a query: a guessed UUID belonging to
 * another officer's assignment returns no rows.
 */
export const PNP_ROUTES = {
  dashboard: "/pnp/dashboard",
  referrals: "/pnp/referrals",
  referralDetail: (referralId) => `/pnp/referrals/${referralId}`,
  notifications: "/pnp/notifications",
  activityLogs: "/pnp/activity-logs",
  profile: "/pnp/profile",
  settings: "/pnp/settings",
};

export const SECTION_IDS = {
  features: "features",
  commitments: "commitments",
  research: "research",
  faq: "faq",
  home: "top",
};

export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Features", href: `#${SECTION_IDS.features}` },
  { label: "Commitments", href: `#${SECTION_IDS.commitments}` },
  { label: "FAQ", href: `#${SECTION_IDS.faq}` },
];