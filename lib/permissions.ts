import type { AppRole } from "@/types/auth";
import { CAPTAIN_ROUTES } from "@/lib/constants";

export type OfficialRole = "captain" | "oic" | "secretary";

export type PermissionKey =
  | "dashboard"
  | "complaints"
  | "case_categorization"
  | "summons_hearings"
  | "lupon_panels"
  | "blotter_records"
  | "documents"
  | "notifications"
  | "analytics"
  | "reports"
  | "users_roles"
  | "audit_log"
  | "settings";

/**
 * Roles that use the shared official shell and the official
 * permission matrix below.
 *
 * 'lupon' is intentionally excluded. A Lupon member has a
 * separate portal whose access is scoped to their case
 * assignments, not to this fixed permission table. Listing it
 * here would fall through `canAccessPage` to the resident
 * dashboard and expose the official sidebar.
 */
export const OFFICIAL_ROLES: OfficialRole[] = ["captain", "oic", "secretary"];

export const LUPON_ROLE_LABELS = {
  lupon: "Lupon Member",
  chairperson: "Pangkat Chairperson",
  secretary: "Pangkat Secretary",
  member: "Pangkat Member",
  alternate: "Pangkat Alternate",
} as const;

export type PangkatRole = keyof typeof LUPON_ROLE_LABELS;


export const OFFICIAL_ROLE_LABELS: Record<OfficialRole, string> = {
  captain: "Barangay Captain",
  oic: "Officer-in-Charge",
  secretary: "Barangay Secretary",
};

export const OFFICIAL_ROLE_SHORT_LABELS: Record<OfficialRole, string> = {
  captain: "Captain",
  oic: "OIC",
  secretary: "Secretary",
};

export const OFFICIAL_PORTAL_LABELS: Record<OfficialRole, string> = {
  captain: "Barangay Captain Portal",
  oic: "OIC Portal",
  secretary: "Secretary Portal",
};

export const ROLE_DASHBOARD_ROUTES: Record<OfficialRole, string> = {
  captain: "/captain/dashboard",
  oic: "/oic/dashboard",
  secretary: "/secretary/dashboard",
};

export function isOfficialRole(role: AppRole | string | null | undefined): role is OfficialRole {
  return (
    role === "captain" || role === "oic" || role === "secretary"
  );
}

/**
 * PNP officer. Not an official: a PNP officer is an external
 * partner account, and the two roles are never interchangeable.
 */
export type PnpRole = "pnp_officer";

export const PNP_ROLE_LABELS: Record<PnpRole, string> = {
  pnp_officer: "PNP Officer",
};

export const PNP_PORTAL_LABEL = "PNP Coordination Portal";

export function isPnpRole(
  role: AppRole | string | null | undefined
): role is PnpRole {
  return role === "pnp_officer";
}

/**
 * Human-readable label for any portal role.
 *
 * Used by the shared profile surfaces (settings, sidebar cards) so
 * a single account can be labelled correctly without each component
 * growing its own role map. The official map is consulted first, so
 * captain/oic/secretary keep their existing labels.
 */
export function getPortalRoleLabel(
  role: AppRole | string | null | undefined
): string {
  if (!role) return "—";
  if (isOfficialRole(role)) return OFFICIAL_ROLE_LABELS[role];
  if (isPnpRole(role)) return PNP_ROLE_LABELS[role];
  if (role === "lupon") return LUPON_ROLE_LABELS.lupon;
  if (role === "resident") return "Resident";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

const ALL_PERMISSIONS: PermissionKey[] = [
  "dashboard",
  "complaints",
  "case_categorization",
  "summons_hearings",
  "lupon_panels",
  "blotter_records",
  "documents",
  "notifications",
  "analytics",
  "reports",
  "users_roles",
  "audit_log",
  "settings",
];

const CAPTAIN_ONLY: PermissionKey[] = ["users_roles"];
const SECRETARY_DENIED: PermissionKey[] = [
  "case_categorization",
  "lupon_panels",
  "users_roles",
];

function allowedSet(denied: PermissionKey[]): Record<PermissionKey, boolean> {
  const map = {} as Record<PermissionKey, boolean>;
  for (const key of ALL_PERMISSIONS) {
    map[key] = !denied.includes(key);
  }
  return map;
}

const ROLE_PERMISSIONS: Record<OfficialRole, Record<PermissionKey, boolean>> = {
  captain: allowedSet([]),
  oic: allowedSet(CAPTAIN_ONLY),
  secretary: allowedSet(SECRETARY_DENIED),
};

export function canAccessPage(
  role: AppRole | string | null | undefined,
  permission: PermissionKey
): boolean {
  if (!isOfficialRole(role)) return false;
  return ROLE_PERMISSIONS[role][permission] !== false;
}

export function getDefaultRouteForRole(
  role: AppRole | string | null | undefined
): string {
  if (isOfficialRole(role)) return ROLE_DASHBOARD_ROUTES[role];
  // A Lupon member has their own portal. They are NOT routed to
  // the resident dashboard: the resident portal and the Lupon
  // portal expose different data, and a Lupon member has no
  // resident profile to land on.
  if (role === "lupon") return "/lupon/dashboard";
  // A PNP officer has their own portal, for the same reason: the
  // referral queue is not a resident dashboard and must not be
  // rendered inside the official shell.
  if (isPnpRole(role)) return "/pnp/dashboard";
  if (role === "resident") return "/resident/dashboard";
  if (role && role.length > 0) return "/";
  return "/";
}

export function getRoutePrefix(
  role: AppRole | string | null | undefined
): string | null {
  if (!isOfficialRole(role)) return null;
  return role;
}

export function getOfficialRoutes(
  role: AppRole | string | null | undefined
): typeof CAPTAIN_ROUTES {
  const prefix = getRoutePrefix(role) ?? "captain";
  const routes = {} as typeof CAPTAIN_ROUTES;
  for (const key of Object.keys(CAPTAIN_ROUTES) as Array<
    keyof typeof CAPTAIN_ROUTES
  >) {
    routes[key] = CAPTAIN_ROUTES[key].replace(/^\/captain/, `/${prefix}`) as
      (typeof CAPTAIN_ROUTES)[typeof key];
  }
  return routes;
}

const PATH_PERMISSIONS: Array<{ prefix: string; permission: PermissionKey }> = [
  { prefix: "/captain/users", permission: "users_roles" },
  { prefix: "/oic/users", permission: "users_roles" },
  { prefix: "/secretary/users", permission: "users_roles" },
  { prefix: "/captain/activity-logs", permission: "audit_log" },
  { prefix: "/oic/activity-logs", permission: "audit_log" },
  { prefix: "/secretary/activity-logs", permission: "audit_log" },
  { prefix: "/captain/analytics", permission: "analytics" },
  { prefix: "/oic/analytics", permission: "analytics" },
  { prefix: "/secretary/analytics", permission: "analytics" },
  { prefix: "/captain/reports", permission: "reports" },
  { prefix: "/oic/reports", permission: "reports" },
  { prefix: "/secretary/reports", permission: "reports" },
  { prefix: "/captain/notifications", permission: "notifications" },
  { prefix: "/oic/notifications", permission: "notifications" },
  { prefix: "/secretary/notifications", permission: "notifications" },
  { prefix: "/captain/settings", permission: "settings" },
  { prefix: "/oic/settings", permission: "settings" },
  { prefix: "/secretary/settings", permission: "settings" },
  { prefix: "/captain/blotter", permission: "blotter_records" },
  { prefix: "/oic/blotter", permission: "blotter_records" },
  { prefix: "/secretary/blotter", permission: "blotter_records" },
  { prefix: "/captain/documents", permission: "documents" },
  { prefix: "/oic/documents", permission: "documents" },
  { prefix: "/secretary/documents", permission: "documents" },
  { prefix: "/captain/hearings", permission: "summons_hearings" },
  { prefix: "/oic/hearings", permission: "summons_hearings" },
  { prefix: "/secretary/hearings", permission: "summons_hearings" },
  { prefix: "/captain/lupon-panels", permission: "lupon_panels" },
  { prefix: "/oic/lupon-panels", permission: "lupon_panels" },
  { prefix: "/secretary/lupon-panels", permission: "lupon_panels" },
  { prefix: "/captain/case-categorization", permission: "case_categorization" },
  { prefix: "/oic/case-categorization", permission: "case_categorization" },
  { prefix: "/secretary/case-categorization", permission: "case_categorization" },
  { prefix: "/captain/complaints", permission: "complaints" },
  { prefix: "/oic/complaints", permission: "complaints" },
  { prefix: "/secretary/complaints", permission: "complaints" },
  { prefix: "/captain/dashboard", permission: "dashboard" },
  { prefix: "/oic/dashboard", permission: "dashboard" },
  { prefix: "/secretary/dashboard", permission: "dashboard" },
];

export function getPermissionForPath(pathname: string): PermissionKey | null {
  if (!pathname) return null;
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  for (const entry of PATH_PERMISSIONS) {
    if (clean === entry.prefix || clean.startsWith(`${entry.prefix}/`)) {
      return entry.permission;
    }
  }
  return null;
}

export function canAccessPath(
  role: AppRole | string | null | undefined,
  pathname: string
): boolean {
  const permission = getPermissionForPath(pathname);
  if (permission === null) return true;
  return canAccessPage(role, permission);
}


/* ── Lupon Member Portal ────────────────────────────────────
 *
 * A Lupon member's access is NOT a fixed permission table like
 * the officials'. Every one of these routes reads only the cases
 * the member is actively assigned to, enforced by RLS
 * (lupon_is_assigned_to). The list below drives the sidebar and
 * the client-side guard; it is a navigation convenience, never
 * the security boundary. The boundary is the database.
 */

export type LuponPermissionKey =
  | "lupon_dashboard"
  | "lupon_cases"
  | "lupon_schedule"
  | "lupon_minutes"
  | "lupon_notifications";

export const LUPON_PERMISSIONS: LuponPermissionKey[] = [
  "lupon_dashboard",
  "lupon_cases",
  "lupon_schedule",
  "lupon_minutes",
  "lupon_notifications",
];

const LUPON_PATH_PERMISSIONS: Array<{
  prefix: string;
  permission: LuponPermissionKey;
}> = [
  { prefix: "/lupon/dashboard", permission: "lupon_dashboard" },
  { prefix: "/lupon/cases", permission: "lupon_cases" },
  { prefix: "/lupon/schedule", permission: "lupon_schedule" },
  { prefix: "/lupon/minutes", permission: "lupon_minutes" },
  { prefix: "/lupon/notifications", permission: "lupon_notifications" },
];

export function getLuponPermissionForPath(
  pathname: string
): LuponPermissionKey | null {
  if (!pathname) return null;
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  for (const entry of LUPON_PATH_PERMISSIONS) {
    if (clean === entry.prefix || clean.startsWith(`${entry.prefix}/`)) {
      return entry.permission;
    }
  }
  return null;
}

/**
 * Every Lupon route requires the lupon role. Returns false for
 * every other role, including officials: an official uses the
 * Captain/OIC/Secretary portal, not the member view.
 */
export function canAccessLuponPage(
  role: AppRole | string | null | undefined,
  _permission: LuponPermissionKey
): boolean {
  return role === "lupon";
}


/* ── PNP Coordination Portal ────────────────────────────────
 *
 * Like the Lupon member's, a PNP officer's access is NOT the fixed
 * official permission table. Every one of these routes reads only
 * FORMALLY APPROVED referrals, scoped by RLS to the referrals the
 * officer is currently assigned to. A PNP officer has no 'all
 * complaints' view, no blotter view, and no access to the barangay's
 * internal case reasoning: a referral carries only the fields the
 * Captain explicitly chose to share.
 *
 * The list below drives the sidebar and the client-side guard. It is
 * a navigation convenience, never the security boundary. The
 * boundary is the database.
 */

export type PnpPermissionKey =
  | "pnp_dashboard"
  | "pnp_referrals"
  | "pnp_notifications"
  | "pnp_activity_logs"
  | "pnp_profile"
  | "pnp_settings";

export const PNP_PERMISSIONS: PnpPermissionKey[] = [
  "pnp_dashboard",
  "pnp_referrals",
  "pnp_notifications",
  "pnp_activity_logs",
  "pnp_profile",
  "pnp_settings",
];

const PNP_PATH_PERMISSIONS: Array<{
  prefix: string;
  permission: PnpPermissionKey;
}> = [
  { prefix: "/pnp/dashboard", permission: "pnp_dashboard" },
  { prefix: "/pnp/referrals", permission: "pnp_referrals" },
  { prefix: "/pnp/notifications", permission: "pnp_notifications" },
  { prefix: "/pnp/activity-logs", permission: "pnp_activity_logs" },
  { prefix: "/pnp/profile", permission: "pnp_profile" },
  { prefix: "/pnp/settings", permission: "pnp_settings" },
];

export function getPnpPermissionForPath(
  pathname: string
): PnpPermissionKey | null {
  if (!pathname) return null;
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  for (const entry of PNP_PATH_PERMISSIONS) {
    if (clean === entry.prefix || clean.startsWith(`${entry.prefix}/`)) {
      return entry.permission;
    }
  }
  return null;
}

/**
 * Every PNP route requires the pnp_officer role. Returns false for
 * every other role, including officials: a Captain who types
 * /pnp/... is redirected back to the Captain portal rather than
 * being shown an empty PNP shell.
 */
export function canAccessPnpPage(
  role: AppRole | string | null | undefined,
  _permission: PnpPermissionKey
): boolean {
  return role === "pnp_officer";
}


export interface SidebarNavItem {
  key: string;
  label: string;
  href: string;
  permission: PermissionKey;
  /**
   * Additional paths that should highlight this item while it is active.
   * Used by the Complaints entry so that complaint-scoped workflow routes
   * (hearings, lupon panels, documents) keep Complaints highlighted even
   * though they no longer appear as their own sidebar links.
   */
  alsoActivePaths?: string[];
}

export interface SidebarNavGroup {
  label: string;
  items: SidebarNavItem[];
}

/**
 * Complaint-scoped workflow routes. These are intentionally absent from the
 * sidebar but remain reachable and must keep "Complaints" highlighted.
 */
export const COMPLAINT_WORKFLOW_PATHS = ["hearings", "lupon-panels", "documents"] as const;

export function getSidebarItemsForRole(
  role: AppRole | string | null | undefined
): SidebarNavGroup[] {
  const routes = getOfficialRoutes(role);
  const prefix = getRoutePrefix(role) ?? "captain";
  const groups: Array<{ label: string; items: SidebarNavItem[] }> = [
    {
      label: "Main Navigation",
      items: [
        { key: "dashboard", label: "Dashboard", href: routes.dashboard, permission: "dashboard" },
        {
          key: "complaints",
          label: "Complaints",
          href: routes.complaints,
          permission: "complaints",
          alsoActivePaths: COMPLAINT_WORKFLOW_PATHS.map(
            (segment) => `/${prefix}/${segment}`
          ),
        },
      ],
    },
    {
      label: "Case Records",
      items: [
        { key: "blotter", label: "Blotter Records", href: routes.blotter, permission: "blotter_records" },
      ],
    },
    {
      label: "Monitoring",
      items: [
        { key: "analytics", label: "Analytics", href: routes.analytics, permission: "analytics" },
        { key: "reports", label: "Reports", href: routes.reports, permission: "reports" },
      ],
    },
    {
      label: "Management",
      items: [
        { key: "users", label: "Users & Roles", href: routes.users, permission: "users_roles" },
        { key: "activity-logs", label: "Activity Logs", href: routes.activityLogs, permission: "audit_log" },
      ],
    },
  ];

  const visible: SidebarNavGroup[] = [];
  for (const group of groups) {
    const items = group.items.filter((item) => canAccessPage(role, item.permission));
    if (items.length > 0) visible.push({ label: group.label, items });
  }

  return visible;
}
