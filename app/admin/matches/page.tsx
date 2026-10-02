import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { EmptyState } from "@/components/common/empty-state";
import { NativeSelect } from "@/components/common/native-select";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { StatusPill } from "@/components/match/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listMatchesForAdmin } from "@/server/queries/admin-matches";
import { GAME_LIST } from "@/lib/games";
import { MODE_LABEL } from "@/lib/match-schema";
import { MATCH_STATUSES, STATUS_LABEL } from "@/lib/match-state";
import { formatEntryFee } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Matches" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : undefined;
}

export default async function AdminMatchesPage({ searchParams }: PageProps<"/admin/matches">) {
  const user = await requireStaffPage("/admin/matches");
  const sp = await searchParams;
  const filters = {
    game: str(sp.game),
    kind: str(sp.kind),
    status: str(sp.status),
    from: str(sp.from),
    to: str(sp.to),
  };
  const matches = await listMatchesForAdmin(toActor(user), filters);

  return (
    <>
      <PageHeader title="Matches" description="All times IST.">
        <Button asChild>
          <Link href="/admin/matches/new">New match</Link>
        </Button>
      </PageHeader>

      <form
        method="get"
        className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Filter matches"
      >
        <div className="space-y-1">
          <Label htmlFor="f-game">Game</Label>
          <NativeSelect id="f-game" name="game" defaultValue={filters.game ?? ""}>
            <option value="">All</option>
            {GAME_LIST.map((g) => (
              <option key={g.id} value={g.slug}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-kind">Kind</Label>
          <NativeSelect id="f-kind" name="kind" defaultValue={filters.kind ?? ""}>
            <option value="">All</option>
            <option value="SCRIM">Scrim</option>
            <option value="TOURNAMENT">Tournament</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-status">Status</Label>
          <NativeSelect id="f-status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">All</option>
            {MATCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" name="from" type="date" defaultValue={filters.from} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" name="to" type="date" defaultValue={filters.to} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/matches">Reset</Link>
          </Button>
        </div>
      </form>

      {matches.length === 0 ? (
        <EmptyState
          title="No matches found"
          description="Create a match or change the filters."
          action={{ href: "/admin/matches/new", label: "New match" }}
        />
      ) : (
        <div className="card-ds overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Match</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Slots</TableHead>
                <TableHead className="text-right">Entry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <GameBadge game={m.game} />
                      <Link href={`/admin/matches/${m.id}`} className="font-medium hover:underline">
                        {m.title}
                      </Link>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {m.kind === "TOURNAMENT" ? "Tournament · " : ""}
                      {MODE_LABEL[m.mode]}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatIST(m.startsAt)}</TableCell>
                  <TableCell>
                    <StatusPill status={m.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {m._count.registrations}/{m.maxSlots}
                  </TableCell>
                  <TableCell className="text-right">{formatEntryFee(m.entryFeePaise)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
