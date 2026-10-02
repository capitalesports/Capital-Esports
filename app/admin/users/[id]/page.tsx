import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { notFound } from "next/navigation";
import { AuditTable } from "@/components/admin/audit-table";
import {
  BanControls,
  DobControls,
  MergeControls,
  ResetGameProfileButton,
  RoleControls,
} from "@/components/admin/user-actions";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { StatusPill } from "@/components/match/status-pill";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { getUserDetail } from "@/server/services/admin-users";
import { isAccountBanned } from "@/lib/bans";
import { GAME_CONFIG } from "@/lib/games";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserPage({ params }: PageProps<"/admin/users/[id]">) {
  const { id } = await params;
  const me = await requireStaffPage(`/admin/users/${id}`);
  const detail = await getUserDetail(toActor(me), id).catch(() => null);
  if (!detail) notFound();
  const { user, points, audit } = detail;
  const banned = isAccountBanned(user);
  const totalPoints = points.reduce((s, p) => s + (p._sum.points ?? 0), 0);

  return (
    <>
      <PageHeader
        title={user.displayName ?? "(no name)"}
        description={`${user.email ?? user.phone ?? "No email"} · ${user.role} · joined ${formatIST(user.createdAt)}`}
      />
      {user.deletedAt ? (
        <p className="bg-muted mb-4 rounded-lg p-3 text-sm">
          Merged into{" "}
          <Link className="underline" href={`/admin/users/${user.mergedIntoId}`}>
            {user.mergedIntoId}
          </Link>
          .
        </p>
      ) : null}
      {banned ? (
        <p className="bg-destructive/15 text-destructive mb-4 rounded-lg p-3 text-sm">
          Banned {user.bannedUntil ? `until ${formatIST(user.bannedUntil)}` : "permanently"}.
          Reason: {user.banReason}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <section aria-label="Overview" className="card-ds p-4 text-sm">
            <p>
              User ID: <code className="text-xs">{user.id}</code>
            </p>
            <p>
              Strikes: {user.strikes}
              {user.registrationBlockedUntil && user.registrationBlockedUntil > new Date()
                ? ` · registration blocked until ${formatIST(user.registrationBlockedUntil)}`
                : ""}
            </p>
            <p>Points (all seasons): {totalPoints}</p>
            <p>
              Date of birth: {user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : "—"}
            </p>
          </section>
          <section aria-label="Game profiles" className="card-ds p-4">
            <h2 className="mb-2 font-semibold">Game profiles</h2>
            {user.gameProfiles.length === 0 ? (
              <p className="text-muted-foreground text-sm">None</p>
            ) : null}
            <ul className="space-y-2">
              {user.gameProfiles.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <GameBadge game={p.game} />
                  <span>
                    {GAME_CONFIG[p.game].idLabel}: {p.game === "VALORANT" ? p.ign : p.gameId}
                    {p.game === "BGMI" && p.ign ? ` (${p.ign})` : ""}
                    {p.region ? ` · ${p.region}` : ""}
                  </span>
                  <span className="ml-auto">
                    <ResetGameProfileButton userId={user.id} game={p.game} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Teams" className="card-ds p-4">
            <h2 className="mb-2 font-semibold">Teams</h2>
            <ul className="space-y-1 text-sm">
              {user.teamMemberships.map((m) => (
                <li key={m.id}>
                  <Link href={`/admin/teams/${m.team.id}`} className="hover:underline">
                    {m.team.name}
                  </Link>{" "}
                  ({GAME_CONFIG[m.team.game].name}, {m.status.toLowerCase()}
                  {m.team.captainId === user.id ? ", captain" : ""})
                </li>
              ))}
              {user.teamMemberships.length === 0 ? (
                <li className="text-muted-foreground">None</li>
              ) : null}
            </ul>
          </section>
        </div>
        {!user.deletedAt ? (
          <div className="space-y-4">
            <BanControls userId={user.id} banned={banned} />
            {me.role === "ADMIN" ? (
              <DobControls
                userId={user.id}
                dateOfBirth={user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null}
              />
            ) : null}
            <RoleControls userId={user.id} role={user.role} isSelf={user.id === me.id} />
            <MergeControls primaryId={user.id} />
          </div>
        ) : null}
      </div>

      <h2 className="mt-8 mb-2 text-lg font-semibold">Registrations</h2>
      <ul className="space-y-1 text-sm">
        {user.registrations.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <GameBadge game={r.match.game} />
            <Link href={`/admin/matches/${r.match.id}`} className="hover:underline">
              {r.match.title}
            </Link>
            <span className="text-muted-foreground">{formatIST(r.match.startsAt)}</span>
            <StatusPill status={r.match.status} />
            <span className="text-muted-foreground">
              ({r.status.toLowerCase().replace(/_/g, " ")})
            </span>
          </li>
        ))}
        {user.registrations.length === 0 ? <li className="text-muted-foreground">None</li> : null}
      </ul>

      <h2 className="mt-8 mb-2 text-lg font-semibold">Audit trail</h2>
      <AuditTable rows={audit} />
    </>
  );
}
