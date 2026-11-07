export const CASE_TABS = [
  { id: "overview", label: "Overview" },
  // No permission key: every official READS routing, because a
  // secretary needs to see why a case is blocked as much as the
  // Captain does. Only the Captain and OIC may DECIDE, and that is
  // enforced on the action buttons and again in SQL. Adding a
  // permission here would hide the tab from the secretary entirely.
  { id: "routing", label: "Routing Assessment" },
  { id: "categorization", label: "Categorization", permission: "case_categorization" },
  { id: "tracking", label: "Process & Tracking" },
  { id: "hearings", label: "Hearings & Notice", permission: "summons_hearings" },
  { id: "lupon", label: "Lupon Panel", permission: "lupon_panels" },
  { id: "documents", label: "Documents", permission: "documents" },
  // Also no permission key. A referral is a fact about this
  // complaint and the secretary needs to know the PNP was asked and
  // what it asked back. The Captain and OIC get the buttons; the RPCs
  // re-check the role regardless.
  { id: "referral", label: "PNP Referral" },
  { id: "audit", label: "Audit History", permission: "audit_log" },
];
