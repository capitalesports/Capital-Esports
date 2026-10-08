export type StaffRole = "MODERATOR" | "ADMIN";

export interface AdminSection {
  href: string;
  label: string;
  /** Roles that may open this section. Moderators get Matches, Results, Teams (and Reports) only. */
  roles: readonly StaffRole[];
}

const BOTH = ["MODERATOR", "ADMIN"] as const;
const ADMIN_ONLY = ["ADMIN"] as const;

export const ADMIN_SECTIONS: AdminSection[] = [
  { href: "/admin/matches", label: "Matches", roles: BOTH },
  { href: "/admin/results", label: "Results", roles: BOTH },
  { href: "/admin/teams", label: "Teams", roles: BOTH },
  { href: "/admin/reports", label: "Reports", roles: BOTH },
  { href: "/admin/tournaments", label: "Tournaments", roles: ADMIN_ONLY },
  { href: "/admin/users", label: "Users", roles: ADMIN_ONLY },
  { href: "/admin/deletion-requests", label: "Deletion requests", roles: ADMIN_ONLY },
  { href: "/admin/seasons", label: "Seasons", roles: ADMIN_ONLY },
  { href: "/admin/points", label: "Points", roles: ADMIN_ONLY },
  { href: "/admin/payouts", label: "Prizes", roles: ADMIN_ONLY },
  { href: "/admin/content", label: "Content", roles: ADMIN_ONLY },
  { href: "/admin/announcements", label: "Announcements", roles: ADMIN_ONLY },
  { href: "/admin/referrals", label: "Referrals", roles: ADMIN_ONLY },
  { href: "/admin/audit", label: "Audit log", roles: ADMIN_ONLY },
];

export function sectionsForRole(role: StaffRole): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => s.roles.includes(role));
}

/** The admin section a pathname belongs to, or null for /admin itself. */
export function sectionForPath(pathname: string): AdminSection | null {
  return (
    ADMIN_SECTIONS.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)) ?? null
  );
}

export function canAccessAdminPath(role: StaffRole, pathname: string): boolean {
  const section = sectionForPath(pathname);
  return section ? section.roles.includes(role) : true;
}
